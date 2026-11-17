"use client";
import { useEffect, useState } from "react";

const GRAY = "#8b9099";
const CSS = "@keyframes mbDot{0%,80%,100%{opacity:.25}40%{opacity:1}}@media (prefers-reduced-motion:reduce){.mb-dot{animation:none!important;opacity:.6!important}}";

/* Shown while ModeBuddy works on a reply: three soft dots, plus a quiet label if it takes a while.
   Styled right here, so the styles around it can't hide it. */
export default function Thinking({ code = false }: { code?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div role="status" aria-label="Thinking" style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, color: GRAY, WebkitTextFillColor: GRAY, background: "none", opacity: 1, visibility: "visible" }}>
      <style>{CSS}</style>
      {[0, 1, 2].map((i) => (
        <span key={i} className="mb-dot" style={{ display: "block", width: 6, height: 6, borderRadius: "50%", background: GRAY, opacity: 0.25, animation: `mbDot 1.2s ease-in-out ${i * 0.15}s infinite` }} />
      ))}
      {slow && <span style={{ marginLeft: 8, fontSize: 13, opacity: 0.8 }}>{code ? "Working on it…" : "Thinking…"}</span>}
    </div>
  );
}
