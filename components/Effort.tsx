"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";

/* Effort slider (Low to Ultra), each with its own animation, plus Ultra code in Kodra (purple theme and the ghost's spell) */
const LEVELS = [
  { id: "low", name: "Low", desc: "Fastest answers, barely any thinking." },
  { id: "medium", name: "Medium", desc: "Gemini decides how much to think. Best for most things." },
  { id: "high", name: "High", desc: "Thinks longer and checks its work." },
  { id: "max", name: "Max", desc: "Thinks as much as it can and writes the fullest answers." },
  { id: "ultra", name: "Ultra", desc: "Everything maxed. Plans first and double-checks before it answers." },
] as const;
const TINTS = ["#ffb547", "#c4ff2e", "#38bdf8", "#fde047", "#c084fc"];
const EFFORT_KEY = "mb-effort";
const ULTRA_KEY = "mb-ultra-code";
const readEffort = () => { try { const v = localStorage.getItem(EFFORT_KEY); const n = v === null ? 1 : Number(v); return Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 1; } catch { return 1; } };
const readUltra = () => { try { return localStorage.getItem(ULTRA_KEY) === "1"; } catch { return false; } };
const paint = (on: boolean) => { if (on) document.documentElement.dataset.ultra = "on"; else delete document.documentElement.dataset.ultra; };

/* Tells the server the effort with each chat message, and Ultra code only for Kodra messages */
function installEffortFetch() {
  const w = window as Window & { __mbEffortFetch?: boolean };
  if (w.__mbEffortFetch) return;
  w.__mbEffortFetch = true;
  const base = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(raw, location.href);
      if (u.origin === location.origin && u.pathname === "/api/chat") {
        const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        h.set("x-mb-effort", LEVELS[readEffort()].id);
        if (readUltra() && typeof init?.body === "string" && /"modeId"\s*:\s*"code"/.test(init.body)) h.set("x-mb-ultra-code", "1");
        init = { ...init, headers: h };
      }
    } catch { /* leave the request as it is */ }
    return base(input, init);
  }) as typeof window.fetch;
}
if (typeof window !== "undefined") installEffortFetch();

/* One animation per level: ember, flame, orbit, electric arcs, galaxy */
function EffortArt({ level, size = 64, mini = false }: { level: number; size?: number; mini?: boolean }) {
  const id = LEVELS[level].id;
  return (
    <svg className={"ea ea-" + id + (mini ? " ea-mini" : "")} width={size} height={size} viewBox={mini ? "-8 -8 80 80" : "-4 -4 72 72"} aria-hidden="true">
      {id === "low" && (<><circle className="ea-halo" cx="32" cy="34" r="17" /><circle className="ea-core" cx="32" cy="34" r="7" /></>)}
      {id === "medium" && (<><path className="ea-flame" d="M32 8c7 10 14 17 14 28a14 14 0 0 1-28 0c0-7 4-12 8-16 1 5 3 7 5 8-1-8 0-14 1-20z" /><path className="ea-inner" d="M32 30c4 5 7 8 7 13a7 7 0 0 1-14 0c0-4 3-8 7-13z" /></>)}
      {id === "high" && (<><circle className="ea-ring" cx="32" cy="32" r="20" /><g className="ea-orbit"><circle cx="32" cy="12" r="3" /><circle cx="32" cy="52" r="2.2" /></g><circle className="ea-core" cx="32" cy="32" r="7" /></>)}
      {id === "max" && (<><circle className="ea-ring" cx="32" cy="32" r="22" /><g className="ea-bolts"><polyline points="32,4 27,14 34,16 29,26" /><polyline points="58,30 48,27 47,34 38,31" /><polyline points="14,52 21,44 15,40 25,36" /></g><circle className="ea-core" cx="32" cy="32" r="8" /></>)}
      {id === "ultra" && (<><g className="ea-galaxy"><ellipse cx="32" cy="32" rx="24" ry="9" /><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(60 32 32)" /><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(120 32 32)" /></g><circle className="ea-core" cx="32" cy="32" r="6" /><g className="ea-stars"><circle cx="9" cy="12" r="1.4" /><circle cx="55" cy="10" r="1.2" /><circle cx="54" cy="54" r="1.5" /><circle cx="10" cy="52" r="1.1" /></g></>)}
    </svg>
  );
}

