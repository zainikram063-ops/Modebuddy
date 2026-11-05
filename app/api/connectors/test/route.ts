import { createClient } from "@/lib/supabase/server";
import { connectMCP } from "@/lib/mcp";
import type { Connector } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ ok: false, error: "Sign in again." }, { status: 401 });

  let client: Awaited<ReturnType<typeof connectMCP>> | undefined;
  try {
    const { connector } = (await req.json()) as { connector: Connector };
    client = await connectMCP(connector);
    const tools = await client.tools();
    const list = Object.entries(tools).map(([name, t]) => ({ name, description: (t as { description?: string }).description ?? "" }));
    return Response.json({ ok: true, tools: list });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message || "Couldn't connect." });
  } finally {
    await client?.close().catch(() => {});
  }
}
