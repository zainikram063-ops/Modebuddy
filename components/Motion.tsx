"use client";

import type { RefObject } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const SEL = ".msg, .tool-card, .mem-pill, .chips, .error, .file-chip, .menu-pop, .dropzone";
const clear = { clearProps: "transform,opacity,filter" };
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function animate(el: HTMLElement) {
  if (el.matches(".msg.user")) {
    gsap.from(el, { x: 40, opacity: 0, scale: 0.94, duration: 0.55, ease: "back.out(1.6)", ...clear });
  } else if (el.matches(".msg")) {
    gsap.from(el, { y: 24, opacity: 0, filter: "blur(6px)", duration: 0.6, ease: "power3.out", ...clear });
    const av = el.querySelector(".avatar");
    if (av) gsap.from(av, { scale: 0, rotate: -180, duration: 0.7, ease: "back.out(2)", ...clear });
  } else if (el.matches(".chips")) {
    gsap.from(el.children, { y: 14, opacity: 0, scale: 0.8, duration: 0.45, ease: "back.out(2.5)", stagger: 0.06, ...clear });
  } else if (el.matches(".error")) {
    gsap.fromTo(el, { x: -14 }, { x: 0, duration: 0.7, ease: "elastic.out(1, 0.25)", ...clear });
  } else if (el.matches(".menu-pop")) {
    gsap.from(el, { y: 10, opacity: 0, scale: 0.95, transformOrigin: "bottom left", duration: 0.3, ease: "power3.out", ...clear });
    gsap.from(el.children, { x: -10, opacity: 0, duration: 0.3, ease: "power2.out", stagger: 0.03, delay: 0.05, ...clear });
  } else if (el.matches(".dropzone")) {
    gsap.from(el, { opacity: 0, scale: 1.04, duration: 0.25, ease: "power2.out", ...clear });
  } else {
    gsap.from(el, { y: 10, opacity: 0, scale: 0.96, duration: 0.45, ease: "back.out(1.7)", ...clear });
  }
}

function intro(chat: HTMLElement) {
  const empty = chat.querySelector(".empty");
  if (!empty) return;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from(empty.querySelectorAll(".hello"), { y: 34, opacity: 0, filter: "blur(16px)", duration: 1, ...clear }, 0.3)
    .from(empty.querySelectorAll(".hello-line, .key-cta"), { y: 16, opacity: 0, filter: "blur(6px)", duration: 0.6, stagger: 0.1, ...clear }, 0.6)
    .from(empty.querySelectorAll(".sug"), {
      y: 50, opacity: 0, rotateX: -40, transformPerspective: 700, duration: 0.9, ease: "back.out(1.4)", stagger: 0.09, ...clear,
    }, 0.75);
}

