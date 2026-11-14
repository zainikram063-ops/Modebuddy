// Live tasks: ModeBuddy uses your Mac step by step, and only looks at the screen when it needs to
import { desktop } from "../desktop";
import { shrink } from "./audio";
import { FILEY } from "./parse";

export type Step = { do: string; name?: string; kind?: string; path?: string; app?: string; url?: string; text?: string; keys?: string; target?: string; ms?: number; x?: number; y?: number };
export type StepView = { label: string; state: string; ms?: number };
type Found = { path: string; folder: boolean };
type Actor = { act: (s: Step) => Promise<{ ok: boolean; error?: string; items?: Found[] }>; shot: () => Promise<string | null> };
type Routine = { name: string; steps: Step[] };

// The Mac app's hands: open apps, type, press keys, click, find files, take screenshots
const actor = () => (typeof window === "undefined" ? undefined : (window as unknown as { modebuddyAct?: Actor }).modebuddyAct);
const copy = (t: string) => { void desktop()?.live?.copy(t); };
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const keyOf = (s: Step) => s.do + ":" + String(s.app || s.url || "").toLowerCase();

// If an app isn't installed but has a website, open the website instead
const WEB: Record<string, string> = { claude: "https://claude.ai/new", chatgpt: "https://chatgpt.com", gemini: "https://gemini.google.com/app", perplexity: "https://www.perplexity.ai", notion: "https://www.notion.so", figma: "https://www.figma.com", canva: "https://www.canva.com", spotify: "https://open.spotify.com", youtube: "https://www.youtube.com", gmail: "https://mail.google.com" };

// Apps installed on this Mac (the Mac app sends the list)
let installed: string[] = [];
export const setInstalled = (apps: string[]) => { installed = apps; };
export const getInstalled = () => installed;

