/* Reminders saved in this browser, plus time parsing and formatting */
import { useSyncExternalStore } from "react";

export type Reminder = { id: string; text: string; at: number; src?: string; done?: boolean; notified?: boolean; fired?: boolean };

const KEY = "mb-reminders";
const subs = new Set<() => void>();
const EMPTY: Reminder[] = [];
let cache: Reminder[] | null = null;

function read(): Reminder[] {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { cache = []; }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}
function write(list: Reminder[]) {
  cache = [...list].sort((a, b) => a.at - b.at);
  localStorage.setItem(KEY, JSON.stringify(cache));
  subs.forEach((f) => f());
}
if (typeof window !== "undefined")
  addEventListener("storage", (e) => { if (e.key === KEY) { cache = null; subs.forEach((f) => f()); } });

export const useReminders = () =>
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, read, () => EMPTY);
export const allReminders = () => read();
export function addReminder(text: string, at: number, src?: string) {
  write([...read(), { id: Math.random().toString(36).slice(2, 10), text, at, src }]);
}
export const updateReminder = (id: string, patch: Partial<Reminder>) =>
  write(read().map((r) => (r.id === id ? { ...r, ...patch } : r)));
export const removeReminder = (id: string) => write(read().filter((r) => r.id !== id));

/* "in 20m", "today 17:00", "tomorrow 9am", "friday 18:30", "2026-12-03 14:00" -> Date */
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function clock(s: string): [number, number] | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
  return h < 24 && min < 60 ? [h, min] : null;
}
export function parseWhen(spec: string, now = new Date()): Date | null {
  const s = spec.trim().toLowerCase();
  const rel = /^in\s+(\d+(?:\.\d+)?)\s*([a-z]+)/.exec(s);
  if (rel) {
    const ms = ({ m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as Record<string, number>)[rel[2][0]];
    return ms ? new Date(now.getTime() + Number(rel[1]) * ms) : null;
  }
  const d = new Date(now);
  let kind: "date" | "week" | "day" | "time" = "time";
  let rest = s;
  const date = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})/.exec(s);
  const wd = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*/.exec(s);
  if (date) {
    d.setFullYear(Number(date[1] ?? now.getFullYear()), Number(date[2]) - 1, Number(date[3]));
    kind = "date"; rest = s.slice(date[0].length);
  } else if (wd) {
    d.setDate(d.getDate() + ((DAYS.indexOf(wd[1]) - d.getDay() + 7) % 7));
    kind = "week"; rest = s.slice(wd[0].length);
  } else if (/^(today|tonight|tomorrow)/.test(s)) {
    if (s.startsWith("tomorrow")) d.setDate(d.getDate() + 1);
    kind = "day"; rest = s.replace(/^(today|tonight|tomorrow)/, "");
  }
  const t = clock(rest);
  if (t) d.setHours(t[0], t[1], 0, 0);
  else if (kind === "time") return null;
  else if (s.startsWith("tonight")) d.setHours(20, 0, 0, 0);
  else if (kind === "day" && d.toDateString() === now.toDateString()) return new Date(now.getTime() + 3_600_000);
  else d.setHours(9, 0, 0, 0);
  if (kind === "date") while (d.getTime() <= now.getTime()) d.setFullYear(d.getFullYear() + 1);
  else if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + (kind === "week" ? 7 : 1));
  return d;
}

export function formatWhen(at: number, now = new Date()) {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const tmr = new Date(now);
  tmr.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return `Today at ${time}`;
  if (d.toDateString() === tmr.toDateString()) return `Tomorrow at ${time}`;
  const year = d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const };
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", ...year })} at ${time}`;
}
export const toInput = (at: number) => {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* names used by the existing reminder components */
export const whenLabel = (x: number | { at: number }, now?: Date) => formatWhen(typeof x === "number" ? x : x.at, now);
export const toLocalInput = (x: number | Date) => toInput(typeof x === "number" ? x : x.getTime());
