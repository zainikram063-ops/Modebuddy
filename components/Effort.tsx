"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent } from "react";
import { createPortal } from "react-dom";

/* Effort slider (Low to Ultra), each with its own little animation, plus Ultra code in Kodra (purple theme and the ghost's spell) */
const LEVELS = [
  { id: "low", name: "Low", desc: "Fastest answers, barely any thinking." },
  { id: "medium", name: "Medium", desc: "Gemini decides how much to think. Best for most things." },
  { id: "high", name: "High", desc: "Thinks longer and checks its work." },
  { id: "max", name: "Max", desc: "Thinks as much as it can and writes the fullest answers." },
  { id: "ultra", name: "Ultra", desc: "Everything maxed. Plans first and double-checks before it answers." },
] as const;
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
function EffortArt({ level, size = 64 }: { level: number; size?: number }) {
  const id = LEVELS[level].id;
  return (
    <svg className={"ea ea-" + id} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {id === "low" && (<><circle className="ea-halo" cx="32" cy="34" r="17" /><circle className="ea-core" cx="32" cy="34" r="7" /></>)}
      {id === "medium" && (<><path className="ea-flame" d="M32 8c7 10 14 17 14 28a14 14 0 0 1-28 0c0-7 4-12 8-16 1 5 3 7 5 8-1-8 0-14 1-20z" /><path className="ea-inner" d="M32 30c4 5 7 8 7 13a7 7 0 0 1-14 0c0-4 3-8 7-13z" /></>)}
      {id === "high" && (<><circle className="ea-ring" cx="32" cy="32" r="20" /><g className="ea-orbit"><circle cx="32" cy="12" r="3" /><circle cx="32" cy="52" r="2.2" /></g><circle className="ea-core" cx="32" cy="32" r="7" /></>)}
      {id === "max" && (<><circle className="ea-ring" cx="32" cy="32" r="22" /><g className="ea-bolts"><polyline points="32,4 27,14 34,16 29,26" /><polyline points="58,30 48,27 47,34 38,31" /><polyline points="14,52 21,44 15,40 25,36" /></g><circle className="ea-core" cx="32" cy="32" r="8" /></>)}
      {id === "ultra" && (<><g className="ea-galaxy"><ellipse cx="32" cy="32" rx="24" ry="9" /><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(60 32 32)" /><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(120 32 32)" /></g><circle className="ea-core" cx="32" cy="32" r="6" /><g className="ea-stars"><circle cx="9" cy="12" r="1.4" /><circle cx="55" cy="10" r="1.2" /><circle cx="54" cy="54" r="1.5" /><circle cx="10" cy="52" r="1.1" /></g></>)}
    </svg>
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
    const width = 304;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos(r.top > 400 ? { left, width, bottom: window.innerHeight - r.top + 8 } : { left, width, top: r.bottom + 8 });
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
        <EffortArt level={shown} size={16} />{ultraOn ? "Ultra code" : LEVELS[shown].name}
      </button>
      {open && createPortal(
        <div ref={pop} className={"mbe-pop" + (ultraOn ? " mbe-ultra" : "")} style={pos} role="dialog" aria-label="Effort">
          <div className="mbe-hero">
            <EffortArt level={shown} size={60} />
            <div>
              <b>{LEVELS[shown].name}{shown === 1 && <em>Recommended</em>}</b>
              <p>{ultraOn ? "Ultra code always runs at Ultra effort." : LEVELS[shown].desc}</p>
            </div>
          </div>
          <input className="mbe-range" type="range" min={0} max={4} step={1} value={shown} disabled={ultraOn}
            onChange={(e) => pick(Number(e.target.value))} aria-label="Effort" aria-valuetext={LEVELS[shown].name}
            style={{ "--mbe-p": (shown / 4) * 100 + "%" } as CSSProperties} />
          <div className="mbe-ticks">
            {LEVELS.map((l, i) => <button key={l.id} type="button" className={i === shown ? "on" : ""} disabled={ultraOn} onClick={() => pick(i)}>{l.name}</button>)}
          </div>
          {kodra && (
            <div className="mbe-uc">
              <div><b>Ultra code</b><small>Production-grade builds. Kodra plans, writes and reviews every file.</small></div>
              <button type="button" role="switch" aria-checked={ultra} aria-label="Ultra code" className={"mbe-switch" + (ultra ? " on" : "")} onClick={toggleUltra}><span /></button>
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

/* The ModeBuddy ghost pops up, waves its wand, sparkles fly to the logo and a purple wave paints everything */
function UltraSpell({ x, y, on, onPeak, onDone }: { x: number; y: number; on: boolean; onPeak: () => void; onDone: () => void }) {
  const [peak, setPeak] = useState(false);
  const [to, setTo] = useState<{ dx: number; dy: number } | null>(null);
  const cbs = useRef({ onPeak, onDone });
  useEffect(() => { cbs.current = { onPeak, onDone }; });
  useLayoutEffect(() => {
    const r = document.querySelector(".brand-logo")?.getBoundingClientRect();
    const tx = r ? r.left + r.width / 2 : 40, ty = r ? r.top + r.height / 2 : 40;
    setTo({ dx: tx - (x + 44), dy: ty - (y - 96) });
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
          <img src="/logos/buddy.png" alt="" />
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
  /* Ultra code theme: purple sidebar, logo and accent */
  "html[data-ultra=on],html[data-ultra=on] *{--side:#170a2b !important;--side-2:#24113f !important;--side-3:#341a57 !important;--side-ink:#f3ecff !important;--side-ink-2:#a993cc !important;--accent:#a855f7 !important;--on-accent:#fff !important}",
  "html[data-ultra=on] .brand-key{background:linear-gradient(135deg,#c084fc,#7c3aed) !important;box-shadow:0 0 0 1px rgba(255,255,255,.12),0 0 22px rgba(168,85,247,.6) !important}",
  "html[data-ultra=on] .brand-logo{filter:hue-rotate(190deg) saturate(1.5) drop-shadow(0 0 6px rgba(192,132,252,.7))}",
  ".brand-key,.brand-logo{transition:background .5s,box-shadow .5s,filter .5s}",
  /* the pill */
  ".mbe-pill{display:inline-flex;align-items:center;gap:6px}",
  ".mbe-pill .ea{flex:none}",
  ".mbe-pill.mbe-ultra{background:linear-gradient(135deg,#a855f7,#6d28d9) !important;color:#fff !important;border-color:transparent !important;box-shadow:0 0 16px rgba(168,85,247,.45)}",
  /* the panel */
  ".mbe-pop{position:fixed;z-index:9990;padding:14px;border-radius:16px;background:var(--side);color:var(--side-ink);box-shadow:0 24px 60px -12px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08);font-size:13px;animation:mbeIn .16s ease-out}",
  ".mbe-hero{display:flex;gap:12px;align-items:center;margin-bottom:12px}",
  ".mbe-hero b{display:flex;align-items:center;gap:8px;font-size:15px}",
  ".mbe-hero em{font-style:normal;font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:999px;background:rgba(196,255,46,.18);color:#c4ff2e}",
  ".mbe-hero p{margin:3px 0 0;color:var(--side-ink-2);line-height:1.4}",
  ".mbe-range{width:100%;-webkit-appearance:none;appearance:none;height:6px;border-radius:999px;outline:none;margin:4px 0 2px;background:linear-gradient(90deg,#ffb547,#c4ff2e,#38bdf8,#fde047,#c084fc) 0 0/var(--mbe-p,25%) 100% no-repeat,rgba(255,255,255,.14)}",
  ".mbe-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid #1d2012;box-shadow:0 0 0 3px rgba(196,255,46,.35);cursor:pointer;transition:transform .15s}",
  ".mbe-range::-webkit-slider-thumb:hover{transform:scale(1.15)}",
  ".mbe-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #1d2012;cursor:pointer}",
  ".mbe-range:disabled{opacity:.55}",
  ".mbe-ticks{display:flex;justify-content:space-between;margin:6px -4px 0}",
  ".mbe-ticks button{border:0;background:transparent;color:var(--side-ink-2);font:inherit;font-size:11.5px;padding:2px 4px;cursor:pointer;border-radius:6px}",
  ".mbe-ticks button.on{color:var(--side-ink);font-weight:600}",
  ".mbe-ticks button:disabled{cursor:default}",
  ".mbe-uc{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding:10px 12px;border-radius:12px;background:linear-gradient(135deg,rgba(168,85,247,.16),rgba(109,40,217,.1));border:1px solid rgba(192,132,252,.25)}",
  ".mbe-uc b{display:block;font-size:13.5px}",
  ".mbe-uc small{display:block;color:var(--side-ink-2);font-size:11.5px;margin-top:2px;line-height:1.35}",
  ".mbe-switch{flex:none;position:relative;width:40px;height:22px;border-radius:999px;border:0;background:rgba(255,255,255,.18);cursor:pointer;transition:background .25s,box-shadow .25s}",
  ".mbe-switch span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .25s cubic-bezier(.34,1.56,.64,1)}",
  ".mbe-switch.on{background:linear-gradient(135deg,#c084fc,#7c3aed);box-shadow:0 0 12px rgba(168,85,247,.6)}",
  ".mbe-switch.on span{transform:translateX(18px)}",
  ".mbe-note{margin:12px 0 0;font-size:11.5px;color:var(--side-ink-2)}",
  "@keyframes mbeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
  /* level animations */
  ".ea{display:block;overflow:visible}",
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
  ".mbs-ghost{position:absolute;left:-36px;top:-100px;width:72px;height:72px;animation:mbsGhost 1.8s ease both}",
  ".mbs-ghost img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35));transition:filter .35s}",
  ".mbs.peak .mbs-ghost img{filter:hue-rotate(190deg) saturate(1.5) drop-shadow(0 0 12px rgba(168,85,247,.85))}",
  ".mbs-wand{position:absolute;right:-24px;top:4px;width:34px;height:34px;overflow:visible;transform-origin:15% 85%;animation:mbsWand .7s ease-in-out .3s both}",
  ".mbs-wand line{stroke:#2a1b3d;stroke-width:3.5;stroke-linecap:round}",
  ".mbs-wand path{fill:#fde68a;filter:drop-shadow(0 0 6px #f0abfc)}",
  ".mbs-wink{position:absolute;left:30px;top:-104px;font-size:16px;color:#f5d0fe;text-shadow:0 0 10px #c084fc;opacity:0;animation:mbsWink .5s ease 1.15s both}",
  ".mbs-spark{position:absolute;left:44px;top:-96px;font-size:14px;line-height:1;color:#e9d5ff;text-shadow:0 0 8px #c084fc;opacity:0;animation:mbsSpark .75s cubic-bezier(.3,.6,.3,1) both}",
  ".mbs-off .mbs-spark{left:-6px;top:-8px;color:#d8b4fe;animation-duration:.55s}",
  ".mbs-wave{position:absolute;left:44px;top:-96px;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:radial-gradient(circle,rgba(192,132,252,0) 52%,rgba(216,180,254,.6) 64%,rgba(168,85,247,.25) 70%,rgba(168,85,247,0) 74%);opacity:0;animation:mbsWave 1s cubic-bezier(.2,.7,.2,1) .78s both}",
  "@keyframes mbsGhost{0%{transform:translateY(26px) scale(0);opacity:0}18%{transform:translateY(-6px) scale(1.12);opacity:1}28%{transform:none}64%{transform:none}70%{transform:scale(1.06,.9)}77%{transform:none;opacity:1}100%{transform:translateY(-64px) scale(.9);opacity:0}}",
  "@keyframes mbsWand{0%{transform:rotate(-35deg)}40%{transform:rotate(30deg)}70%{transform:rotate(-10deg)}100%{transform:rotate(12deg)}}",
  "@keyframes mbsWink{0%{opacity:0;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1.2) rotate(90deg)}100%{opacity:0;transform:scale(.6) rotate(180deg)}}",
  "@keyframes mbsSpark{0%{transform:translate(0,0) scale(.4);opacity:0}15%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1) rotate(200deg);opacity:0}}",
  "@keyframes mbsWave{0%{transform:scale(0);opacity:.95}100%{transform:scale(140);opacity:0}}",
  "@media (prefers-reduced-motion:reduce){.ea *,.mbs *{animation:none !important}}",
].join("");
