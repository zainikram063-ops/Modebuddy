"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { desktop, type LiveEvent } from "../../../lib/desktop";
import { LIVE_MODES, liveMode, type LiveMode } from "../../../lib/liveModes";

type View = "idle" | "listening" | "thinking" | "answer" | "error";
type Rec = { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; chunks: Float32Array[]; t0: number };
type Turn = { q: string; a: string };

const RATE = 16000;
const ICONS: Record<string, string> = {
  insert: "M12 4v11M7.5 10.5l4.5 4.5 4.5-4.5M5 20h14",
  copy: "M8.5 10.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5",
  check: "M5 12.5l4.5 4.5 9.5-10",
  speaker: "M5 9.5v5h3l4.5 4v-13l-4.5 4zM16 9.5a3.5 3.5 0 0 1 0 5",
  stop: "M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7z",
  retry: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8",
  close: "M7 7l10 10M17 7L7 17",
};
const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[name]} /></svg>
);

function wav(chunks: Float32Array[]) {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  let peak = 0;
  for (const c of chunks) for (let i = 0; i < c.length; i += 4) peak = Math.max(peak, Math.abs(c[i]));
  const g = peak > 0.01 ? Math.min(6, 0.9 / peak) : 1;
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { const s = Math.max(-1, Math.min(1, c[i] * g)); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(v.buffer);
}

function b64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return btoa(s);
}

function shrink(img64: string, max = 1024, q = 0.55): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      const g = c.getContext("2d");
      if (!g) { reject(new Error("no canvas")); return; }
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", q).split(",")[1] || img64);
    };
    img.onerror = () => reject(new Error("bad image"));
    img.src = "data:image/jpeg;base64," + img64;
  });
}

function parse(raw: string, final: boolean) {
  const cut = raw.search(/^-{3,}\s*$/m);
  const head = cut >= 0 ? raw.slice(0, cut) : raw;
  const get = (k: string) => (head.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.*)$", "mi")) || [])[1]?.trim() || "";
  let answer = cut >= 0 ? raw.slice(cut).replace(/^-{3,}\s*\n?/, "") : "";
  if (cut < 0 && final) answer = raw.replace(/^\s*(HEARD|MODE|SAY)\s*:.*$/gim, "").trim();
  return { heard: get("HEARD"), mode: get("MODE").toLowerCase().replace(/[^a-z]/g, ""), say: get("SAY"), does: get("DO"), use: get("USE"), remember: get("REMEMBER"), answer };
}

const pasteable = (md: string) => ((md.match(/```[^\n]*\n([\s\S]*?)```/) || [])[1] ?? md).trim();
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim();

function onColor(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  if (Number.isNaN(n)) return "#0a0a0a";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0a0a0a" : "#ffffff";
}

// Your words are not shown while you talk, just a sound animation
const SHOW_WORDS = false;

type LiveMsg = { setupComplete?: unknown; serverContent?: { modelTurn?: { parts?: { text?: string }[] }; turnComplete?: boolean } };

