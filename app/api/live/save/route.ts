import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Saves a streamed Live answer to Live history
export async function POST(req: Request) {
  try {
    const store = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
    );
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return Response.json({ ok: false }, { status: 401 });
    const { full } = (await req.json().catch(() => ({}))) as { full?: string };
    const text = String(full || "");
    const cut = text.search(/^-{3,}\s*$/m);
    const head = cut >= 0 ? text.slice(0, cut) : "";
    const get = (k: string) => (head.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.*)$", "mi")) || [])[1]?.trim() || "";
    const answer = (cut >= 0 ? text.slice(cut).replace(/^-{3,}\s*\n?/, "") : text).trim();
    if (!answer) return Response.json({ ok: false });
    await sb.from("live_history").insert({
      user_id: u.user.id,
      question: get("HEARD").slice(0, 500),
      answer: answer.slice(0, 20000),
      mode: get("MODE").toLowerCase().replace(/[^a-z]/g, "").slice(0, 20) || "buddy",
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false });
  }
}
