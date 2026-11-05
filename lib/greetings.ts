/* A fresh greeting for every new chat. {name} = the user's first name */
const ANY = [
  "Hey {name}", "What's on your mind, {name}?", "Good to see you, {name}", "Ready when you are, {name}",
  "What are we figuring out today, {name}?", "{name}, what's the plan?", "Back again, {name}? Love that.",
  "Talk to me, {name}", "What's new, {name}?", "Okay {name}, what's up?", "Your move, {name}",
  "I'm all ears, {name}", "{name}, let's get into it", "What can I take off your plate, {name}?",
];
const MORNING = ["Morning, {name}", "Coffee first, or straight to it, {name}?", "Fresh start, {name}. What's first?", "Rise and shine, {name}"];
const AFTERNOON = ["Afternoon, {name}", "How's the day treating you, {name}?", "Halfway through the day, {name}"];
const EVENING = ["Evening, {name}", "How was today, {name}?", "Winding down, {name}?"];
const NIGHT = ["Still up, {name}?", "Late night thoughts, {name}?", "The quiet hours, {name}. What's up?", "Can't sleep, {name}?"];
const DAYS: Record<number, string[]> = {
  0: ["Slow Sunday, {name}?", "Sunday reset, {name}?"],
  1: ["New week, {name}. Let's go.", "Monday again, {name}. We've got this."],
  4: ["Almost the weekend, {name}"],
  5: ["Happy Friday, {name}", "Friday feeling, {name}?"],
  6: ["Weekend mode, {name}?", "Saturday plans, {name}?"],
};
const LAST = "mb-last-greeting";

/* returns [before, name, after] so the name can be styled */
export function pickGreeting(name: string, now = new Date()): [string, string, string] {
  const h = now.getHours();
  const time = h < 5 || h >= 22 ? NIGHT : h < 12 ? MORNING : h < 17 ? AFTERNOON : EVENING;
  const day = DAYS[now.getDay()] ?? [];
  const r = Math.random();
  const pool = r < 0.4 ? time : r < 0.6 && day.length ? day : ANY;
  let last = "";
  try { last = localStorage.getItem(LAST) ?? ""; } catch { /* private mode */ }
  let pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick === last) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
  try { localStorage.setItem(LAST, pick); } catch { /* private mode */ }
  if (!name) {
    const t = pick.replace(/^\{name\},?\s*/, "").replace(/,?\s*\{name\}/, "").trim();
    return [t.charAt(0).toUpperCase() + t.slice(1), "", ""];
  }
  const [before, after] = pick.split("{name}");
  return [before, name, after ?? ""];
}
