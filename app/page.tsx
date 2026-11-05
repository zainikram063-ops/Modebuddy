import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Workspace from "@/components/Workspace";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const meta = user.user_metadata ?? {};
  return (
    <Workspace
      user={{
        id: user.id,
        email: user.email ?? "",
        name: meta.full_name ?? meta.name ?? null,
        avatar: meta.avatar_url ?? meta.picture ?? null,
      }}
    />
  );
}
