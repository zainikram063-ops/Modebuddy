/* Server side: turns the project sent by the browser into prompt text */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const MAX_FILE_CHARS = 160_000;

export function projectNote(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const p = raw as { name?: unknown; stack?: unknown; tree?: unknown; files?: unknown };
  const name = str(p.name, 120) || "project";
  const stack = Array.isArray(p.stack) ? p.stack.filter((s): s is string => typeof s === "string").slice(0, 20).join(", ") : "";
  const tree = str(p.tree, 24_000);

  let left = MAX_FILE_CHARS;
  const blocks: string[] = [];
  for (const f of Array.isArray(p.files) ? p.files.slice(0, 30) : []) {
    if (left <= 0) break;
    const path = str((f as { path?: unknown })?.path, 300).replace(/"/g, "");
    const text = str((f as { text?: unknown })?.text, left);
    if (!path || !text) continue;
    left -= text.length;
    const lines = text.split("\n");
    const w = String(lines.length).length;
    blocks.push(`<file path="${path}">\n${lines.map((l, i) => `${String(i + 1).padStart(w, " ")}| ${l}`).join("\n")}\n</file>`);
  }

  return [
    `PROJECT CONTEXT: the user is working in "${name}".`,
    stack && `Stack: ${stack}`,
    tree && `Files (paths only):\n${tree}`,
    blocks.length
      ? `Pinned files (the user's current code and the source of truth. "12| " prefixes are line numbers for reference only; never put them in code you write):\n\n${blocks.join("\n\n")}`
      : "No files are pinned yet.",
    "- Use real paths from this project, and file:line references from the pinned files (e.g. app/page.tsx:42).",
    "- When changing a pinned file, show a diff against the pinned version with its real path.",
    "- If you need a file that isn't pinned, name its exact path from the list and ask the user to pin it. Don't guess what's in it.",
  ].filter(Boolean).join("\n\n");
}
