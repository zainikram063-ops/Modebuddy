"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Coffee, Hourglass, Pause, Play, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const FOCUS = 25 * 60;
const BREAK = 5 * 60;
const KEY = "mb-focus";
type Phase = "idle" | "focus" | "break";
type State = { phase: Phase; endAt: number | null; pausedLeft: number | null };
const IDLE: State = { phase: "idle", endAt: null, pausedLeft: null };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880, 990].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.18;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

export default function FocusTimer({ onComplete, toast }: { onComplete: () => void; toast: (t: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [s, setS] = useState<State>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const [burst, setBurst] = useState(0);
  const baseTitle = useRef("");

  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (v?.phase) setS(v); } catch {}
  }, []);
  const save = useCallback((v: State) => { setS(v); localStorage.setItem(KEY, JSON.stringify(v)); }, []);

  const paused = s.pausedLeft !== null;
  const running = s.phase !== "idle" && s.endAt !== null;
  const left = s.phase === "idle" ? FOCUS : paused ? s.pausedLeft! : Math.max(0, Math.round(((s.endAt ?? now) - now) / 1000));

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  /* phase finished */
  useEffect(() => {
    if (!running || left > 0) return;
    chime();
    if (s.phase === "focus") {
      setBurst((b) => b + 1);
      supabase.from("focus_sessions").insert({ minutes: FOCUS / 60 }).then(() => onComplete());
      toast("25 minutes of focus. Nice. Take a 5-minute break.");
      save({ phase: "break", endAt: Date.now() + BREAK * 1000, pausedLeft: null });
    } else {
      toast("Break's over. Ready for another round?");
      save(IDLE);
    }
  }, [running, left, s.phase, save, supabase, onComplete, toast]);

  /* countdown in the browser tab */
  useEffect(() => {
    if (s.phase === "idle") {
      if (baseTitle.current) { document.title = baseTitle.current; baseTitle.current = ""; }
      return;
    }
    if (!baseTitle.current) baseTitle.current = document.title;
    document.title = `${fmt(left)} · ${s.phase === "focus" ? "Focus" : "Break"}`;
  }, [s.phase, left]);

  const start = () => { setNow(Date.now()); save({ phase: "focus", endAt: Date.now() + FOCUS * 1000, pausedLeft: null }); };
  const pause = () => save({ ...s, endAt: null, pausedLeft: left });
  const resume = () => { setNow(Date.now()); save({ ...s, endAt: Date.now() + (s.pausedLeft ?? 0) * 1000, pausedLeft: null }); };
  const stop = () => save(IDLE);

  if (s.phase === "idle")
    return (
      <button type="button" className="focus-btn" onClick={start} title="Start a 25-minute focus session">
        <Hourglass size={14} strokeWidth={1.75} /><span>Focus</span>
      </button>
    );

  const total = s.phase === "focus" ? FOCUS : BREAK;
  return (
    <div className={`focus-pill ${s.phase} ${paused ? "paused" : ""}`} style={{ "--fp": `${(1 - left / total) * 100}%` } as CSSProperties}
         title={s.phase === "focus" ? "Focus session" : "Break"}>
      {s.phase === "focus" ? <Hourglass size={13} strokeWidth={2} /> : <Coffee size={13} strokeWidth={2} />}
      <span className="focus-time">{fmt(left)}</span>
      <button type="button" onClick={paused ? resume : pause} aria-label={paused ? "Resume" : "Pause"}>
        {paused ? <Play size={12} strokeWidth={2.5} /> : <Pause size={12} strokeWidth={2.5} />}
      </button>
      <button type="button" onClick={stop} aria-label="Stop"><Square size={10} strokeWidth={3} /></button>
      {burst > 0 && (
        <span key={burst} className="focus-burst" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--a": `${i * 30}deg` } as CSSProperties} />)}
        </span>
      )}
    </div>
  );
}
