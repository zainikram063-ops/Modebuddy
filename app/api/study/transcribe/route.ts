import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const API = "https://api.assemblyai.com/v2";
const fail = (status: number, error: string) => Response.json({ error }, { status });

async function guard() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return { err: fail(401, "Please sign in again.") };
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return { err: fail(500, "Add ASSEMBLYAI_API_KEY to .env.local and restart the server.") };
  return { key };
}

export async function POST(req: Request) {
  const g = await guard();
  if (g.err) return g.err;
  const { url } = (await req.json().catch(() => ({}))) as { url?: string };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (typeof url !== "string" || !base || !url.startsWith(base)) return fail(400, "Invalid file.");

  const r = await fetch(`${API}/transcript`, {
    method: "POST",
    headers: { authorization: g.key!, "content-type": "application/json" },
    body: JSON.stringify({ audio_url: url, language_detection: true, punctuate: true, format_text: true }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; error?: string };
  if (r.status === 401) return fail(401, "AssemblyAI rejected the API key. Check ASSEMBLYAI_API_KEY in .env.local.");
  if (!r.ok || !j.id) return fail(502, j.error ?? "Couldn't start transcription.");
  return Response.json({ id: j.id });
}

export async function GET(req: Request) {
  const g = await guard();
  if (g.err) return g.err;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[\w-]+$/.test(id)) return fail(400, "Bad id.");

  const r = await fetch(`${API}/transcript/${id}`, { headers: { authorization: g.key! }, cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as { status?: string; text?: string; error?: string; audio_duration?: number };
  if (!r.ok) return fail(502, j.error ?? "Couldn't check the transcription.");
  return Response.json({
    status: j.status,
    text: j.status === "completed" ? j.text ?? "" : undefined,
    error: j.status === "error" ? j.error ?? "Transcription failed." : undefined,
    duration: j.audio_duration ?? null,
  });
}
