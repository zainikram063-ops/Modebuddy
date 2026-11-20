import { requestKey } from "@/lib/userKey";
import { liveLimit, limitMessage } from "@/lib/limits";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SYSTEM, liveContext, type CustomMode, type LiveMem } from "../../../lib/liveSystem";
import { liveModels } from "../../../lib/platform";
import { tierOf } from "../../../lib/models";
import { reflex, correction } from "../../../lib/live/reflex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;


const LIMIT = Number(process.env.LIVE_DAILY_LIMIT || 100);
// Requests that sound like "do something on my Mac" get a little thinking time
const TASKY = /\b(open|launch|start|go to|search|google|look up|find|type|write|click|press|play|close|switch|send|show me|take me)\b/i;

type Turn = { q?: string; a?: string };
type Body = { text?: string; audio?: string; image?: string | null; history?: Turn[]; modes?: CustomMode[]; modeId?: string; installed?: string[]; app?: string; log?: boolean; answer?: string };
type SB = ReturnType<typeof createServerClient>;

// The smart brain: the newest Gemini Flash this key can use, with backups (never a retired 2.0 model)
async function brains() {
  const ids = (await liveModels().catch(() => [])).map((m) => m.id);
  const flash = ids.filter((id) => tierOf(id) === 1).slice(0, 2);
  const lite = ids.filter((id) => tierOf(id) === 0).slice(0, 1);
  return [...new Set([process.env.LIVE_MODEL || "", ...flash, "gemini-3-flash-preview", "gemini-flash-latest", ...lite, "gemini-flash-lite-latest"].filter((n) => n && !/gemini-[12]\./.test(n)))];
}

// Think as little as possible so the answer starts right away; tasks get a little more for better plans
function thinking(model: string, task: boolean): (Record<string, unknown> | null)[] {
  if (/gemini-2\.5/.test(model)) return [{ thinkingBudget: task ? 512 : 0 }, null];
  return task ? [{ thinkingLevel: "low" }, null] : [{ thinkingLevel: "minimal" }, { thinkingLevel: "low" }, null];
}

// One try at one model; gives up if it hasn't started answering in 15 seconds
async function gemini(model: string, body: unknown) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": (await requestKey()) },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Turns Gemini's stream into plain text for the latch
function toText(body: ReadableStream<Uint8Array>, onDone: (full: string) => Promise<void>) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "", full = "";
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { value, done } = await reader.read();
      if (done) { await onDone(full).catch(() => {}); ctrl.close(); return; }
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

