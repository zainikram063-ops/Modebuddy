import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/* Free plan: Buddy and Kodra have a message limit over the last few hours. Edura has none. */
export const LIMITS = { buddy: { max: 40, hours: 5 }, kodra: { max: 25, hours: 5 } } as const;
export type Bucket = keyof typeof LIMITS;
type Spend = { ok: boolean; left: number; max: number; resetAt: string | null };

/* The Gemini model each mode uses on the free plan. If a key can't use it, the next best one answers. */
export const FREE_MODELS = { kodra: "gemini-3-pro-preview", lite: "gemini-flash-lite-latest" };
export const freeModelFor = (modeId: string) => (modeId === "code" ? FREE_MODELS.kodra : FREE_MODELS.lite);
export const bucketFor = (modeId: string): Bucket | null => (modeId === "study" ? null : modeId === "code" ? "kodra" : "buddy");

async function peek(db: SupabaseClient, userId: string, bucket: Bucket): Promise<Spend | null> {
  const { max, hours } = LIMITS[bucket];
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data, error } = await db.from("usage_events").select("created_at")
    .eq("user_id", userId).eq("bucket", bucket).gte("created_at", since)
    .order("created_at", { ascending: true }).limit(max);
  if (error) return null; // usage table not set up yet: nobody gets blocked
  const rows = (data ?? []) as { created_at: string }[];
  const resetAt = rows.length ? new Date(new Date(rows[0].created_at).getTime() + hours * 3_600_000).toISOString() : null;
  return { ok: rows.length < max, left: Math.max(0, max - rows.length), max, resetAt };
}

/* Counts one message if there's room */
export async function spendLimit(db: SupabaseClient, userId: string, bucket: Bucket): Promise<Spend> {
  const now = await peek(db, userId, bucket);
  if (!now) return { ok: true, left: LIMITS[bucket].max, max: LIMITS[bucket].max, resetAt: null };
  if (!now.ok) { await db.from("usage_events").insert({ user_id: userId, bucket: bucket + "-blocked" }); return now; }
  await db.from("usage_events").insert({ user_id: userId, bucket });
  return { ...now, left: now.left - 1 };
}

export async function readLimits(db: SupabaseClient, userId: string) {
  const out: Partial<Record<Bucket, Spend>> = {};
  for (const b of Object.keys(LIMITS) as Bucket[]) { const s = await peek(db, userId, b); if (s) out[b] = s; }
  return out;
}

export function limitMessage(bucket: Bucket, resetAt: string | null) {
  const { max, hours } = LIMITS[bucket];
  const mins = resetAt ? Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 60_000)) : hours * 60;
  const when = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return `You've used your ${max} ${bucket === "kodra" ? "Kodra" : "Buddy"} messages for now. More in ${when}. Edura has no limit, so studying never stops.`;
}

/* The signed-in user and a database client for them, from their login cookies */
export async function userDb() {
  const store = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } },
  );
  const { data } = await sb.auth.getUser();
  return { sb, user: data.user };
}

/* Live (Command + Option) counts toward Buddy's limit */
export async function liveLimit(): Promise<Spend> {
  const open: Spend = { ok: true, left: LIMITS.buddy.max, max: LIMITS.buddy.max, resetAt: null };
  try {
    const { sb, user } = await userDb();
    if (!user) return open;
    const db = sb as unknown as SupabaseClient;
    const res = await spendLimit(db, user.id, "buddy");
    if (res.ok) await db.from("usage_events").insert({ user_id: user.id, bucket: "live" });
    return res;
  } catch {
    return open;
  }
}
