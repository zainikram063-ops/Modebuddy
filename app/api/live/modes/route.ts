import { requestKey } from "@/lib/userKey";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TABLE = "modes";

type Out = { id: string; name: string; color: string; apps: string[]; sites: string[] };

const pick = (m: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (typeof m[k] === "string" && m[k]) return m[k] as string;
  return "";
};

// Your custom modes + which apps/sites they belong to (worked out once per mode, then remembered)
export async function GET() {
  try {
    const store = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
      { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
    );
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return Response.json({ modes: [] }, { status: 401 });
    let q = await sb.from(TABLE).select("*").eq("user_id", u.user.id);
    if (q.error) q = await sb.from(TABLE).select("*");
    const { data: known } = await sb.from("mode_apps").select("*").eq("user_id", u.user.id);
    const have = new Map((known || []).map((k) => [String(k.mode_id), k]));
    const out: Out[] = [];
    for (const m of ((q.data || []) as Record<string, unknown>[]).slice(0, 30)) {
      const id = String(m.id ?? "");
      if (!id) continue;
      const name = pick(m, ["name", "title", "label"]) || "Custom";
      const color = pick(m, ["color", "accent", "hue"]);
      const about = Object.entries(m)
        .filter(([k, v]) => typeof v === "string" && !/id$|_at$|color|emoji|icon/.test(k))
        .map(([k, v]) => `${k}: ${String(v).slice(0, 600)}`).join("\n").slice(0, 2500);
      let row = have.get(id);
      if (!row || row.name !== name) {
        const a = await analyze(name, about);
        row = { user_id: u.user.id, mode_id: id, name, color: color || a.color || "#8b5cf6", apps: a.apps, sites: a.sites, prompt: about.slice(0, 2000), updated_at: new Date().toISOString() };
        await sb.from("mode_apps").upsert(row);
      }
      out.push({ id, name: String(row.name), color: color || String(row.color), apps: row.apps || [], sites: row.sites || [] });
    }
    return Response.json({ modes: out });
  } catch (e) {
    return Response.json({ modes: [], error: String(e).slice(0, 200) });
  }
}

async function analyze(name: string, about: string) {
  const text = `A user made a custom AI mode called "${name}".\n${about}\n\nWhich Mac apps and websites would someone have open when they need this mode? Reply with JSON only: {"apps": ["App Name"], "sites": ["domain.com"], "color": "#hex accent colour that fits the mode"}. Up to 12 apps and 12 sites.`;
  for (const model of ["gemini-flash-lite-latest", "gemini-3-flash-preview"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": (await requestKey()) },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const t = (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
      const o = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 12) : []);
      return { apps: list(o.apps), sites: list(o.sites).map((s) => s.toLowerCase()), color: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "" };
    } catch { /* try the next model */ }
  }
  return { apps: [] as string[], sites: [] as string[], color: "" };
}
