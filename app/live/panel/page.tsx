"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { desktop, type LiveEvent } from "../../../lib/desktop";

type View = "idle" | "listening" | "thinking" | "answer" | "error";
type Rec = { stream: MediaStream; ctx: AudioContext; node: ScriptProcessorNode; chunks: Float32Array[]; t0: number };
type Turn = { q: string; a: string };

const RATE = 16000;
const MODES: Record<string, string> = { code: "Code", study: "Study", general: "General" };

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

function Bars({ level }: { level: number }) {
  return (
    <span className="lv-bars">
      {[0.5, 0.8, 1, 0.8, 0.5].map((k, i) => <i key={i} style={{ height: 4 + Math.round(level * 14 * k) }} />)}
    </span>
  );
}

export default function LivePanel() {
  const [view, setView] = useState<View>("idle");
  const [raw, setRaw] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [follow, setFollow] = useState(false);
  const viewRef = useRef<View>("idle");
  const rec = useRef<Rec | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const lvl = useRef(0);
  const raf = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const turns = useRef<Turn[]>([]);
  const last = useRef<Turn | null>(null);
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
    const tick = () => { setLevel(lvl.current); raf.current = requestAnimationFrame(tick); };
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

  function back() {
    const prev = turns.current.pop();
    if (prev) { last.current = prev; go("answer"); } else api()?.hide();
  }

  async function ask(audio: string, image: string | null) {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRaw("");
    setDone(false);
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, image, history: turns.current.slice(-4) }),
        signal: ac.signal,
      });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !res.body || type.includes("text/html")) {
        const j = type.includes("json") ? await res.json().catch(() => null) : null;
        throw new Error(j?.error || (type.includes("text/html") ? "Please sign in to ModeBuddy first." : "Something went wrong. Try again."));
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
      if (ac.signal.aborted) return;
      setErr(x instanceof Error ? x.message : "Something went wrong. Try again.");
      go("error");
    }
  }

  useEffect(() => {
    handler.current = async (e: LiveEvent) => {
      const L = api();
      if (e.type === "start") {
        abort.current?.abort();
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
        abort.current?.abort();
        await stopRec();
        turns.current = [];
        last.current = null;
        setRaw("");
        setErr("");
        setSpeaking(false);
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
  const out = () => pasteable(p.answer || raw);
  const insert = () => api()?.insert(out());
  const copy = () => { api()?.copy(out()); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const voice = () => {
    const L = api();
    if (speaking) { L?.stopSpeaking(); setSpeaking(false); return; }
    const t = p.say || plain(p.answer).slice(0, 500);
    if (t) { setSpeaking(true); L?.speak(t); }
  };

  if (view === "idle") return <div className="lv-stage" />;

  if (view === "listening" || view === "thinking") {
    return (
      <div className="lv-stage">
        <div className="lv-pill">
          <span className={`lv-dot ${view}`} />
          {view === "listening" && <Bars level={level} />}
          <span className="lv-label">
            {view === "thinking" ? "Thinking…" : follow ? "Follow-up… let go to send" : "Listening… let go to send"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="lv-stage">
      <div className="lv-card" onMouseEnter={() => api()?.interactive(true)} onMouseLeave={() => api()?.interactive(false)}>
        <div className="lv-head">
          <span className="lv-dot" />
          {view === "answer" && MODES[p.mode] && <span className="lv-mode">{MODES[p.mode]}</span>}
          <span className="lv-heard">{view === "error" ? "ModeBuddy Live" : p.heard ? `“${p.heard}”` : "…"}</span>
          <button className="lv-x" onClick={() => api()?.hide()} aria-label="Close">✕</button>
        </div>
        <div className="lv-body">
          {view === "error" ? (
            <p className="lv-err">{err}</p>
          ) : p.answer ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.answer}</ReactMarkdown>
          ) : (
            <p className="lv-wait">Thinking…</p>
          )}
        </div>
        {view === "answer" && done && (
          <div className="lv-foot">
            <button className="lv-btn primary" onClick={insert}>Insert</button>
            <button className="lv-btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            <button className="lv-btn" onClick={voice}>{speaking ? "Stop voice" : "Read aloud"}</button>
            <span className="lv-hint">Hold ⌘⌥ to follow up · Esc to close</span>
          </div>
        )}
      </div>
    </div>
  );
}
