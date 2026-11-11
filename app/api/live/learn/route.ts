import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
type Routine = { name: string; triggers?: string[]; steps?: unknown[]; uses?: number; last?: string };
type Mem = { routines: Routine[]; facts: string[] };
type SB = ReturnType<typeof createServerClient>;

async function client(): Promise<{ sb: SB; uid: string } | null> {
  const store = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
  );
  const { data } = await sb.auth.getUser();
  return data.user ? { sb, uid: data.user.id } : null;
}
async function load(sb: SB, uid: string): Promise<Mem> {
  const { data } = await sb.from("live_memory").select("data").eq("user_id", uid).maybeSingle();
  const d = (data?.data || {}) as Partial<Mem>;
  return { routines: Array.isArray(d.routines) ? d.routines : [], facts: Array.isArray(d.facts) ? d.facts.map(String) : [] };
}
const save = (sb: SB, uid: string, m: Mem) => sb.from("live_memory").upsert({ user_id: uid, data: m, updated_at: new Date().toISOString() });

const RULES = `You keep ModeBuddy's memory about one user, so it can do their usual things instantly without asking them anything.
You get the current memory and something new: a task ModeBuddy just finished (with the exact steps that worked), or a note the user asked you to remember.
Reply with the full updated memory as JSON only: {"routines": [{"name": "short name", "triggers": ["ways they might ask for it"], "steps": [steps], "uses": 1}], "facts": ["short facts"]}.
- A routine is something they will likely do again: opening their usual apps, sites, folders or projects, or setting things up a certain way. Save tasks like that as routines, even the first time.
- If the new task is the same as or similar to an existing routine, update that routine with the latest steps that worked, add the new way they asked to triggers, and add 1 to uses. Never make duplicates.
- Always include general triggers for setup routines too, like "start everything up" or "open my usual stuff".
- One-off tasks (like a single question or a one-time search) are not routines, but you can still learn facts from them.
- Facts are short preferences and details: which browser and apps they use, their project and folder names and paths, their usual settings, how they like prompts written. Update facts that changed and remove ones that are wrong.
- Keep steps exactly as given. Keep at most 25 routines and 50 facts.`;

export async function GET() {
  const c = await client();
  if (!c) return Response.json({ routines: [], facts: [] }, { status: 401 });
  return Response.json(await load(c.sb, c.uid));
}

export async function PUT(req: Request) {
  const c = await client();
  if (!c) return Response.json({ routines: [], facts: [] }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Partial<Mem>;
  const m: Mem = { routines: Array.isArray(b.routines) ? b.routines.slice(0, 25) : [], facts: Array.isArray(b.facts) ? b.facts.map(String).slice(0, 50) : [] };
  await save(c.sb, c.uid, m);
  return Response.json(m);
}

export async function POST(req: Request) {
  const c = await client();
  if (!c) return Response.json({ routines: [], facts: [] }, { status: 401 });
  const { goal, steps, note, routine } = (await req.json().catch(() => ({}))) as { goal?: string; steps?: unknown[]; note?: string; routine?: string };
  const mem = await load(c.sb, c.uid);
  // A routine that ran cleanly again: just count it
  if (routine && !note) {
    const r = mem.routines.find((x) => x.name === routine);
    if (r) { r.uses = (r.uses || 0) + 1; r.last = new Date().toISOString(); await save(c.sb, c.uid, mem); return Response.json(mem); }
  }
  const text = `Current memory:\n${JSON.stringify(mem).slice(0, 20000)}\n\n` + (note
    ? `The user asked ModeBuddy to remember: ${String(note).slice(0, 1000)}`
    : `Task just finished: ${String(goal || "").slice(0, 1000)}\nSteps that worked: ${JSON.stringify(steps || []).slice(0, 8000)}`);
  for (const model of ["gemini-2.5-flash", "gemini-flash-latest"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: RULES }] }, contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 512 } } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const t = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string; thought?: boolean }) => (p.thought ? "" : p.text || "")).join("");
      const o = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
      const next: Mem = { routines: Array.isArray(o.routines) ? o.routines.slice(0, 25) : mem.routines, facts: Array.isArray(o.facts) ? o.facts.map(String).slice(0, 50) : mem.facts };
      for (const x of next.routines) x.last = x.last || new Date().toISOString();
      await save(c.sb, c.uid, next);
      return Response.json(next);
    } catch { /* try the next model */ }
  }
  return Response.json(mem);
}
