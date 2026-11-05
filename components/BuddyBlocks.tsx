"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Wind } from "lucide-react";
import { sendToChat, useCanSend } from "@/lib/chat-bus";
import ReminderCard from "./ReminderCard";

/* Interactive blocks Buddy can add to replies: choices, switch, breathe */
export const BUDDY_BLOCKS = new Set(["choices", "switch", "breathe", "reminder"]);

const lines = (raw: string) =>
  raw.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);

export default function BuddyBlock({ lang, raw }: { lang: string; raw: string }) {
  if (lang === "choices") return <Choices items={lines(raw).slice(0, 6)} />;
  if (lang === "switch") return <Switch info={lines(raw)} />;
  if (lang === "reminder") return <ReminderCard info={lines(raw)} />;
  return <Breathe />;
}

function Choices({ items }: { items: string[] }) {
  const canSend = useCanSend();
  const [picked, setPicked] = useState("");
  if (!items.length) return null;
  return (
    <div className="bb-choices">
      {items.map((t) => (
        <button key={t} type="button" className={picked === t ? "on" : ""} disabled={!canSend || !!picked}
                onClick={() => { setPicked(t); sendToChat(t); }}>
          {t}
        </button>
      ))}
    </div>
  );
}

function Switch({ info }: { info: string[] }) {
  const [done, setDone] = useState(false);
  const id = (info[0] ?? "").split(/\s+/)[0];
  if (!id) return null;
  const name = id.charAt(0).toUpperCase() + id.slice(1);
  return (
    <div className="bb-card">
      <div className="bb-text">
        <b>{name} mode is a better fit</b>
        {info[1] && <small>{info[1]}</small>}
      </div>
      <button type="button" className="bb-primary" disabled={done}
              onClick={() => { setDone(true); window.dispatchEvent(new CustomEvent("mb-switch-mode", { detail: id })); }}>
        {done ? "Switched" : <>Switch to {name} <ArrowRight size={14} strokeWidth={2} /></>}
      </button>
    </div>
  );
}

const STEPS = [
  { label: "Breathe in", secs: 4, scale: 1 },
  { label: "Hold", secs: 4, scale: 1 },
  { label: "Breathe out", secs: 6, scale: 0.55 },
];
const ROUNDS = 4;
const END = ROUNDS * STEPS.length;

function Breathe() {
  const [step, setStep] = useState(-1);
  useEffect(() => {
    if (step < 0 || step >= END) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEPS[step % STEPS.length].secs * 1000);
    return () => clearTimeout(t);
  }, [step]);
  const cur = step >= 0 && step < END ? STEPS[step % STEPS.length] : null;
  const finished = step >= END;
  return (
    <div className="bb-card bb-breathe">
      <div className="bb-orb" style={{ transform: `scale(${cur ? cur.scale : 0.55})`, transitionDuration: `${cur ? cur.secs : 0.6}s` }} />
      <div className="bb-text">
        <b>{finished ? "Nice work" : cur ? cur.label : "One-minute breathing"}</b>
        <small>
          {finished ? "How do you feel now?" : cur ? `Round ${Math.floor(step / STEPS.length) + 1} of ${ROUNDS}` : "Follow the circle: in for 4, hold for 4, out for 6."}
        </small>
      </div>
      {step < 0 && <button type="button" className="bb-primary" onClick={() => setStep(0)}><Wind size={14} strokeWidth={2} /> Start</button>}
      {cur && <button type="button" onClick={() => setStep(END)}>Stop</button>}
      {finished && <Choices items={["A bit better", "About the same", "Still stressed"]} />}
    </div>
  );
}