/* A smooth slider: the handle follows your mouse, then glides to the nearest level */
function EffortSlider({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (n: number) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pos = drag ?? value;
  const at = (x: number) => { const r = rail.current?.getBoundingClientRect(); return r && r.width ? Math.min(4, Math.max(0, ((x - r.left) / r.width) * 4)) : value; };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = at(e.clientX);
    setDrag(v);
    if (Math.round(v) !== value) onChange(Math.round(v));
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const v = at(e.clientX);
    setDrag(v);
    if (Math.round(v) !== value) onChange(Math.round(v));
  };
  const up = () => { if (drag === null) return; onChange(Math.round(drag)); setDrag(null); };
  const key = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const n = e.key === "ArrowRight" || e.key === "ArrowUp" ? value + 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? value - 1 : e.key === "Home" ? 0 : e.key === "End" ? 4 : null;
    if (n === null) return;
    e.preventDefault();
    onChange(Math.min(4, Math.max(0, n)));
  };
  return (
    <div className={"mbe-slider" + (drag !== null ? " dragging" : "") + (disabled ? " off" : "")} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label="Effort" aria-valuemin={0} aria-valuemax={4} aria-valuenow={value} aria-valuetext={LEVELS[value].name} aria-disabled={disabled}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
      style={{ "--p": String(pos / 4), "--tint": TINTS[Math.round(pos)] } as CSSProperties}>
      <div className="mbe-rail" ref={rail}>
        <div className="mbe-track" />
        <div className="mbe-fill" />
        {LEVELS.map((l, i) => <span key={l.id} className={"mbe-stop" + (i <= pos + 0.001 ? " lit" : "")} style={{ left: i * 25 + "%" }} />)}
        <div className="mbe-thumb" />
      </div>
      <div className="mbe-labels">
        {LEVELS.map((l, i) => (
          <button key={l.id} type="button" tabIndex={-1} disabled={disabled} style={{ left: i * 25 + "%" }}
            className={(i === value ? "on " : "") + (i === 0 ? "first" : i === 4 ? "last" : "")}
            onPointerDown={(e) => e.stopPropagation()} onClick={() => onChange(i)}>{l.name}</button>
        ))}
      </div>
    </div>
  );
}

