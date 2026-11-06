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
const MODELS = [process.env.LIVE_MODEL, "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[];

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

function gemini(model: string, body: unknown) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify(body),
  });
}

export async function POST(req: Request) {
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
  let last = "";
  outer: for (const model of MODELS) {
    for (const body of [fast, base]) {
      const r = await gemini(model, body);
      if (r.ok && r.body) { res = r; break outer; }
      last = (await r.text().catch(() => "")).slice(0, 300);
      if (r.status === 404) continue outer;
      if (r.status !== 400) break outer;
    }
  }
  if (!res || !res.body) return Response.json({ error: "The AI could not answer right now. " + last }, { status: 502 });

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  const stream = new ReadableStream<Uint8Array>({
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
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
