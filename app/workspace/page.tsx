import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <main style={{ padding: 40 }}>
      <h1>ModeBuddy</h1>
      <p>Logged in as {user.email}</p>
    </main>
  );
}
