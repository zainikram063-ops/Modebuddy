"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, Feather, Gauge, Lightbulb, Sparkles, Type } from "lucide-react";
import { setSender } from "@/lib/chat-bus";
import ModeIcon from "@/components/ModeIcon";

type Sel = { text: string; lang: string; code: boolean; x: number; top: number; bottom: number };
type Action = { label: string; icon: JSX.Element; make: (s: Sel) => string; show?: (s: Sel) => boolean };

const FENCE = "```";
const fence = (text: string, lang: string) => `${FENCE}${lang}\n${text}\n${FENCE}`;
const quote = (t: string) => "> " + t.split("\n").join("\n> ");
const TO_TS: Record<string, string> = { js: "ts", javascript: "typescript", jsx: "tsx", mjs: "ts" };
const TYPEABLE = new Set(["ts", "typescript", "tsx", "js", "javascript", "jsx", "mjs"]);

const CODE: Action[] = [
  { label: "Explain", icon: <Lightbulb size={13} strokeWidth={2} />, make: (s) => `Explain this code step by step:\n\n${fence(s.text, s.lang)}` },
  { label: "Optimize", icon: <Gauge size={13} strokeWidth={2} />, make: (s) => `Make this faster or cleaner without changing what it does. Show the change as a diff and say what improved:\n\n${fence(s.text, s.lang)}` },
  {
    label: "Add types", icon: <Type size={13} strokeWidth={2} />, show: (s) => TYPEABLE.has(s.lang),
    make: (s) => `Add precise TypeScript types to this (no any) and show the typed version:\n\n${fence(s.text, TO_TS[s.lang] ?? s.lang)}`,
  },
  { label: "Find bugs", icon: <Bug size={13} strokeWidth={2} />, make: (s) => `Find bugs and unhandled edge cases in this. For each one: the line, what goes wrong, and the fix:\n\n${fence(s.text, s.lang)}` },
];
const TEXT: Action[] = [
  { label: "Explain", icon: <Lightbulb size={13} strokeWidth={2} />, make: (s) => `Explain this part in more detail:\n\n${quote(s.text)}` },
  { label: "Simplify", icon: <Feather size={13} strokeWidth={2} />, make: (s) => `Say this more simply:\n\n${quote(s.text)}` },
  { label: "Example", icon: <Sparkles size={13} strokeWidth={2} />, make: (s) => `Give me a concrete example of this:\n\n${quote(s.text)}` },
];

export default function SelectionMenu({ onSend }: { onSend: (text: string) => void }) {
  const [sel, setSel] = useState<Sel | null>(null);
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const pressing = useRef(false);

  // let code blocks ("Tests" button) send into this chat
  useEffect(() => {
    setSender((t) => sendRef.current(t));
    return () => setSender(null);
  }, []);

  useEffect(() => {
    let raf = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const coarse = matchMedia("(pointer: coarse)").matches;

    const read = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount) { if (!pressing.current) setSel(null); return; }
      const text = s.toString().trim();
      if (text.length < 2) return setSel(null);
      const range = s.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      if (!el?.closest(".msg.assistant .answer")) return setSel(null);
      const code = el.closest<HTMLElement>(".code");
      const r = range.getBoundingClientRect();
      if (!r.width && !r.height) return setSel(null);
      setSel({ text: text.slice(0, 4000), lang: code?.dataset.lang ?? "", code: !!code, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    };
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(read); };
    const onChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) { if (!pressing.current) setSel(null); return; }
      if (coarse) { clearTimeout(t); t = setTimeout(read, 350); }
    };
    const hide = () => { if (!pressing.current) setSel(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); else if (e.shiftKey) later(); };

    document.addEventListener("mouseup", later);
    document.addEventListener("touchend", later);
    document.addEventListener("keyup", onKey);
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      document.removeEventListener("mouseup", later);
      document.removeEventListener("touchend", later);
      document.removeEventListener("keyup", onKey);
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  if (!sel || typeof document === "undefined") return null;

  const actions = (sel.code ? CODE : TEXT).filter((a) => !a.show || a.show(sel));
  const below = matchMedia("(pointer: coarse)").matches || sel.top < 70;
  const half = actions.length * 46;
  const left = Math.min(Math.max(sel.x, half + 8), window.innerWidth - half - 8);
  const top = below ? sel.bottom + 10 : sel.top - 46;

  const pick = (a: Action) => {
    const text = a.make(sel);
    pressing.current = false;
    window.getSelection()?.removeAllRanges();
    setSel(null);
    sendRef.current(text);
  };

  return createPortal(
    <div
      className="sel-menu"
      style={{ left, top }}
      role="toolbar"
      aria-label="Ask about the selection"
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={() => { pressing.current = true; setTimeout(() => { pressing.current = false; }, 600); }}
    >
      {actions.map((a) => (
        <button key={a.label} type="button" onClick={() => pick(a)}>
          <ModeIcon icon={a.icon} />{a.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
