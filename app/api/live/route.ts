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

const SYSTEM = `You are ModeBuddy Live, an assistant that pops up over the user's screen on their Mac.
You receive a screenshot of their screen and a voice recording of their request.

Reply in EXACTLY this format:
HEARD: <their request in a few words>
MODE: <code, study or buddy>
SAY: <one or two short, friendly sentences to read out loud. No markdown, no code, no lists.>
---
<the full answer in Markdown>

Rules:
- Look carefully at the screenshot and answer about what is on screen.
- MODE is code for coding apps, terminals and developer websites, study for notes, homework and learning, otherwise buddy.
- Be concise and practical. Use short paragraphs or bullet points.
- If they want something they can paste (a prompt, code, a message, a fix), put exactly that text in ONE fenced code block.
- HEARD must be exactly what they said, word for word. Never guess or add words. If a part is unclear, write [unclear] there.
- If an important detail of a task is unclear, do not add a DO line. Ask them to repeat that part in SAY instead.
- If the audio is silent or unclear, set HEARD to (nothing) and kindly ask them to hold Command and Option and try again.

If the user asks you to DO something on their Mac (open apps or websites, search, write and send a prompt, click something), add a DO line right after SAY with a JSON array of steps, all on ONE line, for example:
DO: [{"do":"open_app","app":"Claude"},{"do":"type","text":"the full prompt"},{"do":"key","keys":"enter"},{"do":"open_url","app":"Google Chrome","url":"https://www.google.com/search?q=modebuddy.vercel.app"}]
Steps: open_app {app}, open_url {url, app optional}, find {name, kind: "folder" or "file"} (searches the Mac for real files and folders), open_path {path} (only a path that find returned), type {text}, key {keys like "enter", "tab", "cmd+t", "cmd+l", "cmd+n"}, click {target: what to click in a few words}, wait {ms}.
- Use exact app names from the installed apps list. Search the web with open_url and a Google search link. Only use click when there is no keyboard way.
- When asked to write a prompt, put a complete, high quality prompt in the type step. Put all of it in one type step.
- Never delete files, buy things, or send emails or messages unless the user clearly asked for it.
- With DO, keep SAY short (like "On it, opening Claude now.") and after --- list the steps as a few short bullet points.`;

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
    if (await overLimit(auth).catch(() => false)) return Response.json({ error: "You have used all of today's Live questions. They reset at midnight (UTC)." }, { status: 429 });

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
