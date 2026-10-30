export type Attempt = { topic: string | null; correct: boolean; created_at: string };
export type WeakSpot = { topic: string; right: number; total: number; missed: number; pct: number };
export type CardState = { box: number; lapses: number; reps: number };

/* ---------- weak spots ---------- */
export function weakSpots(atts: Attempt[], { min = 3, max = 3, below = 0.75 } = {}): WeakSpot[] {
  const map = new Map<string, { name: string; right: number; total: number }>();
  for (const a of atts) {
    const name = (a.topic ?? "").trim();
    if (!name) continue;
    const k = name.toLowerCase();
    const e = map.get(k) ?? { name, right: 0, total: 0 };
    e.total++;
    if (a.correct) e.right++;
    map.set(k, e);
  }
  return [...map.values()]
    .filter((e) => e.total >= min && e.right / e.total < below)
    .map((e) => ({ topic: e.name, right: e.right, total: e.total, missed: e.total - e.right, pct: Math.round((e.right / e.total) * 100) }))
    .sort((a, b) => a.pct - b.pct || b.missed - a.missed)
    .slice(0, max);
}

export function weakNote(w: WeakSpot[]) {
  return `WEAK SPOTS (from their recent quizzes, flashcards and mock exams, last 30 days):
${w.map((x) => `- ${x.topic}: ${x.right}/${x.total} right (missed ${x.missed})`).join("\n")}
- When relevant (the same subject comes up, the start of a study session, or they ask what to study), offer ONCE to practise one, e.g. "Want to retry ${w[0].topic}? You missed ${w[0].missed} last time."
- Don't nag or repeat the offer in the same chat. When the conversation touches one of these topics, slow down and add one extra check question there.`;
}

/* ---------- spaced repetition (Leitner boxes) ---------- */
export const SRS_DAYS = [0, 1, 3, 7, 16, 35];

export function schedule(s: CardState, good: boolean) {
  const box = good ? Math.min(s.box + 1, SRS_DAYS.length - 1) : 0;
  const wait = good ? SRS_DAYS[box] * 86_400_000 : 10 * 60_000;
  return { box, lapses: s.lapses + (good ? 0 : 1), reps: s.reps + 1, due_at: new Date(Date.now() + wait).toISOString() };
}

export function relTime(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} hour${h > 1 ? "s" : ""}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d > 1 ? "s" : ""}`;
}

/* ---------- days, streaks, heatmap ---------- */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function countByDay(dates: string[]) {
  const m = new Map<string, number>();
  for (const s of dates) { const k = dayKey(new Date(s)); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/** Consecutive days with activity. Still alive if you studied yesterday but not yet today. */
export function streak(days: Map<string, number>) {
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let s = 0;
  while (days.has(dayKey(d))) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

export type HeatCell = { key: string; count: number; future: boolean; label: string };
export function heatmap(days: Map<string, number>, weeks = 12): HeatCell[][] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - today.getDay() - (weeks - 1) * 7);
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const x = new Date(start);
      x.setDate(start.getDate() + w * 7 + d);
      const k = dayKey(x);
      col.push({ key: k, count: days.get(k) ?? 0, future: x > today, label: x.toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
    }
    cols.push(col);
  }
  return cols;
}
export const heatLevel = (n: number) => (n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);
