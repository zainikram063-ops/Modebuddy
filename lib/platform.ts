/* Server only: ModeBuddy's own Gemini key, the live model list, and automatic fallback */
import { DEFAULT_MODEL, GEMINI_MODELS, isChatModel, noteOf, sortModels, tierOf, type PlatformModel } from "./models";
import type { ModelConfig } from "./providers-meta";
import { requestHeader, requestKey } from "./userKey";

const API = "https://generativelanguage.googleapis.com/v1beta";

export function platformConfig(c: Partial<ModelConfig>): ModelConfig {
  const model = c.model && isChatModel(c.model) ? c.model : DEFAULT_MODEL;
  return { provider: "google", model, apiKey: "", baseURL: undefined };
}

let cache: { at: number; list: PlatformModel[] } | null = null;

/* every Gemini 3+ chat model this key can use, refreshed hourly */
export async function liveModels(): Promise<PlatformModel[]> {
  if (cache && Date.now() - cache.at < 3_600_000) return cache.list;
  const key = await requestKey();
  if (!key) return GEMINI_MODELS;
  try {
    const r = await fetch(`${API}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
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

const skip = new Map<string, number>(); // models a key can't use right now (not on its free tier, or out of quota)

/* if a model is busy, out of quota or missing, try the nearest one below it (then above), and remember for a while */
export const withFallback = (base: Fetch): Fetch => async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = /\/models\/([^:/?]+):/.exec(url);
  init = withThinking(url, init);
  init = await withEffort(url, init);
  // Everyone uses their own Gemini key: fill it in from the request when the model was made without one
  const h = new Headers(init?.headers);
  if (!h.get("x-goog-api-key")) {
    const k = await requestKey();
    if (k) { h.set("x-goog-api-key", k); init = { ...init, headers: h }; }
  }
  if (!m) return base(input, init);
  const who = (h.get("x-goog-api-key") || "").slice(-10);
  const t0 = tierOf(m[1]);
  const rank = (id: string) => (tierOf(id) <= t0 ? t0 - tierOf(id) : 100 + tierOf(id) - t0);
  const others = (await liveModels()).map((x) => x.id).filter((id) => id !== m[1]).sort((a, b) => rank(a) - rank(b));
  const all = [m[1], ...others];
  const ready = all.filter((id) => (skip.get(who + id) ?? 0) < Date.now());
  const chain = (ready.length ? ready : all).slice(0, 5);
  for (let i = 0; i < chain.length; i++) {
    const res = await base(url.replace(`/models/${m[1]}:`, `/models/${chain[i]}:`), init);
    if (!RETRY.includes(res.status) || i === chain.length - 1) { console.log(`✨ answered by ${chain[i]} (${res.status})`); return res; }
    if (res.status === 404 || res.status === 429) skip.set(who + chain[i], Date.now() + (res.status === 404 ? 86_400_000 : 600_000));
    console.log(`↪ ${chain[i]} said ${res.status}, trying the next model`);
    await res.body?.cancel().catch(() => undefined);
  }
  return base(input, init);
};

/* Effort slider (Low to Ultra) and Ultra code, sent by the chat. Only the main streamed answer is changed. */
const EFFORTS = ["low", "medium", "high", "max", "ultra"];
const EFFORT_NOTES: Record<string, string> = {
  high: "\n\n[Effort: High] Take your time. Think the problem through step by step, consider edge cases, and check your answer before you reply.",
  max: "\n\n[Effort: Max] Be thorough. Weigh a few approaches and pick the best, verify facts, numbers and code carefully, and give a complete answer. Don't cut corners or shorten things to save space.",
  ultra: "\n\n[Effort: Ultra] Work at your absolute best. Plan your approach, solve it fully, then review your answer like a strict expert, find any mistakes or gaps, and fix them before you reply. Only send the final, polished answer.",
};
const ULTRA_CODE = "\n\n[Ultra code] Build like a senior engineer shipping to production. Plan the architecture and file structure first. Write every file completely with clean, consistent, well-named code. Handle errors, loading and empty states, and edge cases. Make the UI polished, accessible (labels, contrast, keyboard use) and responsive. Avoid deprecated APIs and never leave placeholders or TODOs. Before replying, review every file for bugs, broken imports, typos and missing pieces, and fix them. Kodra's usual steps still apply: questions first for new builds, then a plan, then the build.";

async function withEffort(url: string, init?: RequestInit): Promise<RequestInit | undefined> {
  if (typeof init?.body !== "string" || !/streamGenerateContent/i.test(url)) return init;
  const ultraCode = (await requestHeader("x-mb-ultra-code")) === "1";
  const asked = (await requestHeader("x-mb-effort")).toLowerCase();
  const level = ultraCode ? "ultra" : EFFORTS.includes(asked) ? asked : "medium";
  if (level === "medium") return init;
  try {
    const b = JSON.parse(init.body);
    const model = (/\/models\/([^:/?]+):/.exec(url) || [])[1] || "";
    const v25 = /gemini-2\.5/.test(model), pro = /pro/.test(model);
    const g = { ...(b.generationConfig || {}) };
    const tc = { ...(g.thinkingConfig || {}) };
    delete tc.thinkingBudget;
    delete tc.thinkingLevel;
    if (level === "low") {
      g.thinkingConfig = { ...tc, ...(v25 ? { thinkingBudget: pro ? 128 : 0 } : { thinkingLevel: "low" }) };
    } else {
      g.thinkingConfig = { ...tc, ...(v25 ? { thinkingBudget: level === "high" ? 8192 : pro ? 32768 : 24576 } : { thinkingLevel: "high" }) };
      g.maxOutputTokens = Math.max(Number(g.maxOutputTokens) || 0, level === "high" ? 16384 : 65536);
      const note = { text: EFFORT_NOTES[level] + (ultraCode ? ULTRA_CODE : "") };
      const si = b.systemInstruction;
      if (si && Array.isArray(si.parts)) si.parts.push(note);
      else b.systemInstruction = { parts: [note] };
    }
    b.generationConfig = g;
    return { ...init, body: JSON.stringify(b) };
  } catch {
    return init;
  }
}

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
