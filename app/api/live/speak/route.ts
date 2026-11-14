import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EL = process.env.ELEVENLABS_API_KEY || "";
const FISH = process.env.FISH_AUDIO_API_KEY || process.env.FISH_API_KEY || "";
const VOICE = process.env.TTS_VOICE_ID || "";

// Streams the spoken answer from ElevenLabs or Fish Audio.
// With no text it just answers "is a cloud voice set up?" (204 yes, 404 no) and wakes this up.
export async function GET(req: Request) {
  const text = (new URL(req.url).searchParams.get("t") || "").slice(0, 600);
  if (!text) return new Response(null, { status: EL || FISH ? 204 : 404, headers: { "Cache-Control": "no-store" } });
  if (!EL && !FISH) return new Response(null, { status: 404 });
  const store = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
  );
  if (!(await sb.auth.getUser()).data.user) return new Response(null, { status: 401 });
  const fish = (process.env.TTS_PROVIDER || (EL ? "elevenlabs" : "fish")).toLowerCase().startsWith("fish");
  const r = fish
    ? await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: { Authorization: `Bearer ${FISH}`, "Content-Type": "application/json", model: process.env.FISH_MODEL || "s1" },
        body: JSON.stringify({ text, reference_id: VOICE || undefined, format: "mp3", latency: "balanced" }),
      })
    : await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE || "21m00Tcm4TlvDq8ikWAM"}/stream?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": EL, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5" }),
      });
  if (!r.ok || !r.body) return new Response(null, { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
