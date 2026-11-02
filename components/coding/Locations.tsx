"use client";

import { useEffect, useState } from "react";
import { FileCode2 } from "lucide-react";

export const ROOT_KEY = "mb-project-root";
export type Loc = { path: string; line?: number; col?: number };

const LOC_RE = /([\w./@~\-[\]()]+\.[a-z]{1,6})"?(?:(?::|,\s*line\s+)(\d+))?(?::(\d+))?/gi;
export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

export function locations(text: string, max = 6): Loc[] {
  const seen = new Set<string>();
  const out: Loc[] = [];
  for (const m of text.matchAll(LOC_RE)) {
    const loc: Loc = { path: m[1], line: m[2] ? Number(m[2]) : undefined, col: m[3] ? Number(m[3]) : undefined };
    const key = `${loc.path}:${loc.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
    if (out.length >= max) break;
  }
  return out;
}

export function askRoot(current: string): string | null {
  const v = prompt(
    "To open files in VS Code, paste your project folder's full path.\n(In Terminal, go into your project folder and run: pwd)",
    current
  );
  if (!v?.trim()) return null;
  const root = v.trim().replace(/\/+$/, "");
  localStorage.setItem(ROOT_KEY, root);
  window.dispatchEvent(new Event("mb-root"));
  return root;
}

export function openInEditor(l: Loc) {
  let root = localStorage.getItem(ROOT_KEY) ?? "";
  if (!l.path.startsWith("/") && !root) {
    const v = askRoot("");
    if (!v) return;
    root = v;
  }
  const full = l.path.startsWith("/") ? l.path : `${root}/${l.path.replace(/^\.?\//, "")}`;
  window.location.href = `vscode://file${full}${l.line ? `:${l.line}${l.col ? `:${l.col}` : ""}` : ""}`;
}

export function LocChip({ loc }: { loc: Loc }) {
  return (
    <button type="button" className="dbg-loc" title={`Open ${loc.path}${loc.line ? `:${loc.line}` : ""} in VS Code`} onClick={() => openInEditor(loc)}>
      <FileCode2 size={12} strokeWidth={2} />
      {baseName(loc.path)}{loc.line ? `:${loc.line}` : ""}
    </button>
  );
}

export function RootNote() {
  const [root, setRoot] = useState("");
  useEffect(() => {
    const read = () => setRoot(localStorage.getItem(ROOT_KEY) ?? "");
    read();
    addEventListener("mb-root", read);
    return () => removeEventListener("mb-root", read);
  }, []);
  if (!root) return null;
  return (
    <button type="button" className="dbg-root" title={root} onClick={() => askRoot(root)}>
      in …/{baseName(root)} · change
    </button>
  );
}
