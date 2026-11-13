"use client";

import { useEffect } from "react";

// Wakes ModeBuddy's server while you type, so it's ready the moment you press Enter
export default function Warmup() {
  useEffect(() => {
    let last = 0;
    const ping = () => {
      if (Date.now() - last < 45000) return;
      last = Date.now();
      fetch("/api/chat", { method: "GET", cache: "no-store" }).catch(() => {});
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) ping();
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("focus", ping);
    return () => { document.removeEventListener("keydown", onKey, true); window.removeEventListener("focus", ping); };
  }, []);
  return null;
}
