"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  ChefHat, CakeSlice, Coffee, ScrollText, Eye, Flower2, Orbit, Cloud, Soup, Leaf, Pencil,
  Headphones, Sparkles, Puzzle, Waves, Wand, Telescope, Palette, Feather, Moon, Flashlight,
  Dices, Wrench, Radio, Flower, MessageCircle, Popcorn, Compass, Music, Sprout,
  Cog, RefreshCw, Search, Scissors, Bird, CheckCheck, House, Infinity as InfinityIcon
, RotateCw,
  Recycle, GitBranch, Binary, Layers, Timer, ArrowLeftRight, Bug, Braces, Spline, Crosshair, Rocket,
} from "lucide-react";

type Word = [string, import("lucide-react").LucideIcon];

const GENERAL: Word[] = [
  ["Cooking", ChefHat], ["Baking", CakeSlice], ["Brewing", Coffee], ["Scrolling", ScrollText],
  ["Watching", Eye], ["Flowering", Flower2], ["Hallucinating", Orbit], ["Daydreaming", Cloud],
  ["Simmering", Soup], ["Marinating", Leaf], ["Doodling", Pencil], ["Vibing", Headphones],
  ["Manifesting", Sparkles], ["Untangling", Puzzle], ["Percolating", Waves], ["Conjuring", Wand],
  ["Stargazing", Telescope], ["Sketching", Palette], ["Daydrifting", Feather], ["Moonwalking", Moon],
  ["Spelunking", Flashlight], ["Juggling", Dices], ["Tinkering", Wrench], ["Channeling", Radio],
  ["Blooming", Flower], ["Gossiping", MessageCircle], ["Snacking", Popcorn], ["Wandering", Compass],
  ["Composing", Music], ["Sprouting", Sprout],
];

const CODE: Word[] = [
  ["Compiling", Cog], ["Refactoring", RefreshCw], ["Grepping", Search], ["Yak-shaving", Scissors],
  ["Rubber-ducking", Bird], ["Linting", CheckCheck], ["Bikeshedding", House], ["Recursing", InfinityIcon],
  ["Hot-reloading", RotateCw], ["Garbage-collecting", Recycle], ["Git-blaming", GitBranch],
  ["Bit-twiddling", Binary], ["Caching", Layers], ["Debouncing", Timer], ["Transpiling", ArrowLeftRight],
  ["Squashing bugs", Bug], ["Untangling spaghetti", Braces], ["Reticulating splines", Spline],
  ["Centering a div", Crosshair], ["Shipping", Rocket],
];

const GLYPHS = "!<>-_\\/[]{}=+*^?#01";
const pick = (n: number, not = -1) => { let j = not; while (j === not) j = Math.floor(Math.random() * n); return j; };

export default function Thinking({ code = false }: { code?: boolean }) {
  const words = code ? CODE : GENERAL;
  const [i, setI] = useState(() => pick(words.length));
  const [secs, setSecs] = useState(0);
  const textRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  const reduce = typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // timer
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // switch word every 2.2s
  useEffect(() => {
    const id = setInterval(() => setI((cur) => pick(words.length, cur)), 2200);
    return () => clearInterval(id);
  }, [words.length]);

  // gentle bob
  useEffect(() => {
    if (reduce || !iconRef.current) return;
    const bob = gsap.to(iconRef.current, { y: -2.5, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1 });
    return () => { bob.kill(); };
  }, [reduce]);

  // pop icon + scramble text on each change
  useEffect(() => {
    const el = textRef.current, icon = iconRef.current;
    if (!el || !icon) return;
    const target = words[i % words.length][0] + "…";
    if (reduce) { el.textContent = target; return; }

    gsap.fromTo(icon, { scale: 0, rotate: -120, opacity: 0 },
      { scale: 1, rotate: 0, opacity: 1, duration: 0.55, ease: "back.out(2.2)", overwrite: "auto" });

    if (first.current) { first.current = false; el.textContent = target; return; }
    const len = Math.max((el.textContent ?? "").length, target.length);
    const o = { p: 0 };
    const tw = gsap.to(o, {
      p: 1, duration: 0.6, ease: "power2.out",
      onUpdate: () => {
        let s = "";
        for (let k = 0; k < len; k++)
          s += k / len < o.p ? (target[k] ?? "") : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        el.textContent = s;
      },
      onComplete: () => { el.textContent = target; },
    });
    return () => { tw.kill(); };
  }, [i, words, reduce]);

  const Icon = words[i % words.length][1];

  return (
    <span className="mb-think" role="status" aria-live="polite">
      <span ref={iconRef} className="mb-think-icon" aria-hidden>
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <span ref={textRef} className="mb-think-word" />
      <span className="mb-think-time">{secs}s</span>
    </span>
  );
}
