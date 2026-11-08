import Link from "next/link";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const dynamic = "force-dynamic";

export default async function LiveHistory() {
  const store = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
  );
  const { data } = await sb.from("live_history").select("id, question, answer, mode, created_at").order("created_at", { ascending: false }).limit(100);
  const rows = data || [];
  return (
    <div className="legal-wrap">
      <main className="legal lv-hist">
        <h1>Live history</h1>
        <p>Everything you asked ModeBuddy Live. Click one to see the answer.</p>
        {rows.length === 0 && <p>Nothing yet. Hold ⌘⌥ anywhere on your Mac and ask something.</p>}
        {rows.map((r) => (
          <details key={r.id} className="lv-h">
            <summary>
              <span className={`lv-h-mode ${r.mode}`}>{r.mode}</span>
              <b>{r.question || "(question)"}</b>
              <time>{new Date(r.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time>
            </summary>
            <div className="lv-h-a"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.answer}</ReactMarkdown></div>
          </details>
        ))}
        <p className="legal-back"><Link href="/live">Live settings</Link> · <Link href="/">← Back to ModeBuddy</Link></p>
      </main>
    </div>
  );
}