/* Ultra code switch: a living symbiote blob that oozes across and opens its eyes */
function SymbioteSwitch({ on, onToggle }: { on: boolean; onToggle: (e: RMouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Ultra code" className={"sym" + (on ? " on" : "")} onClick={onToggle}>
      <svg viewBox="0 0 64 34" width="58" height="31" aria-hidden="true">
        <defs>
          <filter id="mbe-goo" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b" />
            <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
          </filter>
          <linearGradient id="mbe-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d8b4fe" /><stop offset="1" stopColor="#6d28d9" /></linearGradient>
        </defs>
        <rect className="sym-track" x="1" y="1" width="62" height="32" rx="16" />
        <g filter="url(#mbe-goo)">
          <g className="sym-m sym-m3"><circle className="sym-goo" cx="17" cy="17" r="6" /></g>
          <g className="sym-m sym-m2"><circle className="sym-goo" cx="17" cy="17" r="8" /></g>
          <g className="sym-m">
            <circle className="sym-goo sym-blob" cx="17" cy="17" r="11" />
            <circle className="sym-goo sym-t1" cx="17" cy="17" r="3.2" />
            <circle className="sym-goo sym-t2" cx="17" cy="17" r="2.6" />
          </g>
        </g>
        <g className="sym-m">
          <ellipse className="sym-shine" cx="13" cy="11.5" rx="3.2" ry="1.8" />
          <path className="sym-eye" d="M8.5 15.5c2.2-2.6 5.2-3 7.2-1.2-1 2.6-3.6 4-6.4 3.4z" />
          <path className="sym-eye" d="M25.5 15.5c-2.2-2.6-5.2-3-7.2-1.2 1 2.6 3.6 4 6.4 3.4z" />
        </g>
      </svg>
    </button>
  );
}

export default function EffortControl({ modeId }: { modeId: string }) {
  const [level, setLevel] = useState(1);
  const [ultra, setUltra] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [spell, setSpell] = useState<{ x: number; y: number; on: boolean; key: number } | null>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const kodra = modeId === "code";
  const ultraOn = kodra && ultra;
  const shown = ultraOn ? 4 : level;

  useEffect(() => { setLevel(readEffort()); setUltra(readUltra()); }, []);
  // Purple only while Ultra code is on in Kodra. When you switch it on, the spell paints it at the right moment.
  useEffect(() => { if (!spell?.on) paint(ultraOn); }, [ultraOn, spell]);
  useEffect(() => () => paint(false), []);

  const place = () => {
    const r = pill.current?.getBoundingClientRect();
    if (!r) return;
    const width = 312;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(r.top > 420 ? { left, width, bottom: window.innerHeight - r.top + 8 } : { left, width, top: r.bottom + 8 });
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !pill.current?.contains(t)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const re = () => place();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", re);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("resize", re); };
  }, [open]);

  const pick = (n: number) => { setLevel(n); try { localStorage.setItem(EFFORT_KEY, String(n)); } catch { /* private mode */ } };
  const toggleUltra = (e: RMouseEvent<HTMLButtonElement>) => {
    const next = !ultra;
    setUltra(next);
    try { localStorage.setItem(ULTRA_KEY, next ? "1" : ""); } catch { /* private mode */ }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    setSpell({ x: r.left + r.width / 2, y: r.top, on: next, key: Date.now() });
  };

  return (
    <>
      <style>{EFFORT_CSS}</style>
      <button ref={pill} type="button" className={"pill ghost-pill mbe-pill" + (ultraOn ? " mbe-ultra" : "")} title="Effort"
        onClick={() => { if (!open) place(); setOpen((o) => !o); }} aria-haspopup="dialog" aria-expanded={open}>
        <EffortArt level={shown} size={16} mini />{ultraOn ? "Ultra code" : LEVELS[shown].name}
      </button>
      {open && createPortal(
        <div ref={pop} className={"mbe-pop" + (ultraOn ? " mbe-ultra" : "")} style={pos} role="dialog" aria-label="Effort">
          <div className="mbe-hero">
            <div key={shown} className="mbe-art"><EffortArt level={shown} size={60} /></div>
            <div>
              <b>{LEVELS[shown].name}{shown === 1 && <em>Recommended</em>}</b>
              <p>{ultraOn ? "Ultra code always runs at Ultra effort." : LEVELS[shown].desc}</p>
            </div>
          </div>
          <EffortSlider value={shown} disabled={ultraOn} onChange={pick} />
          {kodra && (
            <div className={"mbe-uc" + (ultra ? " on" : "")}>
              <div className="mbe-uc-text">
                <div className="mbe-uc-title">Ultra code<span>Kodra</span></div>
                <p>{ultra ? "On. Every build is planned, written and reviewed like production code." : "Production-grade builds. Plans the structure, writes every file, then reviews it."}</p>
              </div>
              <SymbioteSwitch on={ultra} onToggle={toggleUltra} />
            </div>
          )}
          <p className="mbe-note">Higher effort is slower and uses more of your free Gemini quota.</p>
        </div>,
        document.body,
      )}
      {spell && createPortal(
        <UltraSpell key={spell.key} x={spell.x} y={spell.y} on={spell.on} onPeak={() => paint(spell.on)} onDone={() => setSpell(null)} />,
        document.body,
      )}
    </>
  );
}

