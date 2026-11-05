import { generateText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { createModel } from "@/lib/providers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ title: null }, { status: 401 });

  try {
    const { id, model, text } = await req.json();
    const clean = String(text ?? "").replace(/<file[\s\S]*?<\/file>/g, "").slice(0, 800);
    const { text: out } = await generateText({
      model: createModel(model),
      prompt: `Write a 2–5 word title for a chat that starts with:\n"""${clean}"""\nReply with the title only. No quotes, no punctuation at the end.`,
    });
    const title = out.replace(/["'`*#\n]/g, "").trim().slice(0, 60);
    if (title) await supabase.from("conversations").update({ title }).eq("id", id);
    return Response.json({ title: title || null });
  } catch {
    return Response.json({ title: null });
  }
}
