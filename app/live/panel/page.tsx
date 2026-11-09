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
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { const s = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(v.buffer);
}

function b64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return btoa(s);
}

function shrink(img64: string, max = 1440, q = 0.65): Promise<string> {
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
  return { heard: get("HEARD"), mode: get("MODE").toLowerCase().replace(/[^a-z]/g, ""), say: get("SAY"), answer };
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
  const [heard, setHeard] = useState("");
  const [latchH, setLatchH] = useState(88);
  const [leaving, setLeaving] = useState(false);
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

  // Every ~1.3s while you talk, fetch "what was said so far" for the chatbox
  async function partial(sid: number) {
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
    hearT.current = window.setInterval(() => partial(sid), 1300);
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
      const pic = image ? await shrink(image).catch(() => image) : null;
      const res = await fetch("/api/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio, image: pic, history: turns.current.slice(-4) }), signal: ac.signal });
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
      let text = "";
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        text += dec.decode(value, { stream: true });
        setRaw(text);
      }
      setDone(true);
      const p = parse(text, true);
      last.current = { q: p.heard || "(question)", a: p.answer || text };
      if (p.say) { setSpeaking(true); api()?.speak(p.say); }
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
      const L = api();
      if (e.type === "start") {
        window.clearTimeout(leaveT.current);
        setLeaving(false);
        abort.current?.abort();
        lastAsk.current = null;
        L?.stopSpeaking();
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
        go("listening");
        starting.current = startRec();
      } else if (e.type === "stop") {
        const r = await stopRec();
        if (!r) { setErr("ModeBuddy could not use the microphone. Open Live settings from the green dot and allow it."); go("error"); return; }
        if (r.secs < 0.5) { back(); return; }
        go("thinking");
        ask(r.audio, e.image ?? null);
      } else if (e.type === "cancel") {
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
        setSpeaking(false);
        setLeaving(false);
        go("idle");
      } else if (e.type === "context") {
        if (e.app) setMode(liveMode(appMode(e.app)));
      } else if (e.type === "spoke") {
        setSpeaking(false);
      }
    };
  });

  useEffect(() => {
    document.documentElement.classList.add("lv-panel-root");
    const off = desktop()?.live?.onEvent((e) => handler.current(e));
    return () => { off?.(); };
  }, []);

  const p = parse(raw, done);
  const isCard = view === "answer" || view === "error";

  useEffect(() => { if (p.mode) setMode(liveMode(p.mode)); }, [p.mode]);

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
    const L = api();
    if (speaking) { L?.stopSpeaking(); setSpeaking(false); return; }
    const t = p.say || plain(p.answer).slice(0, 500);
    if (t) { setSpeaking(true); L?.speak(t); }
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
            <div className="gl-logo"><Ghost state={view} /></div>
            <div className="gl-field">
              <p className={words.length ? "" : "ph"}>
                {words.length
                  ? words.map((wd, i) => <span key={i} className={view === "listening" && i >= words.length - 2 ? "tent" : ""}>{wd} </span>)
                  : view === "listening" ? (follow ? "Ask a follow-up" : "Listening") : "…"}
                {view === "listening" && <i className="gl-caret" />}
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
                {view === "error" ? <p>{err}</p> : p.answer ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.answer}</ReactMarkdown> : <p className="gl-dim">Writing…</p>}
              </div>
              {(view === "error" ? !!lastAsk.current : done) && (
                <div className="gl-foot">
                  <span className="gl-cap">{view === "error" ? "Esc to close" : "Hold ⌘⌥ to follow up"}</span>
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
