import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";

// Finds something on a screenshot and returns where it is (0 to 1)
export async function POST(req: Request) {
  try {
    const store = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
    );
    if (!(await sb.auth.getUser()).data.user) return Response.json({ x: null }, { status: 401 });
    const { image, target } = (await req.json().catch(() => ({}))) as { image?: string; target?: string };
    if (!image || !target) return Response.json({ x: null });
    const body = JSON.stringify({
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "image/jpeg", data: image } },
        { text: `Find "${String(target).slice(0, 120)}" on this screenshot. Reply with JSON only: {"x": number, "y": number} for its center, on a 0 to 1000 scale from the top left. If it is not visible reply {"x": null, "y": null}.` },
      ] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
    });
    for (const model of ["gemini-2.5-flash", "gemini-flash-latest"]) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body, signal: AbortSignal.timeout(15000) });
        if (!r.ok) continue;
        const j = await r.json();
        const t = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
        const o = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
        if (typeof o.x !== "number" || typeof o.y !== "number") return Response.json({ x: null });
        return Response.json({ x: Math.min(1, Math.max(0, o.x / 1000)), y: Math.min(1, Math.max(0, o.y / 1000)) });
      } catch { /* try the next model */ }
    }
    return Response.json({ x: null });
  } catch {
    return Response.json({ x: null });
  }
}
