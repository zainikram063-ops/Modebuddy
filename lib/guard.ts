import { createClient as serverClient } from "@/lib/supabase/server";

type RPC = { rpc: (fn: string) => Promise<{ data: unknown; error: unknown }> };
const text = (msg: string, status: number) => new Response(msg, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/* Only signed-in users can use the API */
export async function requireUser(): Promise<Response | null> {
  const supabase = await serverClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? null : text("Please sign in again.", 401);
}

/* Chat: signed in, plus a daily free limit (people using their own API key aren't limited) */
export async function chatGuard(req: Request): Promise<Response | null> {
  const supabase = await serverClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return text("Please sign in again.", 401);
  const limit = Number(process.env.DAILY_MESSAGE_LIMIT ?? 100);
  if (!limit) return null;
  try {
    const body = await req.clone().json();
    if (body?.model?.apiKey) return null;
  } catch { /* not JSON */ }
  const { data: used, error } = await (supabase as unknown as RPC).rpc("bump_usage");
  if (error || typeof used !== "number" || used <= limit) return null;
  return text("You've used today's " + limit + " free messages. They reset at midnight UTC, or add your own API key in Settings to keep going.", 429);
}
