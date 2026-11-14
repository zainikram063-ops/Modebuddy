// Reads the AI's reply: SAY, MODE, DO, USE, REMEMBER and HEARD lines, then the answer after ---
export function parse(raw: string, final: boolean) {
  const cut = raw.search(/^-{3,}\s*$/m);
  const head = cut >= 0 ? raw.slice(0, cut) : raw;
  const get = (k: string) => (head.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.*)$", "mi")) || [])[1]?.trim() || "";
  let answer = cut >= 0 ? raw.slice(cut).replace(/^-{3,}\s*\n?/, "") : "";
  if (cut < 0 && final) answer = raw.replace(/^\s*(HEARD|MODE|SAY|DO|USE|REMEMBER)\s*:.*$/gim, "").trim();
  return { heard: get("HEARD"), mode: get("MODE").toLowerCase().replace(/[^a-z]/g, ""), say: get("SAY"), does: get("DO"), use: get("USE"), remember: get("REMEMBER"), answer };
}

// The part worth pasting: the first code block, or the whole answer
export const pasteable = (md: string) => ((md.match(/```[^\n]*\n([\s\S]*?)```/) || [])[1] ?? md).trim();
// The answer without Markdown, for reading out loud
export const plain = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim();

// Black or white, whichever reads better on this colour
export function onColor(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  if (Number.isNaN(n)) return "#0a0a0a";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#0a0a0a" : "#ffffff";
}

// Which built-in mode fits the app in front
export const appMode = (app: string) =>
  /cursor|code|xcode|terminal|iterm|warp|studio|intellij|pycharm|webstorm|sublime|zed|nova|docker|github/i.test(app) ? "code"
  : /notion|notes|obsidian|goodnotes|notability|preview|books|anki|quizlet|word|pages|onenote|craft|bear|classroom/i.test(app) ? "study" : "buddy";

// Words that mean a file or folder, not an app
export const FILEY = /\b(folders?|files?|documents?|docs?|project|md|markdown|pdf|png|jpe?g|txt|csv|downloads)\b/i;
