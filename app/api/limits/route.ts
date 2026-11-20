import type { SupabaseClient } from "@supabase/supabase-js";
import { readLimits, userDb } from "@/lib/limits";

export const dynamic = "force-dynamic";

/* How many free messages are left for Buddy and Kodra */
export async function GET() {
  try {
    const { sb, user } = await userDb();
    if (!user) return Response.json({});
    return Response.json(await readLimits(sb as unknown as SupabaseClient, user.id));
  } catch {
    return Response.json({});
  }
}
