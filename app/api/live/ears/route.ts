import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { GoogleGenAI } from "@google/genai";
import { EARS } from "../../../../lib/liveSystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
const LIMIT = Number(process.env.LIVE_DAILY_LIMIT || 100);
const DEFAULTS = ["gemini-live-2.5-flash-preview"];
const score = (n: string) => (/live/.test(n) ? 4 : 0) + (/flash/.test(n) ? 2 : 0) - (/preview|exp/.test(n) ? 1 : 0) - (/native-audio/.test(n) ? 10 : 0) + parseFloat((n.match(/(\d+(?:\.\d+)?)/) || [])[1] || "0");
let found: { at: number; list: string[] } | null = null;

// Which live (streaming) models this key can use, so new model names don't break anything
async function liveModels() {
  if (found && Date.now() - found.at < 3600000) return found.list;
  let list: string[] = [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": KEY }, signal: AbortSignal.timeout(4000) });
    const j = r.ok ? await r.json() : {};
    list = ((j.models || []) as { name: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => (m.supportedGenerationMethods || []).includes("bidiGenerateContent") && !/tts|image|gemini-2\.0/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort((x, y) => score(y) - score(x));
  } catch { /* use the defaults */ }
  found = { at: Date.now(), list: [...new Set([process.env.LIVE_STREAM_MODEL || "", ...list, ...DEFAULTS].filter((n) => n && !/gemini-2\.0/.test(n)))] };
  return found.list;
}

// A one-time pass so the Mac's "ears" can stream your voice to Google and get your words back
// as you talk (your real key never leaves the server)
export async function POST() {
  try {
    if (!KEY) return Response.json({ error: "no key" }, { status: 500 });
    const store = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
    );
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return Response.json({ error: "Please sign in" }, { status: 401 });
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const ai = new GoogleGenAI({ apiKey: KEY });
    const [count, token, models] = await Promise.all([
      Promise.resolve(sb.from("live_history").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).gte("created_at", day.toISOString())).then((r) => (r.error ? 0 : r.count || 0)).catch(() => 0),
      ai.authTokens.create({ config: { uses: 1, expireTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(), newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(), httpOptions: { apiVersion: "v1alpha" } } }),
      liveModels(),
    ]);
    if (count >= LIMIT) return Response.json({ error: "limit" }, { status: 429 });
    return Response.json({ token: token.name, models, system: EARS });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
