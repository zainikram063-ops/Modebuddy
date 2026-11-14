import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
const RULES = `You are ModeBuddy, using the user's Mac to finish their task. You can see the screen right now.
Reply with JSON only: either {"done": true} or {"done": false, "steps": [the next 1 to 3 steps]}.
Steps: {"do":"open_app","app":"exact installed app name"}, {"do":"open_url","url":"https://..."}, {"do":"find","name":"file or folder name","kind":"folder or file"}, {"do":"open_path","path":"~/exact/path/from/find"}, {"do":"type","text":"..."}, {"do":"key","keys":"enter"}, {"do":"click","x":500,"y":500,"target":"what you are clicking"}, {"do":"wait","ms":1500}.
For click, x and y are the center of the thing to click on this screenshot, from the top left, on a 0 to 1000 scale.
Rules:
- Look carefully at the screen before every step. Only do what the task asks, nothing extra.
- When they ask to OPEN or FIND a folder, file, document or project by name (or a file type like md, pdf, png), they mean a file or folder on their Mac, NOT an app, even if the name has an app name in it. "Open the claude ads folder" means find a folder named like "claude ads", not open the Claude app. Use find for it.
- To pick an option that is on screen (a button, a menu, a dialog, or a terminal question like "Do you trust the files in this folder?"), use keys: "enter" picks the highlighted option, "up" and "down" move between options. Words like folder or file inside an on-screen option do NOT mean find.
- To open a file or folder: first use find, then open the right result with open_path. Never guess or invent a path. Only use paths that find returned.
- Pick the result that best matches what the user said: the exact name, and the place they mentioned (like Desktop or Downloads). If none match well, try find again with a different name.
- If find returns nothing, use Spotlight: key cmd+space, type the name, wait 1000, then look at the results and click the right one (folders are listed under Folders).
- If the right app is not in front, bring it to the front with open_app first.
- Before typing, make sure the right text box is focused. Click it first if it is not.
- Type the whole text in one type step. After typing, check that all of the text is in the right box before pressing enter. If it is missing, cut off or in the wrong place, fix it first.
- If something is still loading, wait. If a step failed, try a different way.
- Never delete anything, buy anything, or send emails or messages unless the task clearly asks for it.
- If the steps you send will finish the task, add "last": true.
- When the task is complete, reply {"done": true}.`;

type H = { label: string; state: string; found?: string[] };

export async function POST(req: Request) {
  try {
    const store = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
    );
    if (!(await sb.auth.getUser()).data.user) return Response.json({ done: true, steps: [] }, { status: 401 });
    const { goal, plan, history, image, installed } = (await req.json().catch(() => ({}))) as { goal?: string; plan?: unknown[]; history?: H[]; image?: string | null; installed?: string[] };
    const done = (history || []).map((h, i) => `${i + 1}. ${h.label} (${h.state === "done" ? "worked" : "failed"})` + (h.found?.length ? "\n   Found:\n" + h.found.map((f) => "   - " + f).join("\n") : "")).join("\n");
    const text = `Task: ${String(goal || "").slice(0, 1500)}
First plan: ${JSON.stringify(plan || []).slice(0, 3000)}
Done so far:
${done || "nothing yet"}
Installed apps: ${(installed || []).slice(0, 250).join(", ")}`;
    const parts = [...(image ? [{ inlineData: { mimeType: "image/jpeg", data: image } }] : []), { text }];
    for (const model of ["gemini-2.5-flash", "gemini-flash-latest"]) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: RULES }] }, contents: [{ role: "user", parts }], generationConfig: { temperature: 0.1, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 256 } } }),
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) continue;
        const j = await r.json();
        const t = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string; thought?: boolean }) => (p.thought ? "" : p.text || "")).join("");
        const o = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
        return Response.json({ done: !!o.done, last: !!o.last, steps: Array.isArray(o.steps) ? o.steps.slice(0, 3) : [] });
      } catch { /* try the next model */ }
    }
    return Response.json({ error: "no answer" }, { status: 502 });
  } catch {
    return Response.json({ error: "no answer" }, { status: 502 });
  }
}
