import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import SharedChat, { type ShareData } from "@/components/SharedChat";

export const dynamic = "force-dynamic";

async function getShare(id: string): Promise<ShareData | null> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc("get_share", { share_id: id });
  if (error || !data) return null;
  return data as ShareData;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const s = await getShare(id);
  return { title: s ? `${s.title} · ModeBuddy` : "Chat not found · ModeBuddy", robots: { index: false } };
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getShare(id);
  if (!s)
    return (
      <main className="share share-missing">
        <div className="share-inner">
          <h1 className="share-title">This link doesn&apos;t work anymore</h1>
          <p className="share-sub">The chat was unshared, or the link is wrong.</p>
          <Link className="share-cta" href="/">Open ModeBuddy →</Link>
        </div>
      </main>
    );
  return <SharedChat s={s} />;
}
