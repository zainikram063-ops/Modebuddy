/* Server only: ModeBuddy's own Gemini key, the live model list, and automatic fallback */
import { DEFAULT_MODEL, GEMINI_MODELS, isChatModel, noteOf, sortModels, tierOf, type PlatformModel } from "./models";
import type { ModelConfig } from "./providers-meta";

const API = "https://generativelanguage.googleapis.com/v1beta";

export function platformConfig(c: Partial<ModelConfig>): ModelConfig {
  const model = c.model && isChatModel(c.model) ? c.model : DEFAULT_MODEL;
  return { provider: "google", model, apiKey: process.env.GEMINI_API_KEY ?? "", baseURL: undefined };
}

let cache: { at: number; list: PlatformModel[] } | null = null;

/* every Gemini 3+ chat model this key can use, refreshed hourly */
export async function liveModels(): Promise<PlatformModel[]> {
  if (cache && Date.now() - cache.at < 3_600_000) return cache.list;
  try {
    const r = await fetch(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" } });
    const j = (await r.json()) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
    const all = (j.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name, note: "" }))
      .filter((m) => isChatModel(m.id));
    const ids = new Set(all.map((m) => m.id));
    const dated = /-(\d{3}|\d{2}-\d{4})$/;
    const list = sortModels(all.filter((m) => !dated.test(m.id) || !ids.has(m.id.replace(dated, ""))))
      .map((m) => ({ ...m, note: noteOf(m.id) }));
    if (list.length) { cache = { at: Date.now(), list }; return list; }
  } catch { /* offline or bad key */ }
  return GEMINI_MODELS;
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const RETRY = [400, 404, 429, 500, 503];

/* if a model is busy, out of quota or missing, try the others (cheapest first) */
export const withFallback = (base: Fetch): Fetch => async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /\/models\/([^:/?]+):/.exec(url);
  init = withThinking(url, init);
  if (!m) return base(input, init);
  const others = (await liveModels()).map((x) => x.id).filter((id) => id !== m[1]).sort((a, b) => tierOf(a) - tierOf(b));
  const chain = [m[1], ...others].slice(0, 6);
  for (let i = 0; i < chain.length; i++) {
    const res = await base(url.replace(`/models/${m[1]}:`, `/models/${chain[i]}:`), init);
    if (!RETRY.includes(res.status) || i === chain.length - 1) { console.log(`✨ answered by ${chain[i]} (${res.status})`); return res; }
    console.log(`↪ ${chain[i]} said ${res.status}, trying the next model`);
    await res.body?.cancel().catch(() => undefined);
  }
  return base(input, init);
};

/* Quick answers: when the chat asks for it, tell Gemini to think less so it starts answering sooner */
function withThinking(url: string, init?: RequestInit): RequestInit | undefined {
  try {
    const h = new Headers(init?.headers);
    if (!h.get("x-mb-think")) return init;
    h.delete("x-mb-think");
    if (typeof init?.body !== "string" || !/generateContent/i.test(url)) return { ...init, headers: h };
    const b = JSON.parse(init.body);
    const model = (/\/models\/([^:/?]+):/.exec(url) || [])[1] || "";
    b.generationConfig = { ...(b.generationConfig || {}), thinkingConfig: /gemini-2\.5/.test(model) ? { thinkingBudget: /pro/.test(model) ? 128 : 0 } : { thinkingLevel: "low" } };
    return { ...init, headers: h, body: JSON.stringify(b) };
  } catch {
    return init;
  }
}