function ripple(e: PointerEvent) {
  const btn = (e.target as HTMLElement).closest<HTMLElement>(".sug, .chip, .send, .pill, .key-cta, .tool-head, .btn-sm");
  if (!btn || (btn as HTMLButtonElement).disabled) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement("span");
  s.className = "mb-ripple";
  Object.assign(s.style, {
    width: `${size}px`, height: `${size}px`,
    left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px`,
  });
  btn.appendChild(s);
  gsap.fromTo(s, { scale: 0, opacity: 0.5 }, { scale: 1, opacity: 0, duration: 0.7, ease: "power2.out", onComplete: () => s.remove() });
}

export function useChatMotion(rootRef: RefObject<HTMLDivElement | null>, chatId: string) {
  useGSAP(() => {
    const scroller = rootRef.current;
    const chat = scroller?.closest<HTMLElement>(".chat");
    if (!scroller || !chat || reduce()) return;

    // Entrances
    intro(chat);
    const old = Array.from(scroller.querySelectorAll<HTMLElement>(".thread > .msg")).slice(-6);
    if (old.length) gsap.from(old, { y: 26, opacity: 0, duration: 0.6, ease: "power3.out", stagger: 0.07, ...clear });
    const box = chat.querySelector(".composer-box");
    if (box) gsap.from(box, { y: 40, opacity: 0, duration: 0.8, ease: "power3.out", delay: 0.15, ...clear });

    // Animate only NEW things that appear
    const seen = new WeakSet<Element>();
    chat.querySelectorAll(SEL).forEach((el) => seen.add(el));

    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        const host = m.target instanceof HTMLElement ? m.target : m.target.parentElement;
        const badge = host?.closest<HTMLElement>(".mode-badge, .status");
        if (badge) gsap.fromTo(badge, { scale: 0.7, rotate: -6 }, { scale: 1, rotate: 0, duration: 0.8, ease: "elastic.out(1, 0.4)", overwrite: true });

        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          const els = [...(n.matches(SEL) ? [n] : []), ...n.querySelectorAll<HTMLElement>(SEL)];
          for (const el of els) {
            if (seen.has(el)) continue;
            seen.add(el);
            if (el.matches(".msg")) el.querySelectorAll(SEL).forEach((d) => seen.add(d));
            animate(el);
          }
        });
      }
    });
    mo.observe(chat, { childList: true, subtree: true, characterData: true });

    // Cursor effects: spotlight, 3D tilt, magnetic send
    const onMove = (e: PointerEvent) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>(".sug, .tool-card");
      if (t) {
        const r = t.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        t.style.setProperty("--mx", `${x}px`);
        t.style.setProperty("--my", `${y}px`);
        if (t.matches(".sug"))
          gsap.to(t, {
            rotateY: (x / r.width - 0.5) * 14, rotateX: -(y / r.height - 0.5) * 14, y: -5,
            transformPerspective: 700, duration: 0.4, ease: "power2.out", overwrite: "auto",
          });
      }
      const send = chat.querySelector<HTMLElement>(".send");
      if (send && !(send as HTMLButtonElement).disabled) {
        const r = send.getBoundingClientRect();
        const cx = r.left + r.width / 2 - (gsap.getProperty(send, "x") as number);
        const cy = r.top + r.height / 2 - (gsap.getProperty(send, "y") as number);
        const dx = e.clientX - cx, dy = e.clientY - cy;
        const near = Math.hypot(dx, dy) < 90;
        gsap.to(send, { x: near ? dx * 0.35 : 0, y: near ? dy * 0.35 : 0, duration: 0.35, ease: "power3.out", overwrite: "auto" });
      }
    };
    const onOut = (e: PointerEvent) => {
      const sug = (e.target as HTMLElement).closest<HTMLElement>(".sug");
      if (sug && !sug.contains(e.relatedTarget as Node))
        gsap.to(sug, { rotateX: 0, rotateY: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
    };

    chat.addEventListener("pointermove", onMove);
    chat.addEventListener("pointerout", onOut);
    chat.addEventListener("pointerdown", ripple);
    return () => {
      mo.disconnect();
      chat.removeEventListener("pointermove", onMove);
      chat.removeEventListener("pointerout", onOut);
      chat.removeEventListener("pointerdown", ripple);
    };
  }, { dependencies: [chatId], revertOnUpdate: true });
}
/* ---------- Mode switch transition ---------- */
type SwitchMode = { name: string; icon?: unknown; accent: string; tagline?: string | null };

let switching = false;

function textOn(color: string) {
  const m = color.trim().replace("#", "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return "#fff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b0b0b" : "#ffffff";
}

export function playModeSwitch(mode: SwitchMode, apply: () => void, at?: { clientX: number; clientY: number }) {
  if (switching) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { apply(); return; }
  switching = true;

  const x = at?.clientX ?? innerWidth / 2;
  const y = at?.clientY ?? innerHeight / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

  const ov = document.createElement("div");
  ov.className = "mb-mode-ov";
  ov.style.setProperty("--c", mode.accent);
  ov.style.color = textOn(mode.accent);

  const ring = document.createElement("div"); ring.className = "mb-mode-ring";
  const icon = document.createElement("div"); icon.className = "mb-mode-icon"; icon.textContent = String(mode.icon ?? "");
  const name = document.createElement("div"); name.className = "mb-mode-name";
  const chars = [...mode.name].map((ch) => { const s = document.createElement("span"); s.textContent = ch; name.appendChild(s); return s; });
  const tag = document.createElement("div"); tag.className = "mb-mode-tag"; tag.textContent = mode.tagline ?? `${mode.name} mode`;
  ov.append(ring, icon, name, tag);
  document.body.appendChild(ov);

  let applied = false;
  const doApply = () => { if (!applied) { applied = true; apply(); } };

  gsap.timeline({ onComplete: () => { doApply(); ov.remove(); switching = false; } })
    .fromTo(ov, { clipPath: `circle(0px at ${x}px ${y}px)` },
      { clipPath: `circle(${r}px at ${x}px ${y}px)`, duration: 0.6, ease: "power3.inOut" })
    .from(icon, { scale: 0, rotate: -180, duration: 0.6, ease: "back.out(2)" }, 0.3)
    .fromTo(ring, { scale: 0.2, opacity: 0.9 }, { scale: 3.2, opacity: 0, duration: 0.9, ease: "power2.out" }, 0.35)
    .from(chars, { y: 50, opacity: 0, rotateX: -90, duration: 0.5, ease: "back.out(2)", stagger: 0.035 }, 0.4)
    .from(tag, { y: 12, opacity: 0, duration: 0.4, ease: "power2.out" }, 0.65)
    .add(doApply, 0.7)
    .to([icon, name, tag], { y: -30, opacity: 0, duration: 0.3, ease: "power2.in", stagger: 0.04 }, 1.25)
    .to(ov, { opacity: 0, scale: 1.08, filter: "blur(12px)", duration: 0.45, ease: "power2.in" }, 1.4);
}

