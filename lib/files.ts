export type CodeFile = { path: string; raw: string };

const PATH_META = /(?:^|\s)(?:path|file|filename|title)=["']?([^\s"']+)/i;
const PATH_LINE = /^\s*(?:\/\/|#|--|<!--|\/\*)\s*(?:file(?:name)?:\s*)?((?:[\w@.\-[\]()]+\/)*[\w@.\-[\]()]+\.[a-z0-9]{1,8})\s*(?:\*\/|-->)?\s*$/i;

/** Path from the fence (```tsx path=app/page.tsx) or a first-line comment (// app/page.tsx) */
export function pathFrom(meta: string | null | undefined, raw: string) {
  const m = (meta ?? "").match(PATH_META);
  if (m) return m[1];
  const t = (meta ?? "").trim();
  if (t && !t.includes(" ") && /[./]/.test(t)) return t;
  return (raw.split("\n", 1)[0] ?? "").match(PATH_LINE)?.[1] ?? "";
}

const FENCE = /```([\w+#.-]*)[ \t]*([^\n]*)\n([\s\S]*?)```/g;

/** Every file-labelled code block in an answer (last version of each path wins) */
export function filesFromMarkdown(md: string): CodeFile[] {
  const map = new Map<string, string>();
  for (const m of md.matchAll(FENCE)) {
    const lang = m[1].toLowerCase();
    if (["diff", "patch", "mermaid"].includes(lang)) continue;
    const raw = m[3].replace(/\n$/, "");
    const path = pathFrom(m[2], raw);
    if (path) map.set(path, raw);
  }
  return [...map].map(([path, raw]) => ({ path, raw }));
}

const safePath = (p: string) => p.replace(/\\/g, "/").replace(/^\/+/, "").replace(/(^|\/)\.\.(?=\/)/g, "").replace(/\/{2,}/g, "/");

export async function downloadZip(files: CodeFile[], name = "modebuddy-files.zip") {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const f of files) zip.file(safePath(f.path), f.raw.endsWith("\n") ? f.raw : f.raw + "\n");
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
