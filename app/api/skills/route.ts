import type { SupabaseClient } from "@supabase/supabase-js";
import { userDb } from "@/lib/limits";

export const dynamic = "force-dynamic";

const MODES = ["any", "buddy", "kodra", "edura"];
const COLS = "id,name,icon,mode,when_to_use,instructions,enabled,created_at";
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function me() {
  const { sb, user } = await userDb();
  return { db: sb as unknown as SupabaseClient, user };
}

/* The skills this user made */
export async function GET() {
  try {
    const { db, user } = await me();
    if (!user) return Response.json([]);
    const { data, error } = await db.from("skills").select(COLS).order("created_at");
    if (error) return Response.json({ error: "setup" }, { status: 503 });
    return Response.json(data ?? []);
  } catch {
    return Response.json([]);
  }
}

/* Create or update a skill */
export async function POST(req: Request) {
  const { db, user } = await me();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: "Bad request." }, { status: 400 }); }
  const row = {
    name: clean(b.name, 60),
    icon: /^[a-z]{2,12}$/.test(String(b.icon)) ? String(b.icon) : "spark",
    mode: MODES.includes(String(b.mode)) ? String(b.mode) : "any",
    when_to_use: clean(b.when_to_use, 300),
    instructions: clean(b.instructions, 8000),
    enabled: b.enabled !== false,
  };
  if (row.name.length < 2 || row.when_to_use.length < 5 || row.instructions.length < 10)
    return Response.json({ error: "Add a name, when to use it, and the instructions." }, { status: 400 });
  const id = typeof b.id === "string" ? b.id : "";
  const q = id
    ? db.from("skills").update(row).eq("id", id).select(COLS).single()
    : db.from("skills").insert({ ...row, user_id: user.id }).select(COLS).single();
  const { data, error } = await q;
  if (error) return Response.json({ error: /relation|does not exist|schema cache/i.test(error.message) ? "setup" : "Couldn't save that skill." }, { status: 400 });
  return Response.json(data);
}

/* Delete a skill */
export async function DELETE(req: Request) {
  const { db, user } = await me();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
  await db.from("skills").delete().eq("id", id);
  return Response.json({ ok: true });
}
