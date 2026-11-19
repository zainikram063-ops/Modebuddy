"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { desktop, type LiveEvent } from "../../../lib/desktop";
import { LIVE_MODES, liveMode, type LiveMode } from "../../../lib/liveModes";
import { startMic, wav, b64, shrink, type Mic } from "../../../lib/live/audio";
import { openEars, type Ears } from "../../../lib/live/ears";
import { parse, pasteable, plain, onColor, appMode } from "../../../lib/live/parse";
import { talk, hush, warmVoice } from "../../../lib/live/voice";
import { setInstalled, getInstalled, loadMemory, learn, findRoutine, openEarly, runTask, stopTasks, type Step, type StepView } from "../../../lib/live/agent";

type View = "idle" | "listening" | "thinking" | "answer" | "error";
type Turn = { q: string; a: string };
type Ask = { text: string; audio?: string; image: string | null };
type Custom = { id: string; name: string; color: string; apps: string[]; sites: string[] };

const ICONS: Record<string, string> = {
  insert: "M12 4v11M7.5 10.5l4.5 4.5 4.5-4.5M5 20h14",
  copy: "M8.5 10.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2zM15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5",
  check: "M5 12.5l4.5 4.5 9.5-10",
  speaker: "M5 9.5v5h3l4.5 4v-13l-4.5 4zM16 9.5a3.5 3.5 0 0 1 0 5",
  stop: "M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7z",
  retry: "M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8",
  close: "M7 7l10 10M17 7L7 17",
  up: "M7 14.5l5-5 5 5",
  down: "M7 9.5l5 5 5-5",
};
const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICONS[name]} /></svg>
);
const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const secs = (ms: number) => (ms / 1000).toFixed(1) + "s";

