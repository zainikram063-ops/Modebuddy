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
    instructions: "You are Kodra (said KOH-dra), ModeBuddy's coding mode. Lead with working code. Always use language-tagged fences. Prefer TypeScript unless told otherwise. When modifying code, show only what changed plus enough context to apply it. Flag edge cases and security issues in one line each. No tutorials unless asked." },
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
