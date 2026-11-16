// Live reflexes: common commands ModeBuddy does instantly, without asking the AI
import { FILEY } from "./parse";

type Step = { do: string; [k: string]: unknown };
export type Reflex = { say: string; steps?: Step[]; use?: string };

const ALIAS: Record<string, string> = { chrome: "google chrome", "vs code": "visual studio code", vscode: "visual studio code", word: "microsoft word", excel: "microsoft excel", powerpoint: "microsoft powerpoint", outlook: "microsoft outlook", teams: "microsoft teams", zoom: "zoom.us", settings: "system settings", "system preferences": "system settings", preferences: "system settings", "i term": "iterm" };
const BUILTIN = ["Finder", "Safari", "Terminal", "Notes", "Mail", "Messages", "Music", "Photos", "Calendar", "Reminders", "System Settings", "App Store", "FaceTime", "Maps", "Preview", "Calculator", "Weather"];
const SITES: Record<string, string> = { youtube: "https://www.youtube.com", gmail: "https://mail.google.com", google: "https://www.google.com", "google docs": "https://docs.google.com", "google drive": "https://drive.google.com", github: "https://github.com", chatgpt: "https://chatgpt.com", "chat gpt": "https://chatgpt.com", claude: "https://claude.ai/new", gemini: "https://gemini.google.com/app", perplexity: "https://www.perplexity.ai", netflix: "https://www.netflix.com", twitter: "https://x.com", instagram: "https://www.instagram.com", facebook: "https://www.facebook.com", reddit: "https://www.reddit.com", linkedin: "https://www.linkedin.com", whatsapp: "https://web.whatsapp.com", amazon: "https://www.amazon.com", "google maps": "https://maps.google.com", vercel: "https://vercel.com/dashboard", supabase: "https://supabase.com/dashboard", notion: "https://www.notion.so", figma: "https://www.figma.com", canva: "https://www.canva.com", spotify: "https://open.spotify.com", modebuddy: "https://modebuddy.vercel.app" };
const KEYS: [RegExp, string, string][] = [
  [/^(open )?(a )?new tab$/, "cmd+t", "New tab."],
  [/^close (this |the )?(tab|window)$/, "cmd+w", "Closed it."],
  [/^(open )?(a )?new window$/, "cmd+n", "New window."],
  [/^re ?open (the )?(last |closed )?tab$/, "cmd+shift+t", "Reopened it."],
  [/^(refresh|reload)( (the|this) page)?$/, "cmd+r", "Refreshing."],
  [/^go back$/, "cmd+[", "Going back."],
  [/^go forward$/, "cmd+]", "Going forward."],
  [/^lock (my |the )?(screen|mac|computer|laptop)$/, "ctrl+cmd+q", "Locking your Mac."],
];
// Steps ModeBuddy is sure about skip the AI's final screen check
const sure = (s: Step): Step => ({ ...s, sure: true });

function dist(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Finds the installed app you meant ("chrome" -> Google Chrome, "crome" -> Google Chrome)
export function findApp(name: string, installed: string[], strict: boolean) {
  const n0 = name.replace(/\.app$/, "").trim();
  if (n0.length < 2) return "";
  const n = ALIAS[n0] || n0;
  const list = installed.length ? installed : BUILTIN;
  const low = list.map((a) => a.toLowerCase());
  let i = low.indexOf(n);
  if (i < 0 && strict) return "";
  if (i < 0) i = low.findIndex((a) => a.startsWith(n + " ") || a.replace(/\s+/g, "") === n.replace(/\s+/g, "") || a.split(/[\s.]+/).includes(n));
  if (i < 0 && n.length >= 4) {
    let best = -1, bd = 9;
    low.forEach((a, k) => { for (const w of [a, ...a.split(/\s+/)]) { const d = dist(w, n); if (d < bd) { bd = d; best = k; } } });
    if (best >= 0 && bd <= (n.length >= 7 ? 2 : 1)) i = best;
  }
  return i >= 0 ? list[i] : "";
}

function opener(target: string, installed: string[]): Step | null {
  const t = target.replace(/^(the|my|up) /, "").replace(/ (app|application|website|site)$/, "").trim();
  const exact = findApp(t, installed, true);
  if (exact) return { do: "open_app", app: exact };
  if (SITES[t]) return { do: "open_url", url: SITES[t] };
  const dom = t.replace(/ dot /g, ".").replace(/\s+/g, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(dom)) return { do: "open_url", url: "https://" + dom };
  const loose = findApp(t, installed, false);
  return loose ? { do: "open_app", app: loose } : null;
}

const google = (q: string) => "https://www.google.com/search?q=" + encodeURIComponent(q);
const youtube = (q: string) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function reflex(words: string, installed: string[], routines: { name: string; triggers?: string[] }[]): Reflex | null {
  let t = words.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9.'\s-]/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(hey |ok |okay )?(mode ?buddy )?/, "").replace(/^((please|can you|could you|would you|will you|just|go ahead and|i want to|i wanna|let's|lets) )+/, "").replace(/( (please|for me|now|right now|real quick))+$/, "").replace(/\.$/, "").trim();
  if (!t || t.split(" ").length > 12) return null;

  // Your routines, said exactly the way you usually ask
  const n = norm(t);
  for (const r of routines) if ([r.name, ...(r.triggers || [])].some((x) => norm(String(x)) === n)) return { say: "On it.", use: r.name };

  // Searches (the search words can include "and")
  let m = /^(?:search|look up|google) (?:for )?(.+) on youtube$/.exec(t) || /^(?:search youtube for|search on youtube for|youtube search(?: for)?|play) (.+?)(?: on youtube)?$/.exec(t);
  if (m && (/^play /.test(t) ? /on youtube$/.test(t) : true) && !/\b(then|open|click|type)\b/.test(m[1])) return { say: "Searching YouTube.", steps: [sure({ do: "open_url", url: youtube(m[1]) })] };
  m = /^(?:search|google|look up|search up)(?: for| up)? (.+)$/.exec(t);
  if (m && !FILEY.test(m[1]) && !/\b(then|open|click|type)\b/.test(m[1])) return { say: "Searching for " + m[1] + ".", steps: [sure({ do: "open_url", url: google(m[1]) })] };

  // Anything with more than one step goes to the AI
  if (/\b(and|then|after|with|about|write|type|tell|send|email|message|reply|delete|remove|buy|pay)\b/.test(t)) return null;

  for (const [re, keys, say] of KEYS) if (re.test(t)) return { say, steps: [sure({ do: "key", keys })] };

  // Folders and files: find them, then open the best match
  m = /^(?:open|show|go to|find)(?: me)? (?:my |the |up )?(.+?) (folder|project|file|document)$/.exec(t);
  if (m) return { say: "Opening " + m[1] + ".", steps: [sure({ do: "find", name: m[1], kind: /folder|project/.test(m[2]) ? "folder" : "file" })] };
  m = /^(?:open|show|find)(?: me)? (?:my |the )?(.+? (?:md|pdf|txt|png|jpg|jpeg|docx|csv))$/.exec(t);
  if (m) return { say: "Opening it.", steps: [sure({ do: "find", name: m[1], kind: "file" })] };

  // Apps and websites
  m = /^(?:open|launch|start|switch to|go to|bring up|pull up)(?: up)? (.+)$/.exec(t);
  if (m && !FILEY.test(m[1])) {
    const s = opener(m[1], installed);
    if (s) return { say: "Opening " + (s.do === "open_app" ? String(s.app) : m[1].replace(/^(the|my) /, "")) + ".", steps: [sure(s)] };
  }
  return null;
}
