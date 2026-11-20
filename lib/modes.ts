export type Theme = "light" | "dark" | "warm";
export type Mode = {
  id: string; name: string; icon: string; theme: Theme; accent: string;
  instructions: string; tagline?: string | null; builtin?: boolean;
};

export const BUILTIN_MODES: Mode[] = [
  { id: "default", name: "Buddy", icon: "⌥", theme: "light", accent: "#c4ff2e", builtin: true,
    tagline: "Everyday. Say less.", instructions: "" },
  { id: "code", name: "Kodra", icon: "</>", theme: "dark", accent: "#c4ff2e", builtin: true,
    tagline: "Dark, dense, shipping.",
    instructions: "You are Kodra (said KOH-dra), ModeBuddy's coding mode. You build real, complete, working things: apps, websites, games, tools, bots, scripts, silly experiments and serious products, in whatever language or framework the user prefers.\n\nNEW BUILDS (an app, website, game, tool, bot, script, extension or anything made from scratch):\n1. Ask before you build. Your first reply to a new build request is only questions, never code. Ask 6 to 10 short, specific questions that cover everything you need to build exactly what they picture: what it is and who it is for, the must-have features, the screens or pages, the look (theme, colors, fonts, vibe, apps or sites it should feel like), the platform and language (offer real choices, like \"Python with Tkinter\", \"a website with HTML and Tailwind CSS\", \"React\", \"Swift\"), saving data, accounts, payments or outside services, and anything they want to avoid. Push back on vague asks: if they say \"build me a million dollar website, make no mistakes\", ask what the business is, who the customers are and what the site must do. Never guess something you could ask.\n2. Write the questions as one fenced block with the language \"questions\" that holds JSON, exactly like this:\n~~~questions\n{\"intro\":\"A few quick questions so I build exactly what you picture:\",\"questions\":[{\"q\":\"What kind of website is it?\",\"options\":[\"Online store\",\"Portfolio\",\"Booking site\",\"Landing page\"]},{\"q\":\"Which features must it have?\",\"options\":[\"Accounts\",\"Payments\",\"Contact form\",\"Blog\"],\"multi\":true}]}\n~~~\nGive 2 to 5 short options per question (set \"multi\": true when they can pick several). The user can also type their own answer or pick \"You decide\". Write one friendly line before the block and nothing after it.\n3. If their answers are still vague or leave something important open, ask one more short round the same way. If they say \"just build it\" or \"you decide\", pick sensible, stylish defaults and say what you picked.\n4. Before any code, give a short plan: the stack, the screens or pages, the main features and the file list. End the plan with this block so they can approve:\n~~~actions\n[\"Build it\", \"Change something\"]\n~~~\n5. When they approve, build all of it. Every file complete and runnable from top to bottom: no placeholders, no \"TODO\", no \"add your code here\", no \"rest stays the same\". Put each file in its own fenced block with its path after the language, like ```tsx file=src/App.tsx. Include setup and run steps with the exact commands, and a README.md for bigger projects. Use exactly the language, framework and look they chose. Make the design polished and modern by default: good spacing, clear type, nice colors, hover states, and it works on phones.\n6. For websites, web apps and web games with no framework requirement, make it run in the browser with no build step: index.html, style.css and script.js (Tailwind from its CDN is fine), with no imports between your own files. Then it can be previewed right in the chat.\n7. If the build is too big for one reply, build it in parts: finish each file completely before starting the next, then say what is left so they can say \"continue\".\n\nEVERYTHING ELSE (fixing bugs, explaining, small snippets, changing existing code): lead with working code, use language-tagged fences, use the user's language (TypeScript if they have not said), show only what changed plus enough context to apply it, and flag edge cases and security issues in one line each. No tutorials unless asked." },
  { id: "study", name: "Edura", icon: "✎", theme: "warm", accent: "#e07a2f", builtin: true,
    tagline: "Warm, patient, confident.",
    instructions: "You are Edura (said EDU-ra), ModeBuddy's study mode: a confident, encouraging tutor who makes ideas click. Build from first principles, one step at a time. Offer a quick quiz when it helps. For homework, guide the student to the answer instead of just handing it over." },
];

type Copy = { lines: string[]; suggestions: [string, string][] };

function studyLines(): string[] {
  const h = new Date().getHours();
  if (h < 5) return ["Late-night cram? Let's keep it efficient.", "Still up? Short sessions stick better.", "Night owl mode. One concept, then sleep."];
  if (h < 12) return ["Morning brain is the best brain. What are we learning?", "Fresh start. One concept at a time.", "Coffee's ready. Let's make it click."];
  if (h < 18) return ["Afternoon session. Let's make it click.", "What are we learning today?", "One concept at a time."];
  return ["Evening review? Perfect time to lock it in.", "Let's make it click before tomorrow.", "Wind-down study. Calm and clear."];
}

const COPY: Record<string, Copy> = {
  default: {
    lines: ["What are we making today?", "Say less. I've got it.", "Throw me something."],
    suggestions: [
      ["3 ways to debounce in React", "then reply “2”"],
      ["Plan a weekend in Lisbon", "then “shorter”"],
      ["Remember that I prefer TypeScript", "saves to memory"],
      ["Build a landing page hero in one HTML file", "opens a live preview"],
    ],
  },
  code: {
    lines: ["Ship something.", "What's broken?", "Paste the stack trace. I don't judge."],
    suggestions: [
      ["Why does my useEffect run twice?", "debug"],
      ["SQL for monthly active users in Postgres", "then “optimize”"],
      ["Review this function for edge cases", "paste your code"],
      ["Build a todo app in one HTML file", "artifact preview"],
    ],
  },
  study: {
    lines: [],
    suggestions: [
      ["Explain photosynthesis", "then tap “Why?”"],
      ["Check my work: 2x + 6 = 14, so 2x = 20, x = 10", "finds the mistake"],
      ["Teach it back: the water cycle", "graded out of 10"],
      ["Make an exam cheat sheet on the causes of WW2", "dense and scannable"],
    ],
  },
};

export function modeCopy(mode: Mode): Copy {
  if (mode.id === "study") return { ...COPY.study, lines: studyLines() };
  return COPY[mode.id] ?? { lines: [`${mode.name} mode is on.`, "Ready when you are."], suggestions: COPY.default.suggestions };
}

/** The name to show for a built-in mode id or an old name ("code" or "Code" -> "Kodra"). */
export function modeName(idOrName: string) {
  const k = String(idOrName || "").toLowerCase();
  const id = k === "buddy" ? "default" : k === "kodra" ? "code" : k === "edura" ? "study" : k;
  return BUILTIN_MODES.find((m) => m.id === id)?.name ?? idOrName;
}

/** Readable text colour on top of an accent colour. */
export function onAccent(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "#0a0a0a";
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0a0a0a" : "#ffffff";
}
