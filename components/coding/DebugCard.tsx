"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bug, CheckCircle2, FileCode2, Search, Wrench } from "lucide-react";
import { InlineMd } from "../Markdown";

const DEBUG_RE = /<debug>([\s\S]*?)(<\/debug>|$)/i;
type Key = "error" | "where" | "cause" | "fix" | "confirm";
const KEY_RE = /^\s*[-*]?\s*\**\s*(error|where|cause|fix|confirm)\s*\**\s*:\s*\**\s*(.*)$/i;
const LOC_RE = /([\w./@~\-[\]()]+\.[a-z]{1,6})"?(?:(?::|,\s*line\s+)(\d+))?(?::(\d+))?/gi;
const ROOT_KEY = "mb-project-root";

const STEPS: { key: Key; label: string; icon: JSX.Element }[] = [
  { key: "cause", label: "Likely cause", icon: <Search size={13} strokeWidth={2} /> },
  { key: "fix", label: "Fix", icon: <Wrench size={13} strokeWidth={2} /> },
  { key: "confirm", label: "How to confirm", icon: <CheckCircle2 size={13} strokeWidth={2} /> },
];

function parse(body: string) {
  const out: Partial<Record<Key, string>> = {};
  let cur: Key | null = null;
  for (const raw of body.split("\n")) {
    const m = KEY_RE.exec(raw);
    if (m) {
      cur = m[1].toLowerCase() as Key;
      out[cur] = m[2].replace(/\*+$/, "").trim();
    } else if (cur && raw.trim()) {
      out[cur] = `${out[cur] ?? ""}\n${raw.trim()}`.trim();
    }
  }
  return out;
}

function splitError(e: string): [string, string] {
  const m = /^\s*(?:Uncaught\s+|Unhandled\s+\w+\s*:?\s*)?([\w.$]*(?:Error|Exception|Warning)\w*)\s*:?\s*([\s\S]*)$/.exec(e);
  return m ? [m[1], m[2].trim()] : ["", e.trim()];
}

type Loc = { path: string; line?: number; col?: number };
function locations(where: string): Loc[] {
  const seen = new Set<string>();
  const out: Loc[] = [];
  for (const m of where.matchAll(LOC_RE)) {
    const loc = { path: m[1], line: m[2] ? Number(m[2]) : undefined, col: m[3] ? Number(m[3]) : undefined };
    const key = `${loc.path}:${loc.line ?? ""}`;
    if (!seen.has(key)) { seen.add(key); out.push(loc); }
  }
  return out.slice(0, 6);
}

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

function askRoot(current: string) {
  const v = prompt(
    "To open files in VS Code, paste your project folder's full path.\n(In Terminal, go into your project folder and run: pwd)",
    current
  );
  if (!v?.trim()) return null;
  const root = v.trim().replace(/\/+$/, "");
  localStorage.setItem(ROOT_KEY, root);
  return root;
}

function openInEditor(l: Loc, root: string) {
  let r = root;
  if (!l.path.startsWith("/") && !r) {
    const v = askRoot("");
    if (!v) return null;
    r = v;
  }
  const full = l.path.startsWith("/") ? l.path : `${r}/${l.path.replace(/^\.?\//, "")}`;
  window.location.href = `vscode://file${full}${l.line ? `:${l.line}${l.col ? `:${l.col}` : ""}` : ""}`;
  return r;
}

export function DebugCard({ body, done }: { body: string; done: boolean }) {
  const d = parse(body);
  const [type, msg] = splitError(d.error ?? "");
  const locs = locations(d.where ?? "");
  const [root, setRoot] = useState("");
  useEffect(() => { setRoot(localStorage.getItem(ROOT_KEY) ?? ""); }, []);

  return (
    <div className={`debug-card ${done ? "" : "loading"}`}>
      <header className="dbg-head">
        <span className="dbg-icon"><Bug size={15} strokeWidth={2} /></span>
        <div className="dbg-err">
          {type && <b>{type}</b>}
          <span>{msg ? <InlineMd text={msg} /> : done ? "" : "Reading the error…"}</span>
        </div>
      </header>

      {locs.length > 0 && (
        <div className="dbg-locs">
          {locs.map((l) => (
            <button key={`${l.path}:${l.line ?? ""}`} type="button" className="dbg-loc"
                    title={`Open ${l.path}${l.line ? `:${l.line}` : ""} in VS Code`}
                    onClick={() => { const r = openInEditor(l, root); if (r) setRoot(r); }}>
              <FileCode2 size={12} strokeWidth={2} />{base(l.path)}{l.line ? `:${l.line}` : ""}
            </button>
          ))}
          {root && (
            <button type="button" className="dbg-root" title={root} onClick={() => { const r = askRoot(root); if (r) setRoot(r); }}>
              in …/{base(root)} · change
            </button>
          )}
        </div>
      )}

      <ol className="dbg-steps">
        {STEPS.map((s, i) => {
          const v = d[s.key];
          if (!v && done) return null;
          return (
            <li key={s.key} className={`dbg-step ${s.key}`} style={{ animationDelay: `${i * 90}ms` }}>
              <span className="dbg-label">{s.icon}{s.label}</span>
              <div className="dbg-text">{v ? <InlineMd text={v} /> : <i className="dbg-skel" />}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Pulls a <debug> block out of a message and renders the text around it with `render` */
export function DebugText({ text, render }: { text: string; render: (t: string, key: string) => ReactNode }) {
  const m = text.match(DEBUG_RE);
  if (!m || m.index === undefined) return <>{render(text, "all")}</>;
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  return (
    <>
      {before.trim() && render(before, "before")}
      <DebugCard body={m[1]} done={!!m[2]} />
      {after.trim() && render(after, "after")}
    </>
  );
}
