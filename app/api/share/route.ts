import type { Message } from "ai";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SharePart =
  | { type: "text"; text: string }
  | { type: "sources"; query: string; results: { title: string; url: string }[] };

const FILE_RE = /<file name="([^"]+)">[\s\S]*?<\/file>/g;
const clean = (t: string) => t.replace(FILE_RE, (_, n) => `[file: ${n}]`).replace(/\n*<followups>[\s\S]*$/i, "").trim();
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

function sanitize(ms: Message[]) {
  return ms
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-200)
    .map((m) => {
      const parts = (m.parts ?? []).flatMap<SharePart>((part) => {
        if (part.type === "text") { const t = clean(part.text); return t ? [{ type: "text", text: t }] : []; }
        if (part.type === "tool-invocation" && part.toolInvocation.toolName === "web_search" && part.toolInvocation.state === "result") {
          const r = part.toolInvocation.result as { ok?: boolean; results?: { title: string; url: string }[] };
          if (!r?.ok) return [];
          return [{
            type: "sources",
            query: str((part.toolInvocation.args as { query?: string })?.query, 300),
            results: (r.results ?? []).slice(0, 8).map((x) => ({ title: str(x.title, 300), url: str(x.url, 1000) })),
          }];
        }
        return [];
      });
      if (!parts.length && m.content) { const t = clean(m.content); if (t) parts.push({ type: "text", text: t }); }
      const attachments = (m.experimental_attachments ?? [])
        .filter((a) => a.contentType?.startsWith("image/"))
        .map((a) => ({ name: a.name ?? "image", url: a.url }));
      return { role: m.role, parts, attachments };
    })
    .filter((m) => m.parts.length || m.attachments.length);
}

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(req: Request) {
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const cid = new URL(req.url).searchParams.get("conversationId");
  if (!cid) return Response.json({ id: null });
  const { data } = await supabase.from("shares").select("id").eq("conversation_id", cid).maybeSingle();
  return Response.json({ id: data?.id ?? null });
}

export async function POST(req: Request) {
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const raw = await req.text();
  if (raw.length > 3_000_000) return Response.json({ error: "This chat is too long to share." }, { status: 413 });
  let body: { conversationId?: string; title?: string; mode?: Record<string, unknown>; messages?: Message[] };
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "Bad request." }, { status: 400 }); }
  if (!body.conversationId || !body.messages?.length) return Response.json({ error: "Nothing to share yet." }, { status: 400 });

  const { data: existing } = await supabase.from("shares").select("id").eq("conversation_id", body.conversationId).maybeSingle();
  const id = existing?.id ?? newId();
  const mode = body.mode
    ? { name: str(body.mode.name, 60), icon: str(body.mode.icon, 16), accent: str(body.mode.accent, 32), theme: str(body.mode.theme, 32) }
    : null;

  const { error } = await supabase.from("shares").upsert(
    {
      id,
      conversation_id: body.conversationId,
      user_id: user.id,
      title: str(body.title, 120) || "Shared chat",
      mode,
      messages: sanitize(body.messages),
      created_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" }
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ id });
}

export async function DELETE(req: Request) {
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const cid = new URL(req.url).searchParams.get("conversationId");
  if (!cid) return Response.json({ ok: false }, { status: 400 });
  const { error } = await supabase.from("shares").delete().eq("conversation_id", cid).eq("user_id", user.id);
  return Response.json({ ok: !error });
}
