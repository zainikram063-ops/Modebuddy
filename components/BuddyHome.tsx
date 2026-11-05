"use client";

import { useEffect, useState } from "react";
import { CloudRain, Dices, Frown, Laugh, Meh, Smile } from "lucide-react";
import { sendToChat } from "@/lib/chat-bus";
import QuickReminder from "./QuickReminder";
import { formatWhen, useReminders, type Reminder } from "@/lib/reminders";


const MOODS = [
  { label: "Great", Icon: Laugh, say: "I'm feeling great today." },
  { label: "Good", Icon: Smile, say: "I'm feeling pretty good today." },
  { label: "Okay", Icon: Meh, say: "I'm feeling okay today, nothing special." },
  { label: "Low", Icon: Frown, say: "I'm feeling a bit low today." },
  { label: "Rough", Icon: CloudRain, say: "Today has been rough." },
];

const SURPRISES = [
  "Tell me a fun fact I probably don't know.",
  "Ask me a would-you-rather question.",
  "Give me a one-minute challenge I can do right now.",
  "Teach me one useful word in another language.",
  "Ask me a fun question to get to know me better.",
  "Give me a tiny riddle to solve.",
];

const MOOD_KEY = "mb-moods";
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const daysAgo = (now: Date, n: number) => { const d = new Date(now); d.setDate(now.getDate() - n); return d; };
const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function loadMoods(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(MOOD_KEY) ?? "{}"); return v && typeof v === "object" ? v : {}; }
  catch { return {}; }
}

function noteFor(now: Date, moods: Record<string, number>, rem: Reminder[]) {
  const t = now.getTime();
  const open = rem.filter((r) => !r.done);
  const missed = open.find((r) => r.at < t);
  if (missed) return `You have a reminder waiting: ${missed.text}.`;
  const next = open.find((r) => new Date(r.at).toDateString() === now.toDateString());
  if (next) return `Next up today: ${next.text}, ${formatWhen(next.at, now).replace("Today at ", "at ")}.`;
  const a = moods[dayKey(daysAgo(now, 1))] ?? -1;
  const b = moods[dayKey(daysAgo(now, 2))] ?? -1;
  if (a >= 3 && b >= 3) return "The last couple of days have been tough. I'm here if you want to talk.";
  if (a >= 3) return "Yesterday was a hard one. I hope today is kinder.";
  if (a >= 0 && a <= 1 && b >= 0 && b <= 1) return "You've been on a good streak lately. Let's keep it going.";
  const h = now.getHours(), d = now.getDay();
  if (h < 5) return "It's late. Want some help winding down?";
  if (d === 1 && h < 12) return "New week, fresh start. Want to plan it together?";
  if (d === 5) return "It's Friday. Got anything fun planned?";
  if (h < 12) return "What's one thing you want to get done today?";
  if (h < 17) return "How's your day going so far?";
  return "How did today go?";
}

function tilesFor(now: Date) {
  const h = now.getHours(), d = now.getDay();
  const t =
    h < 5 || h >= 22 ? [
      { title: "Wind down", sub: "Calm my thoughts before bed", say: "Help me wind down and calm my thoughts before bed." },
      { title: "Can't sleep", sub: "Tips that actually help", say: "I can't sleep. Give me a few tips that actually help." },
      { title: "Tomorrow's list", sub: "Get it out of my head", say: "Help me write a short to-do list for tomorrow." },
      { title: "Something interesting", sub: "A short story or fact", say: "Tell me something genuinely interesting. Keep it short." },
    ] : h < 12 ? [
      { title: "Plan my day", sub: "Top 3 things to focus on", say: "Help me plan my day. Ask me what's on my plate." },
      { title: "Morning boost", sub: "A quick dose of motivation", say: "Give me a short, genuine boost of motivation for today." },
      { title: "Quick breakfast", sub: "Healthy, under 10 minutes", say: "Suggest a healthy breakfast I can make in under 10 minutes." },
      { title: "New habit", sub: "One small habit to start", say: "Suggest one small habit I could start today, and how." },
    ] : h < 17 ? [
      { title: "Focus session", sub: "Get one thing done", say: "Help me focus for the next hour. Ask what I need to get done." },
      { title: "Take a break", sub: "A 5-minute reset", say: "Give me a quick 5-minute break idea to reset." },
      { title: "Lunch idea", sub: "Something easy", say: "Give me an easy lunch idea." },
      { title: "Untangle a problem", sub: "Talk it through", say: "I want to talk through a problem I'm stuck on." },
    ] : [
      { title: "Plan tomorrow", sub: "Start the day ahead", say: "Help me plan tomorrow so I can relax tonight." },
      { title: "Unwind", sub: "Ways to relax tonight", say: "Give me a few ways to unwind tonight." },
      { title: "What to watch", sub: "A pick for tonight", say: "Recommend something to watch tonight. Ask me what I'm in the mood for." },
      { title: "Reflect on today", sub: "What went well", say: "Help me reflect on my day: what went well and what I'd change." },
    ];
  if (d === 1 && h < 17) t[0] = { title: "Plan my week", sub: "Set up the week ahead", say: "Help me plan my week. Ask me what's coming up." };
  if (d === 5 && h >= 12) t[1] = { title: "Weekend ideas", sub: "Make the most of it", say: "Give me some ideas for this weekend. Ask what I like." };
  if (d === 0 && h >= 17) t[0] = { title: "Ready for the week", sub: "A calm Sunday reset", say: "Help me get ready for the week ahead with a calm Sunday reset." };
  return t;
}

