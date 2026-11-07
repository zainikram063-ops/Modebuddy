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
MODE: <code, study or general>
SAY: <one or two short, friendly sentences to read out loud. No markdown, no code, no lists.>
---
<the full answer in Markdown>

Rules:
- Look carefully at the screenshot and answer about what is on screen.
- MODE is code for coding apps, terminals and developer websites, study for notes, homework and learning, otherwise general.
- Be concise and practical. Use short paragraphs or bullet points.
- If they want something they can paste (a prompt, code, a message, a fix), put exactly that text in ONE fenced code block.
- If the audio is silent or unclear, set HEARD to (nothing) and kindly ask them to hold Command and Option and try again.`;

type Turn = { q?: string; a?: string };

async function signedIn() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return false;
  const store = await cookies();
  const sb = createServerClient(url, anon, { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data } = await sb.auth.getUser();
  return !!data.user;
}

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
function toText(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) { ctrl.close(); return; }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const j = JSON.parse(line.slice(5));
          for (const p of j.candidates?.[0]?.content?.parts || []) if (p.text && !p.thought) ctrl.enqueue(enc.encode(p.text));
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
    if (!(await signedIn().catch(() => false))) return Response.json({ error: "Please sign in to ModeBuddy first." }, { status: 401 });

    const { audio, image, history } = (await req.json().catch(() => ({}))) as { audio?: string; image?: string | null; history?: Turn[] };
    if (!audio) return Response.json({ error: "I did not catch any audio. Try again." }, { status: 400 });

    const past = (Array.isArray(history) ? history : []).slice(-4).flatMap((t) => [
      { role: "user", parts: [{ text: String(t.q || "(question)").slice(0, 2000) }] },
      { role: "model", parts: [{ text: String(t.a || "").slice(0, 6000) }] },
    ]);
    const parts: Record<string, unknown>[] = [];
    if (image) parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
    parts.push({ inlineData: { mimeType: "audio/wav", data: audio } });
    parts.push({ text: image ? "This is my screen right now. My request is in the audio." : "My request is in the audio. No screenshot was available." });

    const base = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [...past, { role: "user", parts }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
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
    return new Response(toText(res.body), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[live] crashed:", e);
    return Response.json({ error: "Live hit a server error: " + String(e instanceof Error ? e.message : e).slice(0, 160) }, { status: 500 });
  }
}
