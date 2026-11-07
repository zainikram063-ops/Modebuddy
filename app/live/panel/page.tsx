"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { desktop, type LiveEvent } from "../../../lib/desktop";
import { LIVE_MODES, liveMode, type LiveMode } from "../../../lib/liveModes";

type View = "idle" | "listening" | "thinking" | "answer" | "error";
type Rec = { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; chunks: Float32Array[]; t0: number };
type Turn = { q: string; a: string };
type IconName = "code" | "study" | "buddy" | "insert" | "copy" | "check" | "speaker" | "close" | "retry" | "alert";

const RATE = 16000;
const CARD_W = 560;
const RING = 880;
const BAR_K = [0.45, 0.7, 0.95, 1.15, 1.3, 1.15, 0.95, 0.7, 0.45];

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
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "code": return <svg viewBox="0 0 24 24" {...p}><path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5" /></svg>;
    case "study": return <svg viewBox="0 0 24 24" {...p}><path d="M3 5.5c2.7-1.4 5.7-1.4 9 .6 3.3-2 6.3-2 9-.6V19c-2.7-1.4-5.7-1.4-9 .6-3.3-2-6.3-2-9-.6z" /><path d="M12 6.1v13.5" /></svg>;
    case "buddy": return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.8l1.9 5.6 5.6 1.9-5.6 1.9L12 17.8l-1.9-5.6-5.6-1.9 5.6-1.9z" /><circle cx="19" cy="18" r="1.6" /><circle cx="5.5" cy="18.5" r="1.1" /></svg>;
    case "insert": return <svg viewBox="0 0 24 24" {...p}><path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14" /></svg>;
    case "copy": return <svg viewBox="0 0 24 24" {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" /></svg>;
    case "check": return <svg viewBox="0 0 24 24" {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
    case "speaker": return <svg viewBox="0 0 24 24" {...p}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
    case "close": return <svg viewBox="0 0 24 24" {...p} strokeWidth={2.6}><path d="M6 6l12 12M18 6 6 18" /></svg>;
    case "retry": return <svg viewBox="0 0 24 24" {...p}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v4h4" /></svg>;
    default: return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>;
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
  const [cardH, setCardH] = useState(150);
  const [leaving, setLeaving] = useState(false);
  const viewRef = useRef<View>("idle");
  const rec = useRef<Rec | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const lvl = useRef(0);
  const smooth = useRef(0);
  const raf = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const turns = useRef<Turn[]>([]);
  const last = useRef<Turn | null>(null);
  const lastAsk = useRef<{ audio: string; image: string | null } | null>(null);
  const leaveTimer = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<HTMLSpanElement | null>(null);
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
    // Drive the orb + soundwave straight on the page (no React re-render each frame)
    const tick = () => {
      smooth.current += (lvl.current - smooth.current) * 0.35;
      const s = smooth.current;
      stageRef.current?.style.setProperty("--lvl", s.toFixed(3));
      const bars = barsRef.current?.children;
      if (bars) for (let i = 0; i < bars.length; i++) {
        const v = 0.18 + Math.min(0.82, s * BAR_K[i] * (0.75 + Math.random() * 0.5));
        (bars[i] as HTMLElement).style.transform = `scaleY(${v.toFixed(3)})`;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  async function stopRec() {
    try { await starting.current; } catch { /* mic failed */ }
    starting.current = null;
    cancelAnimationFrame(raf.current);
    stageRef.current?.style.setProperty("--lvl", "0");
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
    leaveTimer.current = window.setTimeout(then, 260);
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

  // The island takes on the colours of the mode the AI picked
  useEffect(() => { if (p.mode) setMode(liveMode(p.mode)); }, [p.mode]);

  // Measure the card so the island can grow to fit it
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!isCard || !el) return;
    const measure = () => setCardH(Math.min(600, Math.ceil(el.offsetHeight)));
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

  if (view === "idle") return <div className="lvx-stage" ref={stageRef} />;

  const [w, h] = isCard ? [CARD_W, cardH] : view === "thinking" ? [236, 52] : [300, 52];
  const wrapStyle = {
    "--w": `${w}px`,
    "--h": `${h}px`,
    "--r": "26px",
    "--lv-a": view === "error" ? "#f87171" : mode.color,
    "--lv-bg": mode.bg,
  } as CSSProperties;

  return (
    <div className="lvx-stage" ref={stageRef}>
      <div className="lvx-wrap" style={wrapStyle}>
        <div className={`lvx-aura ${leaving ? "out" : ""}`} />
        <div
          className={`lvx-island ${leaving ? "out" : ""}`}
          data-view={view}
          data-mode={mode.id}
          onMouseEnter={() => api()?.interactive(true)}
          onMouseLeave={() => api()?.interactive(false)}
        >
          <i className="lvx-ring" style={{ width: RING, height: RING, marginLeft: -RING / 2, marginTop: -RING / 2 }} />
          <i className="lvx-fill" />

          {!isCard ? (
            <div className="lvx-c" style={{ width: w }} key={view}>
              <div className="lvx-pill">
                {view === "listening" ? (
                  <span className="lvx-orb"><i className="lvx-rip" /><i className="lvx-rip b" /><i className="lvx-core" /></span>
                ) : (
                  <span className="lvx-orb"><i className="lvx-spin" /><i className="lvx-core-s" /></span>
                )}
                <span className="lvx-label">
                  <b>{view === "thinking" ? "Thinking" : follow ? "Follow-up" : "Listening"}</b>
                  <em>{view === "thinking" ? "looking at your screen" : "let go to send"}</em>
                </span>
                {view === "listening" ? (
                  <span className="lvx-bars" ref={barsRef}>{BAR_K.map((_, i) => <i key={i} />)}</span>
                ) : (
                  <span className="lvx-dots"><i /><i /><i /></span>
                )}
              </div>
            </div>
          ) : (
            <div className="lvx-c" style={{ width: CARD_W }}>
              <div ref={cardRef} className={`lvx-card ${view === "answer" && !done ? "streaming" : ""}`}>
                <div className="lvx-head">
                  <span className="lvx-chip">
                    {view === "error" ? <><Icon name="alert" /> Live</> : <>{mode.icon ? <span className="lvx-emoji">{mode.icon}</span> : <Icon name={mode.id} />} {mode.name}</>}
                  </span>
                  <span className="lvx-heard">{view === "error" ? "ModeBuddy Live" : p.heard ? `“${p.heard}”` : "…"}</span>
                  <button className="lvx-x" onClick={() => leave(() => api()?.hide())} aria-label="Close"><Icon name="close" /></button>
                </div>
                <div className="lvx-body">
                  {view === "error" ? (
                    <p className="lvx-err">{err}</p>
                  ) : p.answer ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.answer}</ReactMarkdown>
                  ) : (
                    <p className="lvx-wait"><span className="lvx-dots"><i /><i /><i /></span> Writing your answer</p>
                  )}
                </div>
                {view === "answer" && done ? (
                  <div className="lvx-foot">
                    <button className="lvx-btn primary" onClick={() => leave(() => api()?.insert(out()))}><Icon name="insert" /> Insert</button>
                    <button className="lvx-btn" onClick={copy}>{copied ? <><Icon name="check" /> Copied</> : <><Icon name="copy" /> Copy</>}</button>
                    <button className="lvx-btn" onClick={voice}>
                      {speaking ? <><span className="lvx-eq"><i /><i /><i /></span> Stop</> : <><Icon name="speaker" /> Read aloud</>}
                    </button>
                    <span className="lvx-hint"><kbd>⌘⌥</kbd> follow up <kbd>esc</kbd></span>
                  </div>
                ) : view === "error" && lastAsk.current ? (
                  <div className="lvx-foot">
                    <button className="lvx-btn primary" onClick={retry}><Icon name="retry" /> Try again</button>
                    <span className="lvx-hint"><kbd>esc</kbd> close</span>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