export default function BuddyHome({ onSend }: { onSend?: (text: string) => void }) {
  const send = onSend ?? sendToChat;
  const reminders = useReminders();
  const [now, setNow] = useState<Date | null>(null);
  const [moods, setMoods] = useState<Record<string, number>>({});

  useEffect(() => {
    setNow(new Date());
    setMoods(loadMoods());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!now) return <div className="bh" style={{ minHeight: 420 }} />;

  const todayKey = dayKey(now);
  const t = now.getTime();
  const today = reminders.filter((r) => !r.done && (r.at < t || new Date(r.at).toDateString() === now.toDateString()));
  const later = reminders.filter((r) => !r.done && r.at > t && new Date(r.at).toDateString() !== now.toDateString()).length;

  const pickMood = (i: number) => {
    const next = { ...moods, [todayKey]: i };
    setMoods(next);
    localStorage.setItem(MOOD_KEY, JSON.stringify(next));
    send(MOODS[i].say);
  };

  return (
    <div className="bh">
      <p className="bh-note">{noteFor(now, moods, reminders)}</p>

      <div className="bh-grid">
        <section className="bh-card">
          <h3>How are you feeling?</h3>
          <div className="bh-moods">
            {MOODS.map((m, i) => (
              <button key={m.label} type="button" className={moods[todayKey] === i ? "on" : ""} onClick={() => pickMood(i)}>
                <m.Icon size={22} strokeWidth={1.7} />
                {m.label}
              </button>
            ))}
          </div>
          <div className="bh-week" aria-label="Your week">
            {[6, 5, 4, 3, 2, 1, 0].map((n) => {
              const d = daysAgo(now, n);
              const v = moods[dayKey(d)];
              return (
                <span key={n} title={v === undefined ? "No check-in" : MOODS[v]?.label}>
                  <i className={v === undefined ? "" : `m${v}`} />
                  {d.toLocaleDateString([], { weekday: "narrow" })}
                </span>
              );
            })}
          </div>
        </section>

        <section className="bh-card">
          <h3>Today</h3>
          {today.length ? (
            <div className="bh-today">
              {today.slice(0, 4).map((r) => (
                <div key={r.id} className={r.at < t ? "late" : ""}>
                  <time>{r.at < t ? "Missed" : timeOf(r.at)}</time>
                  <span>{r.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="bh-empty">Nothing planned yet.{later ? ` ${later} coming up later.` : ""}</p>
          )}
          <QuickReminder />
        </section>
      </div>

      <section className="bh-card">
        <div className="bh-head">
          <h3>Ideas for right now</h3>
          <button type="button" className="bh-link" onClick={() => send(SURPRISES[Math.floor(Math.random() * SURPRISES.length)])}>
            <Dices size={14} strokeWidth={2} /> Surprise me
          </button>
        </div>
        <div className="bh-tiles">
          {tilesFor(now).map((x) => (
            <button key={x.title} type="button" onClick={() => send(x.say)}>
              <b>{x.title}</b>
              <small>{x.sub}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