/* The ModeBuddy ghost pops up, waves its wand and winks; sparkles fly to the logo and a purple wave paints everything */
function UltraSpell({ x, y, on, onPeak, onDone }: { x: number; y: number; on: boolean; onPeak: () => void; onDone: () => void }) {
  const [peak, setPeak] = useState(false);
  const [to, setTo] = useState<{ dx: number; dy: number } | null>(null);
  const cbs = useRef({ onPeak, onDone });
  useEffect(() => { cbs.current = { onPeak, onDone }; });
  useLayoutEffect(() => {
    const r = document.querySelector(".brand-logo")?.getBoundingClientRect();
    const tx = r ? r.left + r.width / 2 : 40, ty = r ? r.top + r.height / 2 : 40;
    setTo({ dx: tx - (x + 54), dy: ty - (y - 74) });
  }, [x, y]);
  useEffect(() => {
    const t1 = setTimeout(() => { setPeak(true); cbs.current.onPeak(); }, on ? 850 : 120);
    const t2 = setTimeout(() => cbs.current.onDone(), on ? 1800 : 650);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [on]);
  const n = on ? 10 : 8;
  return (
    <div className={"mbs " + (on ? "mbs-on" : "mbs-off") + (peak ? " peak" : "")} style={{ left: x, top: y }} aria-hidden="true">
      {on && (
        <div className="mbs-ghost">
          <svg className="mbs-body" viewBox="0 0 64 72">
            <ellipse className="mbs-sheet" cx="57" cy="44" rx="5" ry="4" />
            <path className="mbs-sheet" d="M32 4C17 4 8 15 8 30v30q4 8 8 2t8 0q4 6 8 0t8 0q4 6 8 0t8-2V30C56 15 47 4 32 4z" />
            <ellipse className="mbs-eye" cx="24" cy="30" rx="4" ry="5.5" />
            <circle className="mbs-shine" cx="25.6" cy="28" r="1.4" />
            <g className="mbs-eye-r"><ellipse className="mbs-eye" cx="40" cy="30" rx="4" ry="5.5" /><circle className="mbs-shine" cx="41.6" cy="28" r="1.4" /></g>
            <ellipse className="mbs-blush" cx="18" cy="39" rx="3.4" ry="2" />
            <ellipse className="mbs-blush" cx="46" cy="39" rx="3.4" ry="2" />
            <path className="mbs-mouth" d="M29 38q3 3 6 0" />
          </svg>
          <svg className="mbs-wand" viewBox="0 0 40 40"><line x1="6" y1="34" x2="27" y2="13" /><path d="M31 3l2.2 4.8 5.2.6-3.9 3.5 1.1 5.1L31 14.4l-4.6 2.6 1.1-5.1-3.9-3.5 5.2-.6z" /></svg>
        </div>
      )}
      {on && <span className="mbs-wink">✦</span>}
      {on && <span className="mbs-wave" />}
      {to && Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const dx = on ? to.dx + ((i % 3) - 1) * 18 : Math.cos(a) * 48;
        const dy = on ? to.dy + ((i % 4) - 1.5) * 12 : Math.sin(a) * 48;
        return <span key={i} className="mbs-spark" style={{ "--dx": dx + "px", "--dy": dy + "px", animationDelay: on ? 0.55 + i * 0.045 + "s" : "0s" } as CSSProperties}>✦</span>;
      })}
    </div>
  );
}

