"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { desktop, type LiveEvent } from "../../../lib/desktop";
import { LIVE_MODES, liveMode, type LiveMode } from "../../../lib/liveModes";

type View = "idle" | "listening" | "thinking" | "answer" | "error";
type Rec = { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; chunks: Float32Array[]; t0: number };
type Turn = { q: string; a: string };
type IconName = "insert" | "copy" | "check" | "speaker" | "stop" | "close" | "retry";

const RATE = 16000;
const CARD_W = 520;
const BARS = 24;

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

// Make the screenshot smaller before sending: faster upload, faster answer
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

function Icon({ name }: { name: IconName }) {
  const p = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "insert": return <svg {...p}><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 20h14" /></svg>;
    case "copy": return <svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></svg>;
    case "check": return <svg {...p}><path d="m5 12.5 4.5 4.5 9.5-10" /></svg>;
    case "speaker": return <svg {...p}><path d="M5 9.5v5h3l4.5 4v-13l-4.5 4z" /><path d="M16 9.5a3.5 3.5 0 0 1 0 5" /></svg>;
    case "stop": return <svg {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>;
    case "retry": return <svg {...p}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.8h3.8" /></svg>;
    default: return <svg {...p}><path d="M7 7l10 10M17 7 7 17" /></svg>;
  }
}

