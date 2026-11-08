import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
const MODELS = ["gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash"];

async function signedIn() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return false;
  const store = await cookies();
  const sb = createServerClient(url, anon, { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  return !!(await sb.auth.getUser()).data.user;
}

// Quick transcript of what was said so far, for the live chatbox
export async function POST(req: Request) {
  try {
    if (!KEY || !(await signedIn().catch(() => false))) return Response.json({ text: "" }, { status: 401 });
    const { audio } = (await req.json().catch(() => ({}))) as { audio?: string };
    if (!audio) return Response.json({ text: "" });
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: audio } }, { text: "Transcribe exactly what is said. Reply with only the words. If nobody speaks, reply with nothing." }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 200 },
    });
    for (const model of MODELS) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body, signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = await r.json();
        return Response.json({ text: (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("").trim() });
      } catch { /* try the next model */ }
    }
    return Response.json({ text: "" });
  } catch {
    return Response.json({ text: "" });
  }
}
