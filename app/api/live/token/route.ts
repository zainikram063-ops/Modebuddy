import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { GoogleGenAI } from "@google/genai";
import { SYSTEM } from "../../../../lib/liveSystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
const LIMIT = Number(process.env.LIVE_DAILY_LIMIT || 100);
const DEFAULTS = ["gemini-live-2.5-flash-preview", "gemini-2.0-flash-live-001"];
const score = (n: string) => (/live/.test(n) ? 4 : 0) + (/flash/.test(n) ? 2 : 0) - (/preview|exp/.test(n) ? 1 : 0) + parseFloat((n.match(/(\d+(?:\.\d+)?)/) || [])[1] || "0");
let found: { at: number; list: string[] } | null = null;

// Ask Google which live (streaming) models this key can use, so names changing doesn't break it
async function liveModels() {
  if (found && Date.now() - found.at < 3600000) return found.list;
  let list: string[] = [];
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", { headers: { "x-goog-api-key": KEY }, signal: AbortSignal.timeout(4000) });
    const j = r.ok ? await r.json() : {};
    list = ((j.models || []) as { name: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => (m.supportedGenerationMethods || []).includes("bidiGenerateContent") && !/native-audio|tts|image/i.test(m.name))
      .map((m) => m.name.replace(/^models\//, ""))
      .sort((x, y) => score(y) - score(x));
  } catch { /* use the defaults */ }
  found = { at: Date.now(), list: [...new Set([process.env.LIVE_STREAM_MODEL || "", ...list, ...DEFAULTS].filter(Boolean))] };
  return found.list;
}

// Gives the Mac a one-time pass to stream your voice to Gemini (your real key never leaves the server)
export async function POST(req: Request) {
  try {
    const store = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
    );
    const { data: u } = await sb.auth.getUser();
    if (!u.user || !KEY) return Response.json({ error: "Please sign in" }, { status: 401 });
    const { modes, modeId, installed } = (await req.json().catch(() => ({}))) as { modes?: { name: string; apps?: string[]; sites?: string[] }[]; modeId?: string; installed?: string[] };
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const [count, mem, cm] = await Promise.all([
      Promise.resolve(sb.from("live_history").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).gte("created_at", day.toISOString())).then((r) => (r.error ? 0 : r.count || 0)).catch(() => 0),
      Promise.resolve(sb.from("live_memory").select("data").eq("user_id", u.user.id).maybeSingle()).then((r) => (r.data?.data || {}) as { routines?: { name: string; triggers?: string[] }[]; facts?: string[] }).catch(() => ({} as { routines?: { name: string; triggers?: string[] }[]; facts?: string[] })),
      modeId ? Promise.resolve(sb.from("mode_apps").select("name, prompt").eq("mode_id", String(modeId)).maybeSingle()).then((r) => r.data).catch(() => null) : Promise.resolve(null),
    ]);
    if (count >= LIMIT) return Response.json({ error: "limit" }, { status: 429 });
    let extra = "\n\nYou get the user's screen as an image and their request as live audio. The moment they finish talking, answer in the format above.";
    if (Array.isArray(modes) && modes.length) extra += "\n\nThe user also has custom modes. If one fits what is on screen better, set MODE to its exact name:\n" + modes.slice(0, 20).map((m) => `- ${String(m.name).slice(0, 40)} (apps: ${(m.apps || []).slice(0, 8).join(", ")}; sites: ${(m.sites || []).slice(0, 8).join(", ")})`).join("\n");
    if (cm?.prompt) extra += `\n\nRight now you are the user's "${cm.name}" mode. Follow it:\n${String(cm.prompt).slice(0, 2000)}`;
    if (mem.facts?.length) extra += "\n\nWhat you know about this user (use it, and never ask them for things you already know):\n" + mem.facts.slice(0, 50).map((f) => "- " + f).join("\n");
    if (mem.routines?.length) extra += "\n\nThe user's routines (things they do often):\n" + mem.routines.slice(0, 25).map((r) => "- " + r.name + " (they might say: " + (r.triggers || []).slice(0, 5).join("; ") + ")").join("\n") + "\nIf what they ask matches one of these routines, even loosely (like \"start everything up\" or \"open my usual stuff\"), do NOT write DO. Instead add a line right after SAY: USE: <exact routine name>. Only write DO if they ask for something different or extra.";
    extra += "\n\nIf the user asks you to remember something (like \"remember that I use Chrome\"), add a line right after SAY: REMEMBER: <what to remember>.";
    if (Array.isArray(installed) && installed.length) extra += "\n\nApps installed on this Mac: " + installed.slice(0, 250).join(", ");
    const ai = new GoogleGenAI({ apiKey: KEY });
    const token = await ai.authTokens.create({
      config: { uses: 1, expireTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(), newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(), httpOptions: { apiVersion: "v1alpha" } },
    });
    return Response.json({ token: token.name, models: await liveModels(), system: SYSTEM + extra });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
