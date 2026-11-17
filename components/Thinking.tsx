"use client";
import { useEffect, useState } from "react";

const LIME = "#c4ff2e", DEEP = "#8fc41a", GRAY = "#8b9099";
const WORDS = {
  buddy: ["Thinking", "Mulling it over", "Connecting the dots", "Putting it together"],
  code: ["Reading the code", "Working on it", "Tracing the logic", "Putting it together"],
};
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];
// Styled right here, so nothing around it can hide it
const CSS = [
  ".mbs{display:inline-flex;align-items:center;gap:8px;height:28px;font-size:13.5px;color:" + GRAY + ";-webkit-text-fill-color:" + GRAY + ";opacity:1;visibility:visible}",
  ".mbs svg{width:18px;height:18px;flex:none;animation:mbsSpin 6s linear infinite}",
  ".mbs-ray{transform-box:view-box;transform-origin:9px 9px;animation:mbsRay 1.2s ease-in-out infinite}",
  ".mbs-word{font-weight:500;background:linear-gradient(90deg," + GRAY + " 35%," + LIME + " 50%," + GRAY + " 65%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:mbsShine 2.4s linear infinite,mbsIn .35s ease}",
  ".mbs-time{opacity:.6;font-variant-numeric:tabular-nums}",
  "@keyframes mbsSpin{to{transform:rotate(360deg)}}",
  "@keyframes mbsRay{0%,100%{transform:scale(.45);opacity:.5}50%{transform:scale(1);opacity:1}}",
  "@keyframes mbsShine{from{background-position:150% 0}to{background-position:-50% 0}}",
  "@keyframes mbsIn{from{opacity:0;transform:translateY(3px)}}",
  "@media (prefers-reduced-motion:reduce){.mbs svg,.mbs-ray,.mbs-word{animation:none!important}.mbs-word{-webkit-text-fill-color:" + GRAY + "}}",
].join("");

/* Shown while ModeBuddy works on a reply: a breathing lime spark, a shining word, and the time if it's slow */
export default function Thinking({ code = false }: { code?: boolean }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const iv = setInterval(() => setT(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);
  const words = code ? WORDS.code : WORDS.buddy;
  const word = words[Math.floor(t / 3) % words.length];
  return (
    <div className="mbs" role="status" aria-label="Thinking">
      <style>{CSS}</style>
      <svg viewBox="0 0 18 18" aria-hidden>
        {RAYS.map((a, i) => {
          const r = (a * Math.PI) / 180;
          return (
            <line key={a} className="mbs-ray" x1={9 + Math.cos(r) * 2.6} y1={9 + Math.sin(r) * 2.6} x2={9 + Math.cos(r) * 7.6} y2={9 + Math.sin(r) * 7.6}
              stroke={i % 2 ? DEEP : LIME} strokeWidth={2} strokeLinecap="round" style={{ animationDelay: `${i * 0.15}s` }} />
          );
        })}
      </svg>
      <span key={word} className="mbs-word">{word}…</span>
      {t >= 4 && <span className="mbs-time">{t}s</span>}
    </div>
  );
}