export default function LivePanel() {
  const [view, setView] = useState<View>("idle");
  const [raw, setRaw] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(false);
  const [mode, setMode] = useState<LiveMode>(LIVE_MODES.buddy);
  const [cardH, setCardH] = useState(140);
  const [leaving, setLeaving] = useState(false);
  const viewRef = useRef<View>("idle");
  const rec = useRef<Rec | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const lvl = useRef(0);
  const smooth = useRef(0);
  const hist = useRef<number[]>([]);
  const lastPush = useRef(0);
  const raf = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const turns = useRef<Turn[]>([]);
  const last = useRef<Turn | null>(null);
  const lastAsk = useRef<{ audio: string; image: string | null } | null>(null);
  const leaveTimer = useRef(0);
  const waveRef = useRef<HTMLSpanElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const handler = useRef<(e: LiveEvent) => void>(() => {});

  const api = () => desktop()?.live;
  const go = (v: View) => { viewRef.current = v; setView(v); };

  async function startRec() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const ctx = new AudioContext({ sampleRate: RATE });
    await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    node.onaudioprocess = (ev) => {
      const d = ev.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let sum = 0;
      for (let i = 0; i < d.length; i += 16) sum += d[i] * d[i];
      lvl.current = Math.min(1, Math.sqrt(sum / (d.length / 16)) * 6);
    };
    src.connect(node);
    node.connect(ctx.destination);
    rec.current = { stream, ctx, node, chunks, t0: performance.now() };
    hist.current = [];
    smooth.current = 0;
    lastPush.current = 0;
    // Scrolling soundwave + timer, updated directly on the page (no React re-render each frame)
    const tick = (now: number) => {
      smooth.current += (lvl.current - smooth.current) * 0.4;
      if (now - lastPush.current > 70) {
        lastPush.current = now;
        hist.current.push(smooth.current);
        if (hist.current.length > BARS) hist.current.shift();
        const bars = waveRef.current?.children;
        if (bars) {
          const off = BARS - hist.current.length;
          for (let i = 0; i < bars.length; i++) {
            const v = i < off ? 0 : hist.current[i - off];
            (bars[i] as HTMLElement).style.transform = `scaleY(${(0.12 + Math.min(0.88, v * 1.2)).toFixed(3)})`;
          }
        }
        const r = rec.current;
        if (r && timeRef.current) {
          const s = Math.max(0, Math.floor((now - r.t0) / 1000));
          timeRef.current.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  async function stopRec() {
    try { await starting.current; } catch { /* mic failed */ }
    starting.current = null;
    cancelAnimationFrame(raf.current);
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
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(then, 160);
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
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, image: pic, history: turns.current.slice(-4) }),
        signal: ac.signal,
      });
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
    api()?.interactive(false);
    go("thinking");
    ask(a.audio, a.image);
  }

  useEffect(() => {
    handler.current = async (e: LiveEvent) => {
      const L = api();
      if (e.type === "start") {
        window.clearTimeout(leaveTimer.current);
        setLeaving(false);
        abort.current?.abort();
        lastAsk.current = null;
        L?.stopSpeaking();
        L?.interactive(false);
        setSpeaking(false);
        const had = viewRef.current === "answer" && last.current;
        if (had && last.current) turns.current.push(last.current);
        else turns.current = [];
        last.current = null;
        setFollow(!!had);
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
        window.clearTimeout(leaveTimer.current);
        abort.current?.abort();
        await stopRec();
        turns.current = [];
        last.current = null;
        lastAsk.current = null;
        setRaw("");
        setErr("");
        setSpeaking(false);
        setLeaving(false);
        go("idle");
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

  // Measure the card so the island can grow to fit it
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!isCard || !el) return;
    const measure = () => setCardH(Math.min(560, Math.ceil(el.offsetHeight)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isCard]);

  const out = () => pasteable(p.answer || raw);
  const copy = () => { api()?.copy(out()); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const voice = () => {
    const L = api();
    if (speaking) { L?.stopSpeaking(); setSpeaking(false); return; }
    const t = p.say || plain(p.answer).slice(0, 500);
    if (t) { setSpeaking(true); L?.speak(t); }
  };

  if (view === "idle") return <div className="lv3-stage" />;

  const [w, h] = isCard ? [CARD_W, cardH] : view === "thinking" ? [236, 40] : [268, 40];
  const style = { "--w": `${w}px`, "--h": `${h}px`, "--lv-a": view === "error" ? "#ff6b6b" : mode.color } as CSSProperties;

  return (
    <div className="lv3-stage">
      <div
        className={`lv3-island ${isCard ? "is-card" : ""} ${leaving ? "out" : ""}`}
        style={style}
        data-view={view}
        onMouseEnter={() => api()?.interactive(true)}
        onMouseLeave={() => api()?.interactive(false)}
      >
        {!isCard ? (
          <div className="lv3-pill" key={view} style={{ width: w }}>
            {view === "listening" ? (
              <>
                <span className="lv3-dot live" />
                <span className="lv3-label">{follow ? "Follow-up" : "Listening"}</span>
                <span className="lv3-wave" ref={waveRef}>{Array.from({ length: BARS }, (_, i) => <i key={i} />)}</span>
                <span className="lv3-time" ref={timeRef}>0:00</span>
              </>
            ) : (
              <>
                <span className="lv3-spin" />
                <span className="lv3-label">Thinking</span>
                <span className="lv3-sub">Reading your screen</span>
              </>
            )}
          </div>
        ) : (
          <div className="lv3-card" ref={cardRef} style={{ width: CARD_W }}>
            <div className="lv3-head">
              {view === "answer" && !done ? <span className="lv3-spin sm" /> : <span className="lv3-dot" />}
              <span className="lv3-mode">{view === "error" ? "Error" : mode.name}</span>
              {view === "answer" && p.heard && <span className="lv3-q">{p.heard}</span>}
              <button className="lv3-close" onClick={() => leave(() => api()?.hide())} aria-label="Close"><Icon name="close" /></button>
            </div>
            <div className="lv3-body">
              {view === "error" ? (
                <p className="lv3-err">{err}</p>
              ) : p.answer ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.answer}</ReactMarkdown>
              ) : (
                <p className="lv3-muted">Writing…</p>
              )}
            </div>
            {view === "answer" && done && (
              <div className="lv3-foot">
                <span className="lv3-hint">Hold ⌘⌥ to follow up</span>
                <button className="lv3-btn" onClick={voice}><Icon name={speaking ? "stop" : "speaker"} />{speaking ? "Stop" : "Read aloud"}</button>
                <button className="lv3-btn" onClick={copy}><Icon name={copied ? "check" : "copy"} />{copied ? "Copied" : "Copy"}</button>
                <button className="lv3-btn primary" onClick={() => leave(() => api()?.insert(out()))}><Icon name="insert" />Insert</button>
              </div>
            )}
            {view === "error" && lastAsk.current && (
              <div className="lv3-foot">
                <span className="lv3-hint">Esc to close</span>
                <button className="lv3-btn primary" onClick={retry}><Icon name="retry" />Try again</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
