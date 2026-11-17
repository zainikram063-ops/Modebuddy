"use client";
import { useEffect, useState } from "react";

const GRAY = "#8b9099";
// A small glass cube that rolls a quarter turn at a time. Styled right here, so nothing around it can hide it.
const FACES = ["translateZ(7px)", "rotateY(180deg) translateZ(7px)", "rotateY(90deg) translateZ(7px)", "rotateY(-90deg) translateZ(7px)", "rotateX(90deg) translateZ(7px)", "rotateX(-90deg) translateZ(7px)"];
const CSS = [
  ".mb3{display:inline-flex;align-items:center;gap:10px;height:28px;color:" + GRAY + ";-webkit-text-fill-color:" + GRAY + ";opacity:1;visibility:visible}",
  ".mb3-stage{width:22px;height:22px;display:flex;align-items:center;justify-content:center;perspective:110px}",
  ".mb3-cube{position:relative;width:14px;height:14px;transform-style:preserve-3d;transform:rotateX(-24deg);animation:mb3Roll 3.2s cubic-bezier(.65,0,.35,1) infinite}",
  ".mb3-f{position:absolute;inset:0;box-sizing:border-box;border:1.5px solid " + GRAY + ";border-radius:3px;background:rgba(139,144,153,.16)}",
  "@keyframes mb3Roll{0%{transform:rotateX(-24deg) rotateY(0deg)}22%,25%{transform:rotateX(-24deg) rotateY(90deg)}47%,50%{transform:rotateX(-24deg) rotateY(180deg)}72%,75%{transform:rotateX(-24deg) rotateY(270deg)}97%,100%{transform:rotateX(-24deg) rotateY(360deg)}}",
  "@media (prefers-reduced-motion:reduce){.mb3-cube{animation:none;transform:rotateX(-24deg) rotateY(35deg)}}",
].join("");

/* Shown while ModeBuddy works on a reply: a small rolling 3D cube, plus a quiet label if it takes a while */
export default function Thinking({ code = false }: { code?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="mb3" role="status" aria-label="Thinking">
      <style>{CSS}</style>
      <div className="mb3-stage">
        <div className="mb3-cube">
          {FACES.map((t) => <span key={t} className="mb3-f" style={{ transform: t }} />)}
        </div>
      </div>
      {slow && <span style={{ fontSize: 13 }}>{code ? "Working on it…" : "Thinking…"}</span>}
    </div>
  );
}