// Turns mic samples into 16-bit audio for streaming
function pcm16(f: Float32Array) {
  const b = new Uint8Array(f.length * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  let bin = "";
  for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(bin);
}

const appMode = (app: string) =>
  /cursor|code|xcode|terminal|iterm|warp|studio|intellij|pycharm|webstorm|sublime|zed|nova|docker|github/i.test(app) ? "code"
  : /notion|notes|obsidian|goodnotes|notability|preview|books|anki|quizlet|word|pages|onenote|craft|bear|classroom/i.test(app) ? "study" : "buddy";

export default function LivePanel() {
  const [view, setView] = useState<View>("idle");
  const [raw, setRaw] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(false);
  const [mode, setMode] = useState<LiveMode>(LIVE_MODES.buddy);
  const [custom, setCustom] = useState<{ id: string; name: string; color: string; apps: string[]; sites: string[] }[]>([]);
  const [heard, setHeard] = useState("");
  const [latchH, setLatchH] = useState(88);
  const [leaving, setLeaving] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [levels, setLevels] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const viewRef = useRef<View>("idle");
  const rec = useRef<Rec | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const lvl = useRef(0), smooth = useRef(0), raf = useRef(0), leaveT = useRef(0), hearT = useRef(0), session = useRef(0);
  const hearState = useRef({ busy: false, count: 0, seen: 0 });
  const abort = useRef<AbortController | null>(null);
  const turns = useRef<Turn[]>([]);
  const last = useRef<Turn | null>(null);
  const lastAsk = useRef<{ audio: string; image: string | null } | null>(null);
  const latchRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const handler = useRef<(e: LiveEvent) => void>(() => {});

  const api = () => desktop()?.live;
  const go = (v: View) => { viewRef.current = v; setView(v); };
  const audioRef = useRef<HTMLAudioElement | null>(null);
  type Step = { do: string; name?: string; kind?: string; path?: string; app?: string; url?: string; text?: string; keys?: string; target?: string; ms?: number; x?: number; y?: number };
  type Actor = { act: (s: Step) => Promise<{ ok: boolean; error?: string; items?: { path: string; folder: boolean }[] }>; shot: () => Promise<string | null> };
  const [steps, setSteps] = useState<{ label: string; state: string; ms?: number }[]>([]);
  const stopRun = useRef(false);
  // ---------- Streaming: your voice goes to the AI while you are still talking ----------
  type LiveSession = { sendRealtimeInput: (x: object) => void; close: () => void };
  type Sink = (m: { text?: string; done?: boolean; error?: boolean }) => void;
  const live = useRef<{ s: LiveSession | null; ready: boolean; queue: object[]; sink: Sink | null } | null>(null);
  const liveRes = useRef<Promise<Response | null> | null>(null);
  const liveSend = (x: object) => {
    const L = live.current;
    if (!L) return;
    if (L.ready && L.s) { try { L.s.sendRealtimeInput(x); } catch { /* connection dropped */ } }
    else L.queue.push(x);
  };
  function liveClose() {
    const L = live.current;
    live.current = null;
    liveRes.current = null;
    if (!L) return;
    L.sink?.({ error: true });
    try { L.s?.close(); } catch { /* already closed */ }
  }
  async function liveOpen() {
    const A = actor();
    if (live.current?.s) {
      // Follow-up: same conversation, fresh look at the screen
      A?.shot().then((img) => (img ? shrink(img) : null)).then((img) => { if (img) liveSend({ video: { data: img, mimeType: "image/jpeg" } }); }).catch(() => {});
      return;
    }
    const L = { s: null as LiveSession | null, ready: false, queue: [] as object[], sink: null as Sink | null };
    live.current = L;
    try {
      const shot = A ? A.shot().then((img) => (img ? shrink(img).catch(() => img) : null)).catch(() => null) : Promise.resolve(null);
      const t = await fetch("/api/live/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modes: custom, modeId: custom.some((m) => m.id === mode.id) ? mode.id : undefined, installed: installed.current }) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!t?.token || live.current !== L) throw new Error("no pass");
      const { GoogleGenAI, Modality } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: t.token, httpOptions: { apiVersion: "v1alpha" } });
      for (const model of (t.models || []) as string[]) {
        const ok = await new Promise<boolean>((done) => {
          let opened = false;
          const timer = window.setTimeout(() => done(false), 4000);
          ai.live.connect({
            model,
            config: { responseModalities: [Modality.TEXT], systemInstruction: String(t.system || ""), realtimeInputConfig: { automaticActivityDetection: { disabled: true } } },
            callbacks: {
              onmessage: (raw: unknown) => {
                const m = raw as LiveMsg;
                if (m.setupComplete && !opened) { opened = true; window.clearTimeout(timer); done(true); }
                for (const p of m.serverContent?.modelTurn?.parts || []) if (p.text) L.sink?.({ text: p.text });
                if (m.serverContent?.turnComplete) L.sink?.({ done: true });
              },
              onerror: () => { if (!opened) { window.clearTimeout(timer); done(false); } else L.sink?.({ error: true }); },
              onclose: () => { if (!opened) { window.clearTimeout(timer); done(false); } else { L.sink?.({ error: true }); if (live.current === L) live.current = null; } },
            },
          }).then((s) => { L.s = s as unknown as LiveSession; }).catch(() => { window.clearTimeout(timer); done(false); });
        });
        for (let i = 0; ok && i < 20 && !L.s; i++) await new Promise((r) => setTimeout(r, 50));
        if (ok && L.s) break;
        try { L.s?.close(); } catch { /* ignore */ }
        L.s = null;
      }
      if (!L.s || live.current !== L) throw new Error("no connection");
      const img = await shot;
      if (img) L.queue.splice(L.queue.findIndex((x) => "activityStart" in x) + 1, 0, { video: { data: img, mimeType: "image/jpeg" } });
      L.ready = true;
      for (const x of L.queue.splice(0)) L.s.sendRealtimeInput(x);
    } catch {
      if (live.current === L) { live.current = null; try { L.s?.close(); } catch { /* ignore */ } }
      L.sink?.({ error: true });
    }
  }
  // When you let go: tell the AI you're done, and hand back its answer as it streams in
  function liveFinish(): Promise<Response | null> | null {
    const L = live.current;
    if (!L) return null;
    liveSend({ activityEnd: {} });
    return new Promise((resolve) => {
      let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
      let full = "", started = false;
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({ start: (c) => { ctrl = c; } });
      const timer = window.setTimeout(() => { if (!started) { L.sink = null; resolve(null); } }, 7000);
      L.sink = (m) => {
        if (m.text) {
          full += m.text;
          ctrl?.enqueue(enc.encode(m.text));
          if (!started) { started = true; window.clearTimeout(timer); resolve(new Response(body)); }
        }
        if (m.done || m.error) {
          L.sink = null;
          if (!started) { window.clearTimeout(timer); resolve(null); return; }
          try { ctrl?.close(); } catch { /* already closed */ }
          if (m.done && full) fetch("/api/live/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full }) }).catch(() => {});
        }
      };
    });
  }
  // Use the streamed answer if there is one, otherwise ask the normal way
  async function liveFetch(url: string, init: RequestInit) {
    const p = liveRes.current;
    liveRes.current = null;
    const r = p ? await p.catch(() => null) : null;
    return r || fetch(url, init);
  }
  const memory = useRef<{ routines: { name: string; steps: Step[] }[] }>({ routines: [] });
  const loadMem = () => fetch("/api/live/learn").then((r) => r.json()).then((m) => { if (m && Array.isArray(m.routines)) memory.current = m; }).catch(() => {});
  const learn = (body: object) => fetch("/api/live/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).then((m) => { if (m && Array.isArray(m.routines)) memory.current = m; }).catch(() => {});
  const findRoutine = (name: string) => {
    const n = name.toLowerCase().trim();
    const all = memory.current.routines;
    return all.find((x) => x.name.toLowerCase().trim() === n) || all.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
  };
  const askAt = useRef(0);
  const noCloud = useRef(false);
  const installed = useRef<string[]>([]);
  const actor = () => (window as unknown as { modebuddyAct?: Actor }).modebuddyAct;
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
  const realApp = (name?: string) => {
    const n = String(name || "").toLowerCase().replace(/\.app$/, "").trim();
    const list = installed.current;
    if (!n) return "";
    if (!list.length) return String(name);
    return list.find((a) => a.toLowerCase() === n) || list.find((a) => a.toLowerCase().startsWith(n)) || list.find((a) => a.toLowerCase().includes(n)) || "";
  };

  // Open the first app while the AI is still writing, so it is ready sooner
  const early = useRef<{ key: string; t: number; at: number; done: Promise<boolean> } | null>(null);
  const stepKey = (s: Step) => s.do + ":" + String(s.app || s.url || "").toLowerCase();
  const openApp = async (A: Actor, s: Step, live = () => !stopRun.current) => {
    for (let i = 0; i < 3 && live(); i++) { const r = await A.act(s).catch(() => ({ ok: false })); if (r.ok) return true; }
    return false;
  };
  // If an app isn't installed but has a website, open the website instead
  const WEB: Record<string, string> = { claude: "https://claude.ai/new", chatgpt: "https://chatgpt.com", gemini: "https://gemini.google.com/app", perplexity: "https://www.perplexity.ai", notion: "https://www.notion.so", figma: "https://www.figma.com", canva: "https://www.canva.com", spotify: "https://open.spotify.com", youtube: "https://www.youtube.com", gmail: "https://mail.google.com" };
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
  function openEarly(raw: Step) {
    const A = actor(), s = prep(raw);
    if (!A || !s) return;
    const rec = { key: stepKey(raw), t: Date.now(), at: 0, done: Promise.resolve(false) };
    rec.done = (s.do === "open_app" ? openApp(A, s, () => viewRef.current !== "idle") : A.act(s).then((r) => !!r.ok).catch(() => false)).then((ok) => { rec.at = Date.now(); return ok; });
    early.current = rec;
  }

  // ModeBuddy runs the plan straight through, and only looks at the screen if something fails (plus once at the end)
  async function run(list: Step[], goal = "", routine = "") {
    const A = actor();
    if (!A) { setErr("Update the ModeBuddy Mac app so it can do things for you."); go("error"); return; }
    stopRun.current = false;
    const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
    const log: { label: string; state: string; found?: string[]; t0?: number; ms?: number }[] = [{ label: routine ? "Routine: " + routine : "Plan", state: "done", ms: Date.now() - askAt.current }];
    const show = () => setSteps(log.map((x) => ({ label: x.label, state: x.state, ms: x.ms })));
    const begin = (s: Step, t0 = Date.now()) => { log.push({ label: label(s), state: "doing", t0 }); show(); };
    const finish = (ok: boolean, found?: string[]) => { const x = log[log.length - 1]; x.state = ok ? "done" : "fail"; x.ms = Date.now() - (x.t0 || Date.now()); if (found) x.found = found; show(); };
    show();
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
      if (s.do === "click") { if (typeof s.x !== "number" || typeof s.y !== "number") return { ok: false }; if (s.x > 1 || s.y > 1) s = { ...s, x: s.x / 1000, y: s.y / 1000 }; }
      if (s.do === "type") {
        const t = String(s.text || "");
        const fly = A.act({ do: "type", text: "" }).catch(() => ({ ok: false }));
        api()?.copy(t);
        await wait(260);
        const k = await A.act({ do: "key", keys: "cmd+v" }).catch(() => ({ ok: false }));
        await fly;
        await wait(Math.min(1200, 200 + t.length / 6));
        return { ok: !!k.ok };
      }
      const res = await A.act(s).catch(() => ({ ok: false, items: [] }));
      if (s.do === "find") {
        const items = res.items || [];
        if (items.length) return { ok: true, found: items.map((i) => (i.folder ? "folder: " : "file: ") + i.path) };
        // macOS can hide Desktop/Documents/Downloads from the search, so use Spotlight like a person would
        await A.act({ do: "key", keys: "cmd+space" }).catch(() => ({ ok: false }));
        await wait(450);
        api()?.copy(String(s.name || ""));
        await wait(120);
        await A.act({ do: "key", keys: "cmd+v" }).catch(() => ({ ok: false }));
        await wait(1000);
        return { ok: true, found: ["Search found nothing, so Spotlight is now open with the name typed in. Look at the Spotlight results on screen and open the right one."] };
      }
      return { ok: !!res.ok };
    };
    const check = async (): Promise<{ steps: Step[]; done: boolean; last: boolean } | null> => {
      for (let tries = 0; tries < 2 && !stopRun.current; tries++) {
        const img = await A.shot().catch(() => null);
        const r = await fetch("/api/live/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal, plan: list, history: log.slice(1), image: img ? await shrink(img).catch(() => img) : null, installed: installed.current }),
        }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (r && (r.done || (Array.isArray(r.steps) && r.steps.length))) return { steps: r.done ? [] : r.steps.slice(0, 3), done: !!r.done, last: !!r.last };
      }
      return null;
    };
    const plan: Step[] = [];
    const did: Step[] = [];
    for (const s of list) { if (s.do === "open_path") break; plan.push(s); if (s.do === "find") break; }
    // The first app may already be opening
    const e = early.current;
    early.current = null;
    if (e && plan[0] && stepKey(plan[0]) === e.key) {
      const first = plan.shift() as Step;
      begin(first, e.t);
      const ok = await e.done;
      if (ok && e.at - e.t > 2500 && Date.now() - e.at < 1000) await wait(1000 - (Date.now() - e.at));
      finish(ok);
      if (ok) did.push(first);
    }
    let queue: Step[] = [...plan];
    let fails = 0, checks = 0, stopAfter = false, hidden = false, fixed = false;
    for (let round = 0; round < 30 && !stopRun.current && fails < 3; round++) {
      if (!queue.length) {
        if (stopAfter || checks++ >= 8) break;
        if (!fails && !hidden) { hidden = true; A.act({ do: "done" }).catch(() => ({ ok: false })); }
        const r = await check();
        if (stopRun.current || !r || r.done || !r.steps.length) break;
        queue = r.steps;
        stopAfter = r.last;
        fixed = true;
      }
      const s = queue.shift() as Step;
      begin(s);
      const r = await exec(s);
      finish(r.ok, r.found);
      if (r.ok && s.do !== "find" && s.do !== "wait") did.push(s.do === "click" ? { do: "click", target: s.target } : s);
      if (!r.ok) { fails += 1; queue = []; stopAfter = false; continue; }
      fails = 0;
      if (s.do === "find") queue = [];
    }
    await A.act({ do: "done" }).catch(() => ({ ok: false }));
    if (!stopRun.current && !fails && did.length) learn(routine && !fixed ? { routine } : { goal, steps: did });
  }

  // Speak with the ElevenLabs / Fish Audio voice, or the Mac voice if that is not set up
  function talk(t: string) {
    hush();
    setSpeaking(true);
    if (noCloud.current) { api()?.speak(t); return; }
    const a = new Audio("/api/live/speak?t=" + encodeURIComponent(t.slice(0, 600)));
    audioRef.current = a;
    const fallback = () => { noCloud.current = true; if (audioRef.current === a) { audioRef.current = null; api()?.speak(t); } };
    a.onended = () => setSpeaking(false);
    a.onerror = fallback;
    a.play().catch(fallback);
  }

  function hush() {
    const a = audioRef.current;
    audioRef.current = null;
    if (a) { a.onended = null; a.onerror = null; a.pause(); a.removeAttribute("src"); }
    api()?.stopSpeaking();
  }

  // Every ~1.3s while you talk, fetch "what was said so far" for the chatbox
  async function partial(sid: number) {
    if (!SHOW_WORDS) return;
    const r = rec.current, s = hearState.current;
    if (!r || s.busy || s.count >= 10 || r.chunks.length < 3 || r.chunks.length === s.seen) return;
    s.busy = true; s.count += 1; s.seen = r.chunks.length;
    try {
      const res = await fetch("/api/live/hear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: b64(wav(r.chunks.slice())) }) });
      const j = await res.json().catch(() => null);
      if (session.current === sid && viewRef.current === "listening" && j?.text) setHeard(String(j.text));
    } catch { /* live typing is optional */ } finally { s.busy = false; }
  }

  async function startRec() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const ctx = new AudioContext({ sampleRate: RATE });
    await ctx.resume().catch(() => {});
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    node.onaudioprocess = (ev) => {
      const d = ev.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      if (chunks.length === 1) setMicReady(true);
      const w = Math.floor(d.length / 7), lv: number[] = [];
      for (let k = 0; k < 7; k++) { let sum = 0; for (let j = k * w; j < (k + 1) * w; j += 8) sum += d[j] * d[j]; lv.push(Math.min(1, Math.sqrt(sum / (w / 8)) * 7)); }
      setLevels(lv);
      if (live.current) liveSend({ audio: { data: pcm16(d), mimeType: "audio/pcm;rate=" + ev.inputBuffer.sampleRate } });
      let sum = 0;
      for (let i = 0; i < d.length; i += 16) sum += d[i] * d[i];
      lvl.current = Math.min(1, Math.sqrt(sum / (d.length / 16)) * 6);
    };
    ctx.createMediaStreamSource(stream).connect(node);
    node.connect(ctx.destination);
    rec.current = { stream, ctx, node, chunks, t0: performance.now() };
    const sid = ++session.current;
    hearState.current = { busy: false, count: 0, seen: 0 };
    window.clearInterval(hearT.current);
    hearT.current = window.setInterval(() => partial(sid), 1700);
    const tick = () => {
      smooth.current += (lvl.current - smooth.current) * 0.3;
      latchRef.current?.style.setProperty("--lvl", smooth.current.toFixed(3));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  async function stopRec() {
    try { await starting.current; } catch { /* mic failed */ }
    starting.current = null;
    window.clearInterval(hearT.current);
    cancelAnimationFrame(raf.current);
    latchRef.current?.style.setProperty("--lvl", "0");
    const r = rec.current;
    rec.current = null;
    if (!r) return null;
    r.node.disconnect();
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
    return { secs: (performance.now() - r.t0) / 1000, audio: b64(wav(r.chunks)) };
  }

  function leave(then: () => void) {
    setLeaving(true);
    window.clearTimeout(leaveT.current);
    leaveT.current = window.setTimeout(then, 280);
  }

  function back() {
    const prev = turns.current.pop();
    if (prev) { last.current = prev; go("answer"); } else api()?.hide();
  }

  async function ask(audio: string, image: string | null) {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    lastAsk.current = { audio, image };
    const timer = window.setTimeout(() => ac.abort("timeout"), 75000);
    setRaw("");
    setDone(false);
    try {
      const pic = image && !liveRes.current ? await shrink(image).catch(() => image) : null;
      const res = await liveFetch("/api/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio, image: pic, history: turns.current.slice(-4), modes: custom, modeId: custom.some((m) => m.id === mode.id) ? mode.id : undefined, installed: installed.current }), signal: ac.signal });
      const type = res.headers.get("content-type") || "";
      if (type.includes("text/html")) throw new Error("Please sign in to ModeBuddy first.");
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        let msg = "";
        try { msg = JSON.parse(txt).error || ""; } catch { /* not JSON */ }
        throw new Error(msg || `Error ${res.status}: ${txt.replace(/\s+/g, " ").trim().slice(0, 140) || res.statusText || "no details"}`);
      }
      go("answer");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      askAt.current = Date.now();
      let text = "";
      let said = false;
      let earlyTried = false;
      let ran = false;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        text += dec.decode(value, { stream: true });
        setRaw(text);
        if (!said && /^\s*SAY\s*:.*\n/mi.test(text)) { said = true; const v = parse(text, false).say; if (v) talk(v); }
        if (!earlyTried) { const m = /^\s*DO\s*:\s*\[\s*(\{[^{}]*\})/m.exec(text); if (m) { earlyTried = true; try { openEarly(JSON.parse(m[1])); } catch { /* wait for the full plan */ } } }
        if (!ran) { const m = /^\s*DO\s*:\s*(\[.*\])\s*\n/m.exec(text); if (m) { try { const list = JSON.parse(m[1]); if (Array.isArray(list) && list.length) { ran = true; run(list.slice(0, 15), parse(text, false).heard || ""); } } catch { /* wait for the rest */ } } }
        if (!ran) { const u = /^\s*USE\s*:\s*(.+)\n/mi.exec(text); if (u) { const r = findRoutine(u[1]); if (r) { ran = true; run(r.steps.slice(0, 20), parse(text, false).heard || "", r.name); } } }
      }
      setDone(true);
      const p = parse(text, true);
      last.current = { q: p.heard || "(question)", a: p.answer || text };
      if (!ran && p.use) { const r = findRoutine(p.use); if (r) { ran = true; run(r.steps.slice(0, 20), p.heard || "", r.name); } }
      if (p.remember) learn({ note: p.remember });
      if (p.does && !ran) {
        try { const list = JSON.parse(p.does); if (Array.isArray(list) && list.length) run(list.slice(0, 15), p.heard || ""); } catch { /* not valid steps */ }
      }
      if (!said && p.say) talk(p.say);
    } catch (x) {
      if (ac.signal.aborted && ac.signal.reason !== "timeout") return;
      setErr(ac.signal.reason === "timeout" ? "ModeBuddy took too long to answer. Try again." : x instanceof Error ? x.message : "Something went wrong. Try again.");
      go("error");
    } finally {
      window.clearTimeout(timer);
    }
  }

  function retry() {
    const a = lastAsk.current;
    if (!a) return;
    setErr("");
    go("thinking");
    ask(a.audio, a.image);
  }

  useEffect(() => {
    handler.current = async (e: LiveEvent) => {
      if (e.type === "start") {
        window.clearTimeout(leaveT.current);
        setLeaving(false);
        abort.current?.abort();
        lastAsk.current = null;
        hush();
        stopRun.current = true;
        setSteps([]);
        early.current = null;
        setSpeaking(false);
        const had = viewRef.current === "answer" && last.current;
        if (had && last.current) turns.current.push(last.current);
        else turns.current = [];
        last.current = null;
        setFollow(!!had);
        setHeard("");
        setRaw("");
        setErr("");
        setCopied(false);
        setMicReady(false);
        go("listening");
        liveRes.current = null;
        liveOpen();
        liveSend({ activityStart: {} });
        starting.current = startRec();
      } else if (e.type === "stop") {
        await new Promise((ok) => setTimeout(ok, 250));
        const r = await stopRec();
        liveRes.current = liveFinish();
        if (!r) { setErr("ModeBuddy could not use the microphone. Open Live settings from the green dot and allow it."); go("error"); return; }
        if (r.secs < 0.5) { back(); return; }
        go("thinking");
        ask(r.audio, e.image ?? null);
      } else if (e.type === "cancel") {
        liveClose();
        await stopRec();
        back();
      } else if (e.type === "hide") {
        window.clearTimeout(leaveT.current);
        abort.current?.abort();
        await stopRec();
        turns.current = [];
        last.current = null;
        lastAsk.current = null;
        setRaw("");
        setErr("");
        setHeard("");
        liveClose();
        stopRun.current = true;
        setSteps([]);
        hush();
        setSpeaking(false);
        setLeaving(false);
        go("idle");
      } else if (e.type === "context") {
        if (e.apps) installed.current = e.apps;
        if (e.app) {
          const a = e.app.toLowerCase();
          const c = custom.find((m) => (m.apps || []).some((x) => a.includes(x.toLowerCase()) || x.toLowerCase().includes(a)));
          setMode(c ? { id: c.id, name: c.name, color: c.color, bg: "", icon: "" } : liveMode(appMode(e.app)));
        }
      } else if (e.type === "spoke") {
        setSpeaking(false);
      }
    };
  });

  useEffect(() => {
    document.documentElement.classList.add("lv-panel-root");
    const load = () => fetch("/api/live/modes").then((r) => r.json()).then((j) => setCustom(Array.isArray(j.modes) ? j.modes : [])).catch(() => {});
    load();
    loadMem();
    const iv = window.setInterval(() => { load(); loadMem(); }, 10 * 60 * 1000);
    const off = desktop()?.live?.onEvent((e) => handler.current(e));
    return () => { off?.(); window.clearInterval(iv); };
  }, []);

  const p = parse(raw, done);
  const isCard = view === "answer" || view === "error";

  useEffect(() => {
    if (!p.mode) return;
    const c = custom.find((m) => m.name.toLowerCase().replace(/[^a-z]/g, "") === p.mode);
    setMode((cur) => c ? { id: c.id, name: c.name, color: c.color, bg: "", icon: "" } : p.mode === "buddy" && custom.some((m) => m.id === cur.id) ? cur : liveMode(p.mode));
  }, [p.mode, custom]);

  // Measure the content so the latch grows smoothly to fit it
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setLatchH(Math.min(620, Math.ceil(el.offsetHeight)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const out = () => pasteable(p.answer || raw);
  const copy = () => { api()?.copy(out()); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const voice = () => {
    if (speaking) { hush(); setSpeaking(false); return; }
    const t = p.say || plain(p.answer).slice(0, 500);
    if (t) talk(t);
  };

  if (view === "idle") return <div className="gl-stage" />;

  const accent = view === "error" ? "#ff6b5e" : mode.color;
  const said = view === "listening" ? heard : p.heard || heard;
  const words = (said.length > 90 ? "…" + said.slice(-90) : said).split(" ").filter(Boolean);
  const style = { "--a": accent, "--on": onColor(accent), "--h": `${latchH}px` } as CSSProperties;

  return (
    <div className="gl-stage">
      <div ref={latchRef} className={`gl-latch ${leaving ? "out" : ""}`} data-view={view} data-mode={mode.id} style={style}
        onMouseMove={(e) => { const el = e.currentTarget, r = el.getBoundingClientRect(); el.style.setProperty("--mx", `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`); }}
        onMouseEnter={() => api()?.interactive(true)} onMouseLeave={() => api()?.interactive(false)}>
        <i className="gl-glint" key={isCard ? "a" : "b"} />
        <div ref={innerRef} className="gl-inner">
          <div className="gl-row">
            <div className="gl-logo"><Ghost state={steps.some((s) => s.state === "doing") ? "thinking" : view} /></div>
            <div className="gl-field">
              <p className={words.length ? "" : "ph"}>
                {words.length
                  ? words.map((wd, i) => <span key={i} className={view === "listening" && i >= words.length - 2 ? "tent" : ""}>{wd} </span>)
                  : view === "listening" ? (!micReady ? "One sec…" : follow ? "Ask a follow-up" : "Listening") : "…"}
                <span className={`gl-wave ${view}${view === "listening" && !micReady ? " wait" : ""}`}>{levels.map((l, i) => <b key={i} style={view === "listening" && micReady ? { height: `${Math.round(16 + l * 84)}%` } : undefined} />)}</span>
              </p>
              {view === "thinking" && <span className="gl-dots"><i /><i /><i /></span>}
            </div>
            <div className="gl-side">
              <span className="gl-mode"><i />{view === "error" ? "Error" : mode.name}</span>
              {isCard && <button className="gl-x" onClick={() => leave(() => api()?.hide())} aria-label="Close"><Icon name="close" /></button>}
            </div>
          </div>
          {isCard && (
            <div className="gl-body">
              <div className={`gl-text ${view === "error" ? "err" : ""}`}>
                {view === "error" ? <p>{err}</p> : steps.length ? <ol className="gl-steps">{steps.map((s, i) => <li key={i} className={s.state}>{s.label}{s.ms != null && <em>{(s.ms / 1000).toFixed(1)}s</em>}</li>)}</ol> : p.answer ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.answer}</ReactMarkdown> : <p className="gl-dim">Writing…</p>}
              </div>
              {(view === "error" ? !!lastAsk.current : done && !steps.length) && (
                <div className="gl-foot">
                  <span className="gl-cap">{view === "error" ? "Esc to close" : "⌘⌥ to follow up"}</span>
                  {view === "answer" && <button className="gl-btn" onClick={voice}><Icon name={speaking ? "stop" : "speaker"} />{speaking ? "Stop" : "Read"}</button>}
                  {view === "answer" && <button className="gl-btn" onClick={copy}><Icon name={copied ? "check" : "copy"} />{copied ? "Copied" : "Copy"}</button>}
                  <button className="gl-btn primary" onClick={view === "error" ? retry : () => leave(() => api()?.insert(out()))}>
                    <Icon name={view === "error" ? "retry" : "insert"} />{view === "error" ? "Try again" : "Insert"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The ModeBuddy ghost, drawn as a vector so it can blink, float, sway and jump
function Ghost({ state }: { state: View }) {
  return (
    <svg className={`gh gh-${state}`} viewBox="0 0 100 100" aria-hidden>
      <g className="gh-voice">
        <g className="gh-body">
          <path className="gh-shape" d="M23.75 43A26.25 26.25 0 0 1 76.25 43V76Q69.69 84 63.13 76Q56.56 84 50 76Q43.44 84 36.88 76Q30.31 84 23.75 76Z" />
          <g className="gh-eyes"><ellipse cx="41.25" cy="46" rx="2.8" ry="5.2" /><ellipse cx="58.75" cy="46" rx="2.8" ry="5.2" /></g>
          <g className="gh-happy"><path d="M37.5 48Q41.25 41 45 48" /><path d="M55 48Q58.75 41 62.5 48" /></g>
        </g>
      </g>
    </svg>
  );
}
