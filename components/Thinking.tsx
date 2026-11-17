"use client";
import { useEffect, useState } from "react";

/* Shown while ModeBuddy works on a reply: three soft dots, plus a quiet label if it takes a while */
export default function Thinking({ code = false }: { code?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="mb-think" role="status" aria-label="Thinking">
      <span />
      <span />
      <span />
      {slow && <em>{code ? "Working on it…" : "Thinking…"}</em>}
    </div>
  );
}
