import { DEFAULT_MODEL } from "@/lib/models";

export const dynamic = "force-dynamic";

/* Everyone uses their own free Gemini key and the mode picks the model, so there's one Gemini choice */
export async function GET() {
  return Response.json([{ id: DEFAULT_MODEL, label: "Gemini (free, your key)", note: "Kodra: best free model · Buddy and Edura: Flash Lite" }]);
}