// Routines ModeBuddy has learned
let routines: Routine[] = [];
const keep = (m: { routines?: Routine[] } | null) => { if (m && Array.isArray(m.routines)) routines = m.routines; };
export const loadMemory = () => fetch("/api/live/learn").then((r) => r.json()).then(keep).catch(() => {});
export const learn = (body: object) => fetch("/api/live/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).then(keep).catch(() => {});
export function findRoutine(name: string) {
  const n = name.toLowerCase().trim();
  return routines.find((x) => x.name.toLowerCase().trim() === n) || routines.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
}

const label = (s: Step) =>
  s.do === "find" ? `Find “${s.name}”`
  : s.do === "open_path" ? `Open ${String(s.path || "").split("/").slice(-2).join("/")}`
  : s.do === "open_app" ? `Open ${s.app}`
  : s.do === "open_url" ? `Go to ${String(s.url || "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 42)}`
  : s.do === "type" ? `Type “${String(s.text || "").slice(0, 36)}${String(s.text || "").length > 36 ? "…" : ""}”`
  : s.do === "key" ? `Press ${s.keys}`
  : s.do === "click" ? `Click ${s.target || "there"}`
  : "Wait";

// Match the app name the AI used to an app that is really installed
function realApp(name?: string) {
  const n = String(name || "").toLowerCase().replace(/\.app$/, "").trim();
  if (!n) return "";
  if (!installed.length) return String(name);
  return installed.find((a) => a.toLowerCase() === n) || installed.find((a) => a.toLowerCase().startsWith(n)) || installed.find((a) => a.toLowerCase().includes(n)) || "";
}

function prep(raw: Step): Step | null {
  if (raw.do === "open_app") {
    const a = realApp(raw.app);
    if (a) return { ...raw, app: a };
    const w = WEB[String(raw.app || "").toLowerCase().replace(/[^a-z]/g, "")];
    return w ? { do: "open_url", url: w } : null;
  }
  if (raw.do === "open_url") return /^https?:\/\//i.test(String(raw.url || "")) ? { ...raw, app: raw.app ? realApp(raw.app) || undefined : undefined } : null;
  return null;
}

let stopped = false;
let early: { key: string; t: number; at: number; done: Promise<boolean> } | null = null;
// Stops a running task (when you press ⌘⌥ again or close Live)
export function stopTasks() { stopped = true; early = null; }

async function openApp(A: Actor, s: Step, go: () => boolean = () => !stopped) {
  for (let i = 0; i < 3 && go(); i++) { const r = await A.act(s).catch(() => ({ ok: false })); if (r.ok) return true; }
  return false;
}

// Opens the first app while the AI is still writing the plan, so it's ready sooner
export function openEarly(raw: Step, heard: string, showing: () => boolean) {
  if (raw.do === "open_app" && wrongApp(heard, [raw])) return;
  const A = actor(), s = prep(raw);
  if (!A || !s) return;
  const rec = { key: keyOf(raw), t: Date.now(), at: 0, done: Promise.resolve(false) };
  rec.done = (s.do === "open_app" ? openApp(A, s, showing) : A.act(s).then((r) => !!r.ok).catch(() => false)).then((ok) => { rec.at = Date.now(); return ok; });
  early = rec;
}

// Runs the plan straight through; only looks at the screen if something fails, plus once at the end
export async function runTask(list: Step[], goal: string, routine: string, since: number, show: (rows: StepView[]) => void) {
  const A = actor();
  if (!A) return false;
  stopped = false;
  const log: (StepView & { found?: string[]; t0?: number })[] = [{ label: routine ? "Routine: " + routine : "Plan", state: "done", ms: Date.now() - since }];
  const paint = () => show(log.map((x) => ({ label: x.label, state: x.state, ms: x.ms })));
  const begin = (s: Step, t0 = Date.now()) => { log.push({ label: label(s), state: "doing", t0 }); paint(); };
  const finish = (ok: boolean, found?: string[]) => { const x = log[log.length - 1]; x.state = ok ? "done" : "fail"; x.ms = Date.now() - (x.t0 || Date.now()); if (found) x.found = found; paint(); };
  paint();
  const exec = async (raw: Step): Promise<{ ok: boolean; found?: string[] }> => {
    if (raw.do === "open_app" || raw.do === "open_url") {
      const s = prep(raw);
      if (!s) return { ok: false };
      const t = Date.now();
      const ok = s.do === "open_app" ? await openApp(A, s) : !!(await A.act(s).catch(() => ({ ok: false }))).ok;
      if (ok && Date.now() - t > 2500) await wait(1000);
      return { ok };
    }
    let s = raw;
    if (s.do === "open_path" && s.app) s = { ...s, app: realApp(s.app) || undefined };
    if (s.do === "click") {
      if (typeof s.x !== "number" || typeof s.y !== "number") return { ok: false };
      if (s.x > 1 || s.y > 1) s = { ...s, x: s.x / 1000, y: s.y / 1000 };
    }
    if (s.do === "type") {
      const t = String(s.text || "");
      const fly = A.act({ do: "type", text: "" }).catch(() => ({ ok: false }));
      copy(t);
      await wait(260);
      const k = await A.act({ do: "key", keys: "cmd+v" }).catch(() => ({ ok: false }));
      await fly;
      await wait(Math.min(1200, 200 + t.length / 6));
      return { ok: !!k.ok };
    }
    const res = await A.act(s).catch(() => ({ ok: false, items: [] as Found[] }));
    if (s.do !== "find") return { ok: !!res.ok };
    let items = res.items || [];
    // Try other ways the name might be written (claude ads md -> claude-ads-md, claude_ads_md, claude ads.md...)
    const n = String(s.name || "").trim();
    for (const v of [{ name: n.replace(/\s+/g, "-") }, { name: n.replace(/\s+/g, "_") }, { name: n.replace(/\s+/g, "") }, { name: n.replace(/\s+(md|pdf|txt|png|jpe?g|docx?|csv)$/i, ".$1"), kind: "file" }, { name: n.split(/\s+/).slice(0, 2).join(" ") }, { name: n, kind: undefined }]) {
      if (items.length || !v.name || (v.name === n && "kind" in v && !s.kind)) continue;
      items = (await A.act({ ...s, ...v }).catch(() => ({ ok: false, items: [] as Found[] }))).items || [];
    }
    if (items.length) return { ok: true, found: items.map((i) => (i.folder ? "folder: " : "file: ") + i.path) };
    // macOS can hide Desktop/Documents/Downloads from the search, so use Spotlight like a person would
    await A.act({ do: "key", keys: "cmd+space" }).catch(() => ({ ok: false }));
    await wait(450);
    copy(n);
    await wait(120);
    await A.act({ do: "key", keys: "cmd+v" }).catch(() => ({ ok: false }));
    await wait(1000);
    return { ok: true, found: ["Search found nothing, so Spotlight is now open with the name typed in. Look at the Spotlight results on screen and open the right one."] };
  };
  const check = async (): Promise<{ steps: Step[]; done: boolean; last: boolean } | null> => {
    for (let tries = 0; tries < 2 && !stopped; tries++) {
      const img = await A.shot().catch(() => null);
      const r = await fetch("/api/live/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, plan: list, history: log.slice(1), image: img ? await shrink(img).catch(() => img) : null, installed }),
      }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r && (r.done || (Array.isArray(r.steps) && r.steps.length))) return { steps: r.done ? [] : r.steps.slice(0, 3), done: !!r.done, last: !!r.last };
    }
    return null;
  };
  const plan: Step[] = [];
  const did: Step[] = [];
  for (const s of list) { if (s.do === "open_path") break; plan.push(s); if (s.do === "find") break; }
  // The first app may already be opening
  const e = early;
  early = null;
  if (e && plan[0] && keyOf(plan[0]) === e.key) {
    const first = plan.shift() as Step;
    begin(first, e.t);
    const ok = await e.done;
    if (ok && e.at - e.t > 2500 && Date.now() - e.at < 1000) await wait(1000 - (Date.now() - e.at));
    finish(ok);
    if (ok) did.push(first);
  }
  if (wrongApp(goal, list)) plan.length = 0;
  let queue: Step[] = [...plan];
  let fails = 0, checks = 0, stopAfter = false, hidden = false, fixed = false;
  for (let round = 0; round < 30 && !stopped && fails < 3; round++) {
    if (!queue.length) {
      if (stopAfter || checks++ >= 8) break;
      if (!fails && !hidden) { hidden = true; A.act({ do: "done" }).catch(() => ({ ok: false })); }
      const r = await check();
      if (stopped || !r || r.done || !r.steps.length) break;
      queue = r.steps;
      stopAfter = r.last;
      fixed = true;
    }
    const s = queue.shift() as Step;
    // A click with no spot on screen yet: look at the screen to find it (not a failure)
    if (s.do === "click" && (typeof s.x !== "number" || typeof s.y !== "number")) { queue = []; stopAfter = false; continue; }
    begin(s);
    const r = await exec(s);
    finish(r.ok, r.found);
    if (r.ok && s.do !== "find" && s.do !== "wait") did.push(s.do === "click" ? { do: "click", target: s.target } : s);
    if (!r.ok) { fails += 1; queue = []; stopAfter = false; continue; }
    fails = 0;
    if (s.do === "find") queue = [];
  }
  await A.act({ do: "done" }).catch(() => ({ ok: false }));
  if (!stopped && !fails && did.length) learn(routine && !fixed ? { routine } : { goal, steps: did });
  return true;
}

// "Open the claude ads folder" must not open the Claude app, but "yes I trust this folder" is fine
function wrongApp(goal: string, list: Step[]) {
  const first = list[0];
  if (!first || first.do !== "open_app" || list.some((x) => x.do === "find" || x.do === "open_path")) return false;
  const words = goal.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  const i = words.indexOf(String(first.app || "").toLowerCase().split(/\s+/)[0]);
  return i >= 0 && words.slice(i + 1, i + 4).some((w) => FILEY.test(w));
}
