import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const store = (await cookies());
  return createServerClient("https://nstsjowbmfjytttirkzn.supabase.co", "sb_publishable_bqkQ6GB9dVEVLBBXuycfqA_F9rMWRuC", {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* server component */ }
      },
    },
  });
}