export default function LivePanel() {
  const [view, setView] = useState<View>("idle");
  const [raw, setRaw] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mini, setMini] = useState(false); // latch tucked into a small pill
  useEffect(() => { if (view === "listening" || view === "idle") setMini(false); }, [view]);
  const tuck = () => { setMini(true); setTimeout(() => latchApi()?.interactive?.(false), 0); };
  const grab = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button,a,input,textarea")) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    latchApi()?.drag?.(true);
    const up = () => { latchApi()?.drag?.(false); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const [mode, setMode] = useState<LiveMode>(LIVE_MODES.buddy);
  const [custom, setCustom] = useState<Custom[]>([]);
  const [heard, setHeard] = useState("");
  const [latchH, setLatchH] = useState(88);
  const [leaving, setLeaving] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [levels, setLevels] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [timing, setTiming] = useState({ cap: "", info: "" });
  const viewRef = useRef<View>("idle");
  const mic = useRef<Promise<Mic | null> | null>(null);
  const ears = useRef<Ears | null>(null);
  const abort = useRef<AbortController | null>(null);
  const turns = useRef<Turn[]>([]);
  const last = useRef<Turn | null>(null);
  const lastAsk = useRef<Ask | null>(null);
  const frontApp = useRef("");
  const tm = useRef({ t0: 0, heard: 0, first: 0, voice: 0, model: "" });
  const lvl = useRef(0), smooth = useRef(0), raf = useRef(0), leaveT = useRef(0);
  const latchRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const handler = useRef<(e: LiveEvent) => void>(() => {});

  const api = () => desktop()?.live;
  const go = (v: View) => { viewRef.current = v; setView(v); };

  // How long each part took after you let go (shown under the answer; hover it for details)
  const stamp = () => {
    const t = tm.current;
    const at = (x: number) => (x ? secs(x - t.t0) : "–");
    setTiming({ cap: t.voice || t.first ? secs((t.voice || t.first) - t.t0) : "", info: `heard ${at(t.heard)} · first words ${at(t.first)} · voice ${at(t.voice)}${t.model ? " · " + t.model : ""}` });
  };

  const speak = (say: string) => {
    setSpeaking(true);
    talk(say, () => { if (!tm.current.voice) { tm.current.voice = Date.now(); stamp(); } }, () => setSpeaking(false));
  };

  // The soft glow that follows your voice while you talk
  const glow = (on: boolean) => {
    cancelAnimationFrame(raf.current);
    if (!on) { latchRef.current?.style.setProperty("--lvl", "0"); return; }
    const tick = () => {
      smooth.current += (lvl.current - smooth.current) * 0.3;
      latchRef.current?.style.setProperty("--lvl", smooth.current.toFixed(3));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  // Stops the mic (if it started) and hands back the recording
  async function stopMic() {
    const pending = mic.current;
    mic.current = null;
    glow(false);
    const m = pending ? await pending : null;
    return m ? m.stop() : null;
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

  const doTask = (list: Step[], goal: string, routine: string, t0: number) => {
    runTask(list, goal, routine, t0, setSteps).then((ok) => { if (!ok) { setErr("Update the ModeBuddy Mac app so it can do things for you."); go("error"); } });
  };

  // Sends your words (or the recording) and the screen to the smart brain, and streams the answer in
  async function ask(q: Ask, t0: number) {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    lastAsk.current = q;
    const timer = window.setTimeout(() => ac.abort("timeout"), 75000);
    setRaw("");
    setDone(false);
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          text: q.text || undefined, audio: q.audio, image: q.image, history: turns.current.slice(-4),
          modes: custom, modeId: custom.some((m) => m.id === mode.id) ? mode.id : undefined, installed: getInstalled(), app: frontApp.current || undefined,
        }),
      });
      if ((res.headers.get("content-type") || "").includes("text/html")) throw new Error("Please sign in to ModeBuddy first.");
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "");
        let msg = "";
        try { msg = JSON.parse(txt).error || ""; } catch { /* not JSON */ }
        throw new Error(msg || `Error ${res.status}: ${txt.replace(/\s+/g, " ").trim().slice(0, 140) || res.statusText || "no details"}`);
      }
      const model = res.headers.get("x-live-model") || "";
      go("answer");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "", said = false, tried = false, ran = false;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        text += dec.decode(value, { stream: true });
        if (!tm.current.first) { tm.current.first = Date.now(); tm.current.model = model; stamp(); }
        setRaw(text);
        const p = parse(text, false);
        const goal = q.text || p.heard;
        if (!said && /^\s*SAY\s*:.*\n/mi.test(text)) { said = true; if (p.say) speak(p.say); }
        if (!tried) { const m = /^\s*DO\s*:\s*\[\s*(\{[^{}]*\})/m.exec(text); if (m) { tried = true; try { openEarly(JSON.parse(m[1]), goal, () => viewRef.current !== "idle"); } catch { /* wait for the full plan */ } } }
        if (!ran) { const m = /^\s*DO\s*:\s*(\[.*\])\s*\n/m.exec(text); if (m) { try { const list = JSON.parse(m[1]); if (Array.isArray(list) && list.length) { ran = true; doTask(list.slice(0, 15), goal, "", t0); } } catch { /* wait for the rest */ } } }
        if (!ran) { const u = /^\s*USE\s*:\s*(.+)\n/mi.exec(text); if (u) { const r = findRoutine(u[1]); if (r) { ran = true; doTask(r.steps.slice(0, 20), goal, r.name, t0); } } }
      }
      const p = parse(text, true);
      const goal = q.text || p.heard;
      if (!q.text && p.heard) setHeard(p.heard);
      last.current = { q: goal || "(question)", a: p.answer || text };
      if (!ran && p.use) { const r = findRoutine(p.use); if (r) { ran = true; doTask(r.steps.slice(0, 20), goal, r.name, t0); } }
      if (!ran && p.does) { try { const list = JSON.parse(p.does); if (Array.isArray(list) && list.length) { ran = true; doTask(list.slice(0, 15), goal, "", t0); } } catch { /* not valid steps */ } }
      if (p.remember) learn({ note: p.remember });
      if (!said && p.say) speak(p.say);
      setDone(true);
      stamp();
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
    const t0 = Date.now();
    tm.current = { t0, heard: 0, first: 0, voice: 0, model: "" };
    ask(a, t0);
  }

  useEffect(() => {
    handler.current = async (e: LiveEvent) => {
      if (e.type === "start") {
        window.clearTimeout(leaveT.current);
        setLeaving(false);
        abort.current?.abort();
        ears.current?.close();
        ears.current = null;
        if (mic.current) await stopMic();
        hush();
        stopTasks();
        setSteps([]);
        setSpeaking(false);
        const had = viewRef.current === "answer" && last.current;
        if (had && last.current) turns.current.push(last.current);
        else turns.current = [];
        last.current = null;
        lastAsk.current = null;
        setHeard("");
        setRaw("");
        setErr("");
        setCopied(false);
        setMicReady(false);
        setTiming({ cap: "", info: "" });
        go("listening");
        // While you talk: wake up the brain and the voice, and open the ears
        fetch("/api/live", { cache: "no-store" }).catch(() => {});
        warmVoice();
        const ear = openEars(fetch("/api/live/ears", { method: "POST" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
        ears.current = ear;
        mic.current = startMic((d, rate) => ear.hear(d, rate), (b, level) => { setLevels(b); lvl.current = level; setMicReady(true); }).catch(() => null);
        glow(true);
      } else if (e.type === "stop") {
        const t0 = Date.now();
        await wait(100); // let your last word reach the mic
        const rec = await stopMic();
        const ear = ears.current;
        ears.current = null;
        if (!rec) { ear?.close(); setErr("ModeBuddy could not use the microphone. Open Live settings from the green dot and allow it."); go("error"); return; }
        if (rec.secs < 0.5) { ear?.close(); back(); return; }
        go("thinking");
        tm.current = { t0, heard: 0, first: 0, voice: 0, model: "" };
        const shot = e.image ?? null;
        const [words, image] = await Promise.all([ear ? ear.finish() : Promise.resolve(""), shot ? shrink(shot).catch(() => shot) : Promise.resolve(null)]);
        if (viewRef.current !== "thinking") return; // you pressed again or closed it
        if (words) { tm.current.heard = Date.now(); setHeard(words); }
        ask({ text: words, audio: words ? undefined : b64(wav(rec.chunks)), image }, t0);
      } else if (e.type === "cancel") {
        ears.current?.close();
        ears.current = null;
        await stopMic();
        back();
      } else if (e.type === "hide") {
        window.clearTimeout(leaveT.current);
        abort.current?.abort();
        ears.current?.close();
        ears.current = null;
        await stopMic();
        turns.current = [];
        last.current = null;
        lastAsk.current = null;
        setRaw("");
        setErr("");
        setHeard("");
        setSteps([]);
        stopTasks();
        hush();
        setSpeaking(false);
        setLeaving(false);
        go("idle");
      } else if (e.type === "context") {
        if (e.apps) setInstalled(e.apps);
        if (e.app) {
          frontApp.current = e.app;
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
    loadMemory();
    const iv = window.setInterval(() => { load(); loadMemory(); }, 10 * 60 * 1000);
    const off = desktop()?.live?.onEvent((e) => handler.current(e));
    return () => { off?.(); window.clearInterval(iv); };
  }, []);

  const p = parse(raw, done);
  const isCard = view === "answer" || view === "error";

  useEffect(() => {
    if (!p.mode) return;
    const c = custom.find((m) => m.name.toLowerCase().replace(/[^a-z]/g, "") === p.mode);
    setMode((cur) => (c ? { id: c.id, name: c.name, color: c.color, bg: "", icon: "" } : p.mode === "buddy" && custom.some((m) => m.id === cur.id) ? cur : liveMode(p.mode)));
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
    if (t) speak(t);
  };

  if (view === "idle") return <div className="gl-stage" />;

  const accent = view === "error" ? "#ff6b5e" : mode.color;
  const style = { "--a": accent, "--on": onColor(accent), "--h": `${latchH}px` } as CSSProperties;
  const words = view === "listening" ? "" : heard || p.heard;

  return (
    <div className={"gl-stage" + (mini ? " gl-mini-on" : "")}>
      <style>{LATCH_CSS}</style>
      {mini && <LatchPill label={view === "error" ? "Something went wrong" : view === "thinking" || steps.some((s) => s.state === "doing") ? "Working…" : speaking ? "Talking…" : view === "answer" ? "Answer ready" : "ModeBuddy"} ghost={steps.some((s) => s.state === "doing") ? "thinking" : view} onOpen={() => setMini(false)} />}
      <div ref={latchRef} className={`gl-latch ${leaving ? "out" : ""}`} data-view={view} data-mode={mode.id} style={style}
        onMouseMove={(e) => { const el = e.currentTarget, r = el.getBoundingClientRect(); el.style.setProperty("--mx", `${Math.round(((e.clientX - r.left) / r.width) * 100)}%`); }}
        onMouseEnter={() => api()?.interactive(true)} onMouseLeave={() => api()?.interactive(false)}>
        <i className="gl-glint" key={isCard ? "a" : "b"} />
        <div ref={innerRef} className="gl-inner">
          <div className="gl-row" onPointerDown={grab} onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) latchApi()?.home?.(); }}>
            <div className="gl-logo"><Ghost state={steps.some((s) => s.state === "doing") ? "thinking" : view} /></div>
            <div className="gl-field">
              {words
                ? <span className="gl-heard" title={words}>{words}</span>
                : <span className={`gl-wave ${view}${view === "listening" && !micReady ? " wait" : ""}`}>{levels.map((l, i) => <b key={i} style={view === "listening" && micReady ? { height: `${Math.round(16 + l * 84)}%` } : undefined} />)}</span>}
              {view === "thinking" && <span className="gl-dots"><i /><i /><i /></span>}
            </div>
            <div className="gl-side">
              <span className="gl-mode"><i />{view === "error" ? "Error" : mode.name}</span>
              {view !== "listening" && latchApi()?.drag && <button className="gl-up" onClick={tuck} aria-label="Latch up" title="Latch up"><Icon name="up" /></button>}
              {isCard && <button className="gl-x" onClick={() => leave(() => api()?.hide())} aria-label="Close"><Icon name="close" /></button>}
            </div>
          </div>
          {isCard && (
            <div className="gl-body">
              <div className={`gl-text ${view === "error" ? "err" : ""}`}>
                {view === "error" ? <p>{err}</p> : steps.length ? <ol className="gl-steps">{steps.map((s, i) => <li key={i} className={s.state}>{s.label}{s.ms != null && <em>{secs(s.ms)}</em>}</li>)}</ol> : p.answer ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.answer}</ReactMarkdown> : <p className="gl-dim">Writing…</p>}
              </div>
              {(view === "error" ? !!lastAsk.current : done && !steps.length) && (
                <div className="gl-foot">
                  <span className="gl-cap" title={timing.info}>{view === "error" ? "Esc to close" : "⌘⌥ to follow up" + (timing.cap ? " · " + timing.cap : "")}</span>
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


/* ---------- Latch: tuck it into a small pill, drag it anywhere ---------- */
type LatchApi = { interactive?: (on: boolean) => unknown; drag?: (on: boolean) => unknown; home?: () => unknown };
function latchApi(): LatchApi | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { modebuddy?: { live?: LatchApi } }).modebuddy?.live;
}

const LATCH_CSS = [
  ".gl-mini-on .gl-latch{visibility:hidden!important;pointer-events:none!important}",
  ".gl-row{cursor:grab}",
  ".gl-row button{cursor:pointer}",
  ".gl-up{width:26px;height:26px;display:grid;place-items:center;flex:none;border:0;border-radius:50%;background:transparent;color:inherit;opacity:.65;cursor:pointer;transition:opacity .15s,background .15s}",
  ".gl-up:hover{opacity:1;background:rgba(255,255,255,.1)}",
  ".gl-up svg{width:16px;height:16px}",
  ".gl-pill{position:absolute;top:6px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;height:38px;padding:0 7px 0 6px;border-radius:999px;background:rgba(20,22,15,.94);border:1px solid rgba(196,255,46,.2);box-shadow:0 8px 24px rgba(0,0,0,.35);color:#fbfeea;font-size:13px;font-weight:500;white-space:nowrap;cursor:grab;user-select:none;-webkit-user-select:none;animation:glPillIn .25s ease}",
  ".gl-pill:active{cursor:grabbing}",
  ".gl-pill-logo{width:26px;height:26px;display:grid;place-items:center}",
  ".gl-pill-logo svg{width:26px;height:26px}",
  ".gl-pill-text{padding-right:2px}",
  ".gl-pill-open{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;color:#c4ff2e;background:rgba(196,255,46,.14);transition:background .15s}",
  ".gl-pill:hover .gl-pill-open{background:rgba(196,255,46,.26)}",
  ".gl-pill-open svg{width:14px;height:14px}",
  "@keyframes glPillIn{from{opacity:0;transform:translateX(-50%) translateY(-6px) scale(.96)}}",
].join("");

function LatchPill({ label, ghost, onOpen }: { label: string; ghost: Parameters<typeof Ghost>[0]["state"]; onOpen: () => void }) {
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget, sx = e.screenX, sy = e.screenY;
    el.setPointerCapture(e.pointerId);
    latchApi()?.drag?.(true);
    const up = (ev: PointerEvent) => {
      latchApi()?.drag?.(false);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (ev.type === "pointerup" && Math.abs(ev.screenX - sx) < 4 && Math.abs(ev.screenY - sy) < 4) onOpen();
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return (
    <div className="gl-pill" role="button" aria-label="Open ModeBuddy" title="Drag to move · click to open" onPointerDown={down}
      onMouseEnter={() => latchApi()?.interactive?.(true)} onMouseLeave={() => latchApi()?.interactive?.(false)}>
      <span className="gl-pill-logo"><Ghost state={ghost} /></span>
      <span className="gl-pill-text">{label}</span>
      <span className="gl-pill-open"><Icon name="down" /></span>
    </div>
  );
}
