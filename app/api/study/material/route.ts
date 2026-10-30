import { createClient } from "@/lib/supabase/server";
import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15_000_000;
const MAX_CHARS = 200_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|html?|xml|ya?ml|tex)$/i;
const fail = (status: number, error: string) => Response.json({ error }, { status });

async function auth() {
  const db = createClient();
  const { data: { user } } = await db.auth.getUser();
  return { db, user };
}

export async function GET() {
  const { db, user } = await auth();
  if (!user) return fail(401, "Please sign in again.");
  const { data, error } = await db.from("knowledge").select("id,title,content,created_at").eq("mode_id", "study").order("created_at");
  if (error) return fail(500, error.message);
  return Response.json({
    docs: (data ?? []).map((d) => ({ id: d.id, title: d.title, chars: (d.content ?? "").length, created_at: d.created_at })),
  });
}

export async function POST(req: Request) {
  const { db, user } = await auth();
  if (!user) return fail(401, "Please sign in again.");

  let form: FormData;
  try { form = await req.formData(); } catch { return fail(400, "Bad upload."); }
  const file = form.get("file");
  if (!file || typeof file === "string") return fail(400, "No file.");
  if (file.size > MAX_BYTES) return fail(413, `${file.name} is over 15 MB.`);

  let text = "";
  try {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const r = await extractText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n\n") : r.text;
    } else if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) {
      text = await file.text();
    } else {
      return fail(415, `${file.name}: use PDF, TXT or MD. For Word or Google Docs, export as PDF first.`);
    }
  } catch {
    return fail(422, `Couldn't read ${file.name}.`);
  }

  text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 40)
    return fail(422, `${file.name} has no readable text. If it's a scanned PDF, send photos of the pages in chat instead.`);
  const truncated = text.length > MAX_CHARS;
  if (truncated) text = text.slice(0, MAX_CHARS);

  const title = file.name.replace(/\.[^.]+$/, "").slice(0, 120);
  const { data, error } = await db.from("knowledge")
    .insert({ user_id: user.id, mode_id: "study", title, content: text })
    .select("id").single();
  if (error || !data) return fail(500, `Couldn't save: ${error?.message ?? "unknown error"}`);
  return Response.json({ id: data.id, title, chars: text.length, truncated });
}

export async function DELETE(req: Request) {
  const { db, user } = await auth();
  if (!user) return fail(401, "Please sign in again.");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "Missing id.");
  const { error } = await db.from("knowledge").delete().eq("id", id).eq("mode_id", "study");
  if (error) return fail(500, error.message);
  return Response.json({ ok: true });
}