const EFFORT_CSS = [
  /* Ultra code theme: purple sidebar, accent, ModeBuddy logo and Kodra's logo */
  "html[data-ultra=on],html[data-ultra=on] *{--side:#170a2b !important;--side-2:#24113f !important;--side-3:#341a57 !important;--side-ink:#f3ecff !important;--side-ink-2:#a993cc !important;--accent:#a855f7 !important;--on-accent:#fff !important}",
  "html[data-ultra=on] .brand-key{background:linear-gradient(135deg,#c084fc,#7c3aed) !important;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 0 22px rgba(168,85,247,.6) !important}",
  "html[data-ultra=on] .brand-logo,html[data-ultra=on] .picker>.pill .mode-logo,html[data-ultra=on] .menu-pop button.on .mode-logo,html[data-ultra=on] img.mode-logo[src*=kodra i]{filter:grayscale(1) sepia(1) hue-rotate(222deg) saturate(3.2) brightness(.95) drop-shadow(0 0 6px rgba(192,132,252,.6)) !important}",
  "html[data-ultra=on] .picker>.pill>span:first-child,html[data-ultra=on] .menu-pop button.on .mi,html[data-ultra=on] :is(span,div):has(>img.mode-logo[src*=kodra i]){background:linear-gradient(135deg,#c084fc,#7c3aed) !important;color:#fff !important;border-radius:7px !important;box-shadow:0 0 14px rgba(168,85,247,.5) !important}",
  ".brand-key,.brand-logo,.mode-logo,.picker>.pill>span:first-child{transition:background .5s,box-shadow .5s,filter .5s}",
  /* the pill */
  ".mbe-pill{display:inline-flex;align-items:center;gap:6px}",
  ".mbe-pill .ea{flex:none}",
  ".mbe-pill.mbe-ultra{background:linear-gradient(135deg,#a855f7,#6d28d9) !important;color:#fff !important;border-color:transparent !important;box-shadow:0 0 16px rgba(168,85,247,.45)}",
  /* the panel */
  ".mbe-pop{position:fixed;z-index:9990;padding:16px;border-radius:18px;background:var(--side);color:var(--side-ink);box-shadow:0 24px 60px -12px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);font-size:13px;animation:mbeIn .16s ease-out}",
  ".mbe-hero{display:flex;gap:12px;align-items:center;margin-bottom:10px;min-height:60px}",
  ".mbe-art{flex:none;animation:mbeArt .3s ease-out}",
  ".mbe-hero b{display:flex;align-items:center;gap:8px;font-size:15px;font-family:var(--display)}",
  ".mbe-hero em{font-style:normal;font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(196,255,46,.18);color:#c4ff2e;font-family:var(--mono)}",
  ".mbe-hero p{margin:3px 0 0;color:var(--side-ink-2);line-height:1.4}",
  "@keyframes mbeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
  "@keyframes mbeArt{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}",
  /* the smooth slider */
  ".mbe-slider{padding:6px 10px 0;touch-action:none;outline:none;cursor:pointer;user-select:none;-webkit-user-select:none}",
  ".mbe-slider.off{opacity:.5;cursor:default}",
  ".mbe-rail{position:relative;height:22px}",
  ".mbe-track,.mbe-fill{position:absolute;left:0;top:50%;height:6px;margin-top:-3px;border-radius:999px}",
  ".mbe-track{right:0;background:rgba(255,255,255,.12)}",
  ".mbe-fill{width:calc(var(--p) * 100%);background:linear-gradient(90deg,#ffb547,var(--tint));transition:width .45s cubic-bezier(.22,1,.36,1)}",
  ".mbe-stop{position:absolute;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:rgba(255,255,255,.3);transition:background .3s}",
  ".mbe-stop.lit{background:rgba(0,0,0,.35)}",
  ".mbe-thumb{position:absolute;top:50%;left:calc(var(--p) * 100%);width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--tint) 35%,transparent),0 2px 8px rgba(0,0,0,.4);transition:left .45s cubic-bezier(.22,1,.36,1),transform .2s,box-shadow .3s}",
  ".mbe-slider.dragging .mbe-thumb,.mbe-slider.dragging .mbe-fill{transition:none}",
  ".mbe-slider.dragging .mbe-thumb{transform:scale(1.18)}",
  ".mbe-slider:focus-visible .mbe-thumb{outline:2px solid var(--tint);outline-offset:2px}",
  ".mbe-labels{position:relative;height:18px;margin-top:6px}",
  ".mbe-labels button{position:absolute;top:0;transform:translateX(-50%);border:0;background:none;padding:0 2px;font:inherit;font-size:11.5px;color:var(--side-ink-2);cursor:pointer;white-space:nowrap;transition:color .2s}",
  ".mbe-labels button.first{transform:none}",
  ".mbe-labels button.last{transform:translateX(-100%)}",
  ".mbe-labels button.on{color:var(--side-ink);font-weight:600}",
  ".mbe-labels button:disabled{cursor:default}",
  /* the Ultra code card */
  "@property --mbe-a{syntax:'<angle>';inherits:false;initial-value:0deg}",
  ".mbe-uc{position:relative;display:flex;align-items:center;gap:14px;margin-top:16px;padding:12px 12px 12px 14px;border-radius:14px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);transition:background .4s,border-color .4s}",
  ".mbe-uc.on{background:rgba(8,6,12,.55);border-color:rgba(192,132,252,.22)}",
  ".mbe-uc.on::before{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:conic-gradient(from var(--mbe-a),transparent 0 65%,rgba(192,132,252,.9) 82%,transparent 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:mbeSheen 4s linear infinite;pointer-events:none}",
  "@keyframes mbeSheen{to{--mbe-a:360deg}}",
  ".mbe-uc-text{flex:1;min-width:0}",
  ".mbe-uc-title{display:flex;align-items:center;gap:8px;font-family:var(--display);font-weight:600;font-size:14px;letter-spacing:-.01em}",
  ".mbe-uc-title span{font-family:var(--mono);font-size:9.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:5px;background:rgba(255,255,255,.07);color:var(--side-ink-2)}",
  ".mbe-uc p{margin:4px 0 0;font-size:11.5px;line-height:1.45;color:var(--side-ink-2)}",
  ".mbe-note{margin:12px 0 0;font-size:11.5px;color:var(--side-ink-2)}",
  /* the symbiote switch */
  ".sym{flex:none;border:0;padding:0;background:none;cursor:pointer;border-radius:999px;line-height:0;transition:filter .4s}",
  ".sym.on{filter:drop-shadow(0 0 8px rgba(168,85,247,.55))}",
  ".sym:focus-visible{outline:2px solid #c084fc;outline-offset:3px}",
  ".sym svg{overflow:visible}",
  ".sym-track{fill:#1d1d21;stroke:rgba(255,255,255,.09);stroke-width:1;transition:fill .4s}",
  ".sym.on .sym-track{fill:#08070b;stroke:url(#mbe-rim);stroke-width:1.4}",
  ".sym-m{transition:transform .5s cubic-bezier(.65,0,.35,1)}",
  ".sym-m2{transition-delay:.06s}",
  ".sym-m3{transition-delay:.12s}",
  ".sym.on .sym-m{transform:translateX(30px)}",
  ".sym-goo{fill:#4a4a52;transition:fill .4s}",
  ".sym.on .sym-goo{fill:#050507}",
  ".sym-blob,.sym-t1,.sym-t2,.sym-eye{transform-box:fill-box;transform-origin:center}",
  ".sym.on .sym-blob{animation:symBreathe 2.8s ease-in-out .6s infinite}",
  ".sym.on .sym-t1{animation:symReach1 3.2s ease-in-out .6s infinite}",
  ".sym.on .sym-t2{animation:symReach2 2.6s ease-in-out 1.1s infinite}",
  ".sym-shine{fill:#fff;opacity:.18;transition:opacity .4s}",
  ".sym.on .sym-shine{opacity:.4}",
  ".sym-eye{fill:#f5f3ff;opacity:0;transition:opacity .25s}",
  ".sym.on .sym-eye{opacity:1;transition-delay:.35s;animation:symBlink 5s ease-in-out 1.4s infinite}",
  "@keyframes symBreathe{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}",
  "@keyframes symReach1{0%,100%{transform:translate(0,0)}45%,60%{transform:translate(-15px,-6px)}}",
  "@keyframes symReach2{0%,100%{transform:translate(0,0)}50%{transform:translate(-11px,7px)}}",
  "@keyframes symBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}",
  /* level animations */
  ".ea{display:block;overflow:visible}",
  ".ea-mini{overflow:hidden}",
  ".ea-mini *{filter:none !important}",
  ".ea *{transform-box:fill-box;transform-origin:center}",
  ".ea-low .ea-halo{fill:#ffb547;opacity:.25;animation:eaBreathe 3.2s ease-in-out infinite}",
  ".ea-low .ea-core{fill:#ffd27a;animation:eaCore 3.2s ease-in-out infinite}",
  ".ea-medium .ea-flame{fill:#c4ff2e;transform-origin:50% 100%;animation:eaFlicker .9s ease-in-out infinite alternate}",
  ".ea-medium .ea-inner{fill:#fbffd6;transform-origin:50% 100%;animation:eaFlicker .6s ease-in-out infinite alternate-reverse}",
  ".ea-high .ea-ring{fill:none;stroke:#7dd3fc;stroke-width:2;stroke-dasharray:6 6;opacity:.7;animation:eaSpin 5s linear infinite}",
  ".ea-high .ea-orbit{fill:#e0f7ff;transform-box:view-box;transform-origin:32px 32px;animation:eaSpin 1.6s linear infinite}",
  ".ea-high .ea-core{fill:#38bdf8;animation:eaCore 1.6s ease-in-out infinite}",
  ".ea-max .ea-ring{fill:none;stroke:#fde047;stroke-width:1.5;opacity:.35;animation:eaPulse 1.2s ease-out infinite}",
  ".ea-max .ea-bolts{fill:none;stroke:#fde047;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transform-box:view-box;transform-origin:32px 32px;animation:eaSpin 7s linear infinite}",
  ".ea-max .ea-bolts polyline{animation:eaZap .9s steps(2,end) infinite}",
  ".ea-max .ea-bolts polyline:nth-child(2){animation-delay:.3s}",
  ".ea-max .ea-bolts polyline:nth-child(3){animation-delay:.6s}",
  ".ea-max .ea-core{fill:#fff3a3;filter:drop-shadow(0 0 6px #fde047);animation:eaJitter .25s linear infinite}",
  ".ea-ultra .ea-galaxy{fill:none;stroke:#c084fc;stroke-width:2.2;transform-box:view-box;transform-origin:32px 32px;animation:eaSpin 5s linear infinite;filter:drop-shadow(0 0 4px #a855f7)}",
  ".ea-ultra .ea-core{fill:#fff;filter:drop-shadow(0 0 8px #e879f9);animation:eaCore 1.4s ease-in-out infinite}",
  ".ea-ultra .ea-stars{fill:#f5d0fe}",
  ".ea-ultra .ea-stars circle{animation:eaTwinkle 1.8s ease-in-out infinite}",
  ".ea-ultra .ea-stars circle:nth-child(2){animation-delay:.45s}",
  ".ea-ultra .ea-stars circle:nth-child(3){animation-delay:.9s}",
  ".ea-ultra .ea-stars circle:nth-child(4){animation-delay:1.35s}",
  "@keyframes eaBreathe{0%,100%{transform:scale(.8);opacity:.15}50%{transform:scale(1.12);opacity:.4}}",
  "@keyframes eaCore{0%,100%{transform:scale(.9)}50%{transform:scale(1.06)}}",
  "@keyframes eaFlicker{0%{transform:scale(1,1) skewX(0)}50%{transform:scale(.96,1.06) skewX(-3deg)}100%{transform:scale(1.03,.97) skewX(3deg)}}",
  "@keyframes eaSpin{to{transform:rotate(360deg)}}",
  "@keyframes eaPulse{0%{transform:scale(.7);opacity:.6}100%{transform:scale(1.15);opacity:0}}",
  "@keyframes eaZap{0%{opacity:1}100%{opacity:.1}}",
  "@keyframes eaJitter{0%,100%{transform:translate(0,0)}25%{transform:translate(.6px,-.4px)}50%{transform:translate(-.5px,.5px)}75%{transform:translate(.4px,.6px)}}",
  "@keyframes eaTwinkle{0%,100%{opacity:.2;transform:scale(.6)}50%{opacity:1;transform:scale(1.3)}}",
  /* the ghost's spell */
  ".mbs{position:fixed;z-index:10000;pointer-events:none;width:0;height:0}",
  ".mbs-ghost{position:absolute;left:-36px;top:-110px;width:72px;height:81px;animation:mbsGhost 1.8s ease both}",
  ".mbs-body{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 8px 14px rgba(0,0,0,.35));transition:filter .35s}",
  ".mbs-sheet{fill:#f8f8f4;transition:fill .35s}",
  ".mbs.peak .mbs-sheet{fill:#ecdcff}",
  ".mbs.peak .mbs-body{filter:drop-shadow(0 0 14px rgba(168,85,247,.9))}",
  ".mbs-eye{fill:#1d1d24}",
  ".mbs-shine{fill:#fff}",
  ".mbs-blush{fill:#ff9ecb;opacity:.55}",
  ".mbs-mouth{fill:none;stroke:#1d1d24;stroke-width:1.8;stroke-linecap:round}",
  ".mbs-eye-r{transform-box:fill-box;transform-origin:center;animation:mbsBlink .32s ease 1.12s both}",
  ".mbs-wand{position:absolute;right:-26px;top:26px;width:34px;height:34px;overflow:visible;transform-origin:15% 85%;animation:mbsWand .7s ease-in-out .3s both}",
  ".mbs-wand line{stroke:#2a1b3d;stroke-width:3.5;stroke-linecap:round}",
  ".mbs-wand path{fill:#fde68a;filter:drop-shadow(0 0 6px #f0abfc)}",
  ".mbs-wink{position:absolute;left:16px;top:-96px;font-size:14px;color:#f5d0fe;text-shadow:0 0 10px #c084fc;opacity:0;animation:mbsWink .5s ease 1.12s both}",
  ".mbs-spark{position:absolute;left:54px;top:-74px;font-size:14px;line-height:1;color:#e9d5ff;text-shadow:0 0 8px #c084fc;opacity:0;animation:mbsSpark .75s cubic-bezier(.3,.6,.3,1) both}",
  ".mbs-off .mbs-spark{left:-6px;top:-8px;color:#d8b4fe;animation-duration:.55s}",
  ".mbs-wave{position:absolute;left:54px;top:-74px;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:radial-gradient(circle,rgba(192,132,252,0) 52%,rgba(216,180,254,.6) 64%,rgba(168,85,247,.25) 70%,rgba(168,85,247,0) 74%);opacity:0;animation:mbsWave 1s cubic-bezier(.2,.7,.2,1) .78s both}",
  "@keyframes mbsGhost{0%{transform:translateY(26px) scale(0);opacity:0}18%{transform:translateY(-6px) scale(1.12);opacity:1}28%{transform:none}64%{transform:none}70%{transform:scale(1.04,.94)}77%{transform:none;opacity:1}100%{transform:translateY(-64px) scale(.9);opacity:0}}",
  "@keyframes mbsBlink{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.12)}}",
  "@keyframes mbsWand{0%{transform:rotate(-35deg)}40%{transform:rotate(30deg)}70%{transform:rotate(-10deg)}100%{transform:rotate(12deg)}}",
  "@keyframes mbsWink{0%{opacity:0;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1.2) rotate(90deg)}100%{opacity:0;transform:scale(.6) rotate(180deg)}}",
  "@keyframes mbsSpark{0%{transform:translate(0,0) scale(.4);opacity:0}15%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1) rotate(200deg);opacity:0}}",
  "@keyframes mbsWave{0%{transform:scale(0);opacity:.95}100%{transform:scale(140);opacity:0}}",
  "@media (prefers-reduced-motion:reduce){.ea *,.mbs *,.sym *{animation:none !important}}",
].join("");
