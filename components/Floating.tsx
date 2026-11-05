"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";

/* Draws a dropdown on top of the whole page, so nothing behind it can cover it */
export default function Floating({ style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const host = anchor.current?.parentElement;
      if (!host) return;
      const r = host.getBoundingClientRect();
      const up = r.top > window.innerHeight - r.bottom;
      let bg = "#fff";
      for (let n: Element | null = host; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const a = c === "transparent" ? 0 : /rgba|\//.test(c) ? Number((c.match(/[,/]\s*([\d.]+)\s*\)$/) || [])[1] ?? 1) : 1;
        if (a >= 0.95) { bg = c; break; }
      }
      setPos({
        position: "fixed", right: "auto", transform: "none", margin: 0, zIndex: 1000,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 320)),
        top: up ? "auto" : r.bottom + 6,
        bottom: up ? window.innerHeight - r.top + 6 : "auto",
        maxHeight: Math.max(180, (up ? r.top : window.innerHeight - r.bottom) - 16),
        overflowY: "auto", background: bg, color: getComputedStyle(host).color,
      });
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, []);

  return (
    <>
      <span ref={anchor} hidden />
      {pos && createPortal(<div {...rest} style={{ ...style, ...pos }} />, document.body)}
    </>
  );
}