// Pressing ⌘⌥ wakes this up, so it is ready the moment you let go
export async function GET() {
  await brains().catch(() => []);
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    if (!(await requestKey())) return Response.json({ error: "Add your free Gemini key in ModeBuddy first: open the model menu and tap “Add your free Gemini key”." }, { status: 400 });
    const mbLimit = await liveLimit();
    if (!mbLimit.ok) return Response.json({ error: limitMessage("buddy", mbLimit.resetAt) }, { status: 429 });
    const b = (await req.json().catch(() => ({}))) as Body;
    const words = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!words && !b.audio) return Response.json({ error: "I did not catch that. Hold ⌘⌥ and try again." }, { status: 400 });
    // Look up the AI models in the background: reflexes don't need them, and a slow answer from Google can't hold anything up
    const modelsP = Promise.race([brains().catch((): string[] => []), new Promise<string[]>((ok) => setTimeout(() => ok([]), 2500))]).then((m) => (m.length ? m : ["gemini-3-flash-preview", "gemini-flash-latest", "gemini-flash-lite-latest"]));
    const a = await who();
    const tAuth = Date.now() - t0;
    if (!a) return Response.json({ error: "Please sign in to ModeBuddy first." }, { status: 401 });
    // A simple command already done on the Mac: just save it to Live history
    if (b.log) { await save(a.sb, a.uid, words, String(b.answer || "")).catch(() => {}); return new Response(null, { status: 204 }); }
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const [count, mem, mode] = await Promise.all([
      Promise.resolve(a.sb.from("live_history").select("id", { count: "exact", head: true }).eq("user_id", a.uid).gte("created_at", day.toISOString())).then((r) => (r.error ? 0 : r.count || 0)).catch(() => 0),
      Promise.resolve(a.sb.from("live_memory").select("data").eq("user_id", a.uid).maybeSingle()).then((r): LiveMem => (r.data?.data || {}) as LiveMem).catch((): LiveMem => ({})),
      b.modeId ? Promise.resolve(a.sb.from("mode_apps").select("name, prompt").eq("mode_id", String(b.modeId)).maybeSingle()).then((r) => (r.data ? { name: String(r.data.name), prompt: String(r.data.prompt || "") } : null)).catch(() => null) : Promise.resolve(null),
    ]);
    if (count >= LIMIT) return Response.json({ error: "You have used all of today's Live questions. They reset at midnight (UTC)." }, { status: 429 });
    const installed = Array.isArray(b.installed) ? b.installed.map(String) : [];
    // Learning from mistakes: "no, I meant Chrome" right after "open browser" teaches ModeBuddy for next time
    const prev = String((Array.isArray(b.history) ? b.history : []).slice(-1)[0]?.q || "");
    const fix = words ? correction(words, prev) : null;
    if (fix) {
      const facts = [`When I say "${fix.heard}" I mean "${fix.meant}".`, ...(mem.facts || []).filter((f) => !String(f).startsWith(`When I say "${fix.heard}"`))].slice(0, 50);
      const redo = reflex(fix.command, installed, mem.routines || [], facts);
      if (redo?.steps) {
        const data = { ...mem, facts };
        const has = await a.sb.from("live_memory").select("user_id").eq("user_id", a.uid).maybeSingle();
        await (has.data ? a.sb.from("live_memory").update({ data }).eq("user_id", a.uid) : a.sb.from("live_memory").insert({ user_id: a.uid, data }));
        const say = "Got it, " + redo.say.charAt(0).toLowerCase() + redo.say.slice(1) + " I'll remember that.";
        const full = `DO: ${JSON.stringify(redo.steps)}\nSAY: ${say}\n---\nGot it. From now on, "${fix.heard}" means ${fix.meant}.`;
        save(a.sb, a.uid, words, full).catch(() => {});
        return new Response(full, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Live-Model": "reflex", "X-Live-Learned": "1" } });
      }
    }

    // Reflexes: common commands are answered instantly, without the AI
    const hit = words ? reflex(words, installed, mem.routines || [], mem.facts || []) : null;
    if (hit) {
      const full = (hit.use ? `SAY: ${hit.say}\nUSE: ${hit.use}\n` : `SAY: ${hit.say}\nDO: ${JSON.stringify(hit.steps || [])}\n`) + `---\n${hit.say}`;
      save(a.sb, a.uid, words, full).catch(() => {});
      console.log(`[live] reflex after ${Date.now() - t0}ms (sign-in ${tAuth}ms): ${words}`);
      return new Response(full, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Live-Model": "reflex" } });
    }

    const task = !words || TASKY.test(words);
    const past = (Array.isArray(b.history) ? b.history : []).slice(-4).flatMap((t) => [
      { role: "user", parts: [{ text: String(t.q || "(question)").slice(0, 2000) }] },
      { role: "model", parts: [{ text: String(t.a || "").slice(0, 6000) }] },
    ]);
    // Only the apps that match what you said (not the whole list), so the AI starts sooner
    const keys = words.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    const near = words ? installed.filter((n) => keys.some((w) => n.toLowerCase().includes(w))).slice(0, 20) : installed.slice(0, 250);
    const about = (b.app ? `\nApp in front: ${String(b.app).slice(0, 60)}` : "") + (task && near.length ? "\nInstalled apps: " + near.join(", ") : "");
    const parts: Record<string, unknown>[] = [];
    if (b.image) parts.push({ inlineData: { mimeType: "image/jpeg", data: b.image } });
    if (words) parts.push({ text: (b.image ? "This is my screen right now.\n" : "") + `What I said (from speech, may have small mistakes): "${words}"` + about });
    else parts.push({ inlineData: { mimeType: "audio/wav", data: b.audio } }, { text: (b.image ? "This is my screen right now. " : "") + "My request is in the recording." + about });
    const base = {
      systemInstruction: { parts: [{ text: SYSTEM + liveContext(mem, b.modes, mode) }] },
      contents: [...past, { role: "user", parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 },
    };

    const models = await modelsP;
    let res: Response | null = null;
    let used = "";
    const errors: string[] = [];
    outer: for (const model of models) {
      for (const tc of thinking(model, task)) {
        if (Date.now() - t0 > 40000) break outer;
        const body = tc ? { ...base, generationConfig: { ...base.generationConfig, thinkingConfig: tc } } : base;
        let r: Response;
        try {
          r = await gemini(model, body);
        } catch (e) {
          errors.push(`${model}: ${e instanceof Error && e.name === "AbortError" ? "took too long" : "could not connect"}`);
          continue outer;
        }
        if (r.ok && r.body) { res = r; used = model; break outer; }
        errors.push(`${model} ${r.status}: ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160)}`);
        if (r.status === 400) continue;
        if (r.status === 401 || r.status === 403) break outer;
        continue outer;
      }
    }
    if (!res || !res.body) {
      console.error("[live] no model answered:", errors.join(" | "));
      return Response.json({ error: "The AI is busy right now, try again in a moment. (" + (errors[errors.length - 1] || "no answer") + ")" }, { status: 502 });
    }
    console.log(`[live] ${used} started answering after ${Date.now() - t0}ms`);
    return new Response(toText(res.body, (full) => save(a.sb, a.uid, words, full)), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Live-Model": used },
    });
  } catch (e) {
    console.error("[live] crashed:", e);
    return Response.json({ error: "Live hit a server error: " + String(e instanceof Error ? e.message : e).slice(0, 160) }, { status: 500 });
  }
}

async function who(): Promise<{ sb: SB; uid: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return null;
  const store = await cookies();
  const sb = createServerClient(url, anon, { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const { data } = await sb.auth.getUser();
  return data.user ? { sb, uid: data.user.id } : null;
}

// Saves the question and answer to Live history
async function save(sb: SB, uid: string, words: string, full: string) {
  const cut = full.search(/^-{3,}\s*$/m);
  const head = cut >= 0 ? full.slice(0, cut) : "";
  const get = (k: string) => (head.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.*)$", "mi")) || [])[1]?.trim() || "";
  const answer = (cut >= 0 ? full.slice(cut).replace(/^-{3,}\s*\n?/, "") : full).trim();
  if (!answer) return;
  await sb.from("live_history").insert({
    user_id: uid,
    question: (words || get("HEARD")).slice(0, 500),
    answer: answer.slice(0, 20000),
    mode: get("MODE").toLowerCase().replace(/[^a-z]/g, "").slice(0, 20) || "buddy",
  });
}
