import { SYSTEM } from "../../../lib/liveSystem";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  process.env.GOOGLE_AI_API_KEY ||
  "";
const MODELS = Array.from(
  new Set([process.env.LIVE_MODEL, "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest"].filter(Boolean) as string[])
);
const BUDGET_MS = 45000;
const ATTEMPT_MS = 22000;


type Turn = { q?: string; a?: string };


// One try at one model. Gives up if the model has not started answering in ATTEMPT_MS.
async function gemini(model: string, body: unknown) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ATTEMPT_MS);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Turns Gemini's stream into plain text for the island
function toText(body: ReadableStream<Uint8Array>, onDone?: (full: string) => Promise<void>) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "", full = "";
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) { if (onDone) await onDone(full).catch(() => {}); ctrl.close(); return; }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5));
          for (const p of j.candidates?.[0]?.content?.parts || []) if (p.text && !p.thought) { full += p.text; ctrl.enqueue(enc.encode(p.text)); }
        } catch { /* partial line, skip */ }
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    if (!KEY) return Response.json({ error: "Live is missing the Gemini key on the server." }, { status: 500 });
    const auth = await session().catch(() => null);
    if (!auth) return Response.json({ error: "Please sign in to ModeBuddy first." }, { status: 401 });
    const limitP = overLimit(auth).catch(() => false);
    const memP = Promise.resolve(auth.sb.from("live_memory").select("data").eq("user_id", auth.userId).maybeSingle()).catch(() => ({ data: null }));
    if (await limitP) return Response.json({ error: "You have used all of today's Live questions. They reset at midnight (UTC)." }, { status: 429 });

    const { audio, image, history, modes, modeId, installed } = (await req.json().catch(() => ({}))) as { audio?: string; image?: string | null; history?: Turn[]; modes?: { name: string; apps?: string[]; sites?: string[] }[]; modeId?: string; installed?: string[] };
    if (!audio) return Response.json({ error: "I did not catch any audio. Try again." }, { status: 400 });

    const past = (Array.isArray(history) ? history : []).slice(-4).flatMap((t) => [
      { role: "user", parts: [{ text: String(t.q || "(question)").slice(0, 2000) }] },
      { role: "model", parts: [{ text: String(t.a || "").slice(0, 6000) }] },
    ]);
    const parts: Record<string, unknown>[] = [];
    if (image) parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
    parts.push({ inlineData: { mimeType: "audio/wav", data: audio } });
    parts.push({ text: (image ? "This is my screen right now. My request is in the audio." : "My request is in the audio. No screenshot was available.") + (Array.isArray(installed) && installed.length ? "\nApps installed on this Mac: " + installed.slice(0, 250).join(", ") : "") });

    let extra = "";
    const { data: memRow } = await memP;
    const mem = (memRow?.data || {}) as { routines?: { name: string; triggers?: string[] }[]; facts?: string[] };
    if (mem.facts?.length) extra += "\n\nWhat you know about this user (use it, and never ask them for things you already know):\n" + mem.facts.slice(0, 50).map((f) => "- " + f).join("\n");
    if (mem.routines?.length) extra += "\n\nThe user's routines (things they do often):\n" + mem.routines.slice(0, 25).map((r) => "- " + r.name + " (they might say: " + (r.triggers || []).slice(0, 5).join("; ") + ")").join("\n") + "\nIf what they ask matches one of these routines, even loosely (like \"start everything up\" or \"open my usual stuff\"), do NOT write DO. Instead add a line right after SAY: USE: <exact routine name>. Only write DO if they ask for something different or extra.";
    extra += "\n\nIf the user asks you to remember something (like \"remember that I use Chrome\"), add a line right after SAY: REMEMBER: <what to remember>.";
    if (Array.isArray(modes) && modes.length) extra += "\n\nThe user also has custom modes. If one fits what is on screen better, set MODE to its exact name:\n" + modes.slice(0, 20).map((m) => `- ${String(m.name).slice(0, 40)} (apps: ${(m.apps || []).slice(0, 8).join(", ")}; sites: ${(m.sites || []).slice(0, 8).join(", ")})`).join("\n");
    if (modeId) {
      const { data: cm } = await auth.sb.from("mode_apps").select("name, prompt").eq("mode_id", String(modeId)).maybeSingle();
      if (cm?.prompt) extra += `\n\nRight now you are the user's "${cm.name}" mode. Follow it:\n${String(cm.prompt).slice(0, 2000)}`;
    }
    const base = {
      systemInstruction: { parts: [{ text: SYSTEM + extra }] },
      contents: [...past, { role: "user", parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    };
    const fast = { ...base, generationConfig: { ...base.generationConfig, thinkingConfig: { thinkingBudget: 0 } } };

    let res: Response | null = null;
    const errors: string[] = [];
    outer: for (const model of MODELS) {
      for (const body of [fast, base]) {
        if (Date.now() - t0 > BUDGET_MS) break outer;
        let r: Response;
        try {
          r = await gemini(model, body);
        } catch (e) {
          errors.push(`${model}: ${e instanceof Error && e.name === "AbortError" ? "took too long" : "could not connect"}`);
          continue outer;
        }
        if (r.ok && r.body) {
          res = r;
          console.log(`[live] ${model} started answering after ${Date.now() - t0}ms`);
          break outer;
        }
        const txt = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
        errors.push(`${model} ${r.status}: ${txt}`);
        if (r.status === 400) continue;
        if (r.status === 401 || r.status === 403) break outer;
        continue outer;
      }
    }

    if (!res || !res.body) {
      console.error("[live] no model answered:", errors.join(" | "));
      return Response.json({ error: "The AI is busy right now, try again in a moment. (" + (errors[errors.length - 1] || "no answer") + ")" }, { status: 502 });
    }
    return new Response(toText(res.body, (t) => save(auth, t)), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[live] crashed:", e);
    return Response.json({ error: "Live hit a server error: " + String(e instanceof Error ? e.message : e).slice(0, 160) }, { status: 500 });
  }
}

type Auth = { sb: ReturnType<typeof createServerClient>; userId: string };
const LIMIT = Number(process.env.LIVE_DAILY_LIMIT || 100);

async function session(): Promise<Auth | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return null;
  const store = await cookies();
  const sb = createServerClient(url, anon, { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data } = await sb.auth.getUser();
  return data.user ? { sb, userId: data.user.id } : null;
}

// Daily Live limit, counted from the history table
async function overLimit(a: Auth) {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  const { count, error } = await a.sb.from("live_history").select("id", { count: "exact", head: true }).eq("user_id", a.userId).gte("created_at", day.toISOString());
  return !error && (count ?? 0) >= LIMIT;
}

// Save the finished question + answer to Live history
async function save(a: Auth, full: string) {
  const cut = full.search(/^-{3,}\s*$/m);
  const head = cut >= 0 ? full.slice(0, cut) : "";
  const get = (k: string) => (head.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.*)$", "mi")) || [])[1]?.trim() || "";
  const answer = (cut >= 0 ? full.slice(cut).replace(/^-{3,}\s*\n?/, "") : full).trim();
  if (!answer) return;
  await a.sb.from("live_history").insert({
    user_id: a.userId,
    question: get("HEARD").slice(0, 500),
    answer: answer.slice(0, 20000),
    mode: get("MODE").toLowerCase().replace(/[^a-z]/g, "").slice(0, 20) || "buddy",
  });
}
