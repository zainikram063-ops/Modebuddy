"use client";

import { useEffect } from "react";

const DUR = 280;
const EASE = "cubic-bezier(.2, .8, .2, 1)";
const OPTS: MutationObserverInit = { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true };

// Finds the pieces of the chat area that move as one block (top bar items, messages, message box)
function movers(main: HTMLElement) {
  const W = main.getBoundingClientRect().width;
  const out: HTMLElement[] = [];
  const walk = (el: Element, depth: number) => {
    for (const c of Array.from(el.children)) {
      if (!(c instanceof HTMLElement)) continue;
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(c).position === "fixed") continue;
      if (r.width >= W - 2 && depth < 4 && !c.matches(".thread, .composer")) walk(c, depth + 1);
      else out.push(c);
    }
  };
  walk(main, 0);
  return out.length > 80 ? [] : out;
}

// Sidebar open/close: change the layout once, then glide everything into place on the graphics chip
export default function SideFlip() {
  useEffect(() => {
    let timer = 0;
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        const app = rec.target as HTMLElement;
        if (!app.classList || !app.classList.contains("app")) continue;
        const was = /(^|\s)side-closed(\s|$)/.test(rec.oldValue || "");
        const now = app.classList.contains("side-closed");
        if (was === now) continue;
        if (performance.now() < 1500 || window.innerWidth < 901 || matchMedia("(prefers-reduced-motion: reduce)").matches) continue;
        const main = app.querySelector<HTMLElement>(".main");
        if (!main) continue;
        const els = movers(main);
        els.forEach((e) => e.getAnimations().forEach((a) => { if (a.id === "side-flip") a.cancel(); }));
        const after = els.map((e) => e.getBoundingClientRect().left);
        mo.disconnect();
        app.classList.toggle("side-closed", !now);
        const before = els.map((e) => e.getBoundingClientRect().left);
        app.classList.toggle("side-closed", now);
        mo.observe(document.body, OPTS);
        const root = document.documentElement;
        root.classList.add("side-flipping");
        window.clearTimeout(timer);
        timer = window.setTimeout(() => root.classList.remove("side-flipping"), DUR + 40);
        els.forEach((e, i) => {
          const dx = before[i] - after[i];
          if (Math.abs(dx) < 1) return;
          const t = getComputedStyle(e).transform;
          const base = t && t !== "none" ? t : "";
          e.animate([{ transform: `translateX(${dx}px) ${base}`.trim() }, { transform: base || "none" }], { duration: DUR, easing: EASE, id: "side-flip" });
        });
        break;
      }
    });
    mo.observe(document.body, OPTS);
    return () => { mo.disconnect(); window.clearTimeout(timer); };
  }, []);
  return null;
}
