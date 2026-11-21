import { createClient } from "@supabase/supabase-js";
import { userDb } from "@/lib/limits";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
type Conv = { user_id: string; mode_id: string | null; updated_at: string | null; created_at?: string | null };
type Msg = { user_id: string; created_at: string };
type Ev = { user_id: string; bucket: string; created_at: string };
type Res = { data: unknown; error: unknown };
const MODE_NAME: Record<string, string> = { default: "Buddy", code: "Kodra", study: "Edura" };
const admins = () => (process.env.ADMIN_EMAIL || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);

/* Reads rows in pages of 1000 (Supabase's limit per request). null if the table or column doesn't exist. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<Res>, maxPages = 50): Promise<T[] | null> {
  const out: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await page(p * 1000, p * 1000 + 999);
    if (error) return p ? out : null;
    const list = (data ?? []) as T[];
    out.push(...list);
    if (list.length < 1000) break;
  }
  return out;
}

/* Private stats for the owner only (ADMIN_EMAIL). Uses the service key on the server, never in the browser. */
export async function GET() {
  const { user } = await userDb();
  if (!user?.email || !admins().includes(user.email.toLowerCase())) return new Response("Not found", { status: 404 });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return Response.json({ error: "Add SUPABASE_SERVICE_ROLE_KEY in Vercel, then redeploy." }, { status: 500 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "", key, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = Date.now();
  const since7 = new Date(now - 7 * DAY).toISOString();

  const users: { id: string; email: string; created_at: string; last_sign_in_at: string | null }[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) break;
    for (const u of data.users) users.push({ id: u.id, email: u.email ?? "", created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null });
    if (data.users.length < 1000) break;
  }

  const [convos, msgs, events, skills, totalMsgs] = await Promise.all([
    fetchAll<Conv>((a, b) => db.from("conversations").select("user_id,mode_id,updated_at,created_at").range(a, b))
      .then((r) => r ?? fetchAll<Conv>((a, b) => db.from("conversations").select("user_id,mode_id,updated_at").range(a, b))),
    fetchAll<Msg>((a, b) => db.from("messages").select("user_id,created_at").eq("role", "user").gte("created_at", since7).range(a, b)),
    fetchAll<Ev>((a, b) => db.from("usage_events").select("user_id,bucket,created_at").gte("created_at", since7).range(a, b)),
    fetchAll<{ user_id: string }>((a, b) => db.from("skills").select("user_id").range(a, b)),
    db.from("messages").select("id", { count: "exact", head: true }).then((r) => r.count ?? null, () => null),
  ]);

  const dkey = (t: number | string) => new Date(t).toISOString().slice(0, 10);
  const today = dkey(now);
  const signups = Array.from({ length: 14 }, (_, i) => {
    const d = dkey(now - (13 - i) * DAY);
    return { day: d, n: users.filter((u) => dkey(u.created_at) === d).length };
  });
  const conv = convos ?? [];
  const chatted = new Set(conv.map((c) => c.user_id));
  const act = msgs
    ? msgs.map((m) => ({ user_id: m.user_id, at: m.created_at }))
    : conv.filter((c) => c.updated_at && c.updated_at >= since7).map((c) => ({ user_id: c.user_id, at: c.updated_at as string }));
  const days = new Map<string, Set<string>>();
  for (const a of act) {
    const set = days.get(a.user_id) ?? new Set<string>();
    set.add(dkey(a.at));
    days.set(a.user_id, set);
  }
  const ev = events ?? [];
  const countB = (b: string) => ev.filter((e) => e.bucket === b).length;
  const usersB = (b: string) => new Set(ev.filter((e) => e.bucket === b).map((e) => e.user_id)).size;
  const skillUse = new Map<string, number>();
  for (const e of ev) if (e.bucket.startsWith("skill:")) skillUse.set(e.bucket.slice(6), (skillUse.get(e.bucket.slice(6)) || 0) + 1);
  const modes = new Map<string, number>();
  for (const c of conv) {
    const at = c.created_at || c.updated_at;
    if (at && at >= since7) { const m = MODE_NAME[c.mode_id || "default"] || "Custom modes"; modes.set(m, (modes.get(m) || 0) + 1); }
  }
  const chatsBy = new Map<string, number>(), lastBy = new Map<string, string>();
  for (const c of conv) {
    chatsBy.set(c.user_id, (chatsBy.get(c.user_id) || 0) + 1);
    if (c.updated_at && c.updated_at > (lastBy.get(c.user_id) || "")) lastBy.set(c.user_id, c.updated_at);
  }
  const recent = [...users].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30)
    .map((u) => ({ email: u.email, joined: u.created_at, lastSeen: lastBy.get(u.id) || u.last_sign_in_at, chats: chatsBy.get(u.id) || 0 }));

  return Response.json({
    at: new Date().toISOString(),
    users: { total: users.length, today: users.filter((u) => dkey(u.created_at) === today).length, week: users.filter((u) => Date.parse(u.created_at) > now - 7 * DAY).length, signups },
    chatted: chatted.size,
    active: {
      today: new Set(act.filter((a) => Date.parse(a.at) > now - DAY).map((a) => a.user_id)).size,
      week: days.size,
      returning: [...days.values()].filter((s) => s.size >= 2).length,
      source: msgs ? "messages" : "chats",
    },
    usage: { buddy: countB("buddy"), kodra: countB("kodra"), live: countB("live"), totalMessages: totalMsgs, chatsByMode: [...modes].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n) },
    limits: { buddy: { times: countB("buddy-blocked"), people: usersB("buddy-blocked") }, kodra: { times: countB("kodra-blocked"), people: usersB("kodra-blocked") } },
    skills: { top: [...skillUse].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n).slice(0, 10), custom: skills ? skills.length : null, customPeople: skills ? new Set(skills.map((s) => s.user_id)).size : null },
    recent,
  });
}
