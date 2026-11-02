"use client";

import type { ReactNode } from "react";
import { Bug, CheckCircle2, Search, Wrench } from "lucide-react";
import { InlineMd } from "../Markdown";
import { LocChip, RootNote, locations } from "./Locations";
import { ReviewCard } from "./ReviewCard";

const BLOCK_RE = /<(debug|review)>([\s\S]*?)(<\/\1>|$)/i;
type Key = "error" | "where" | "cause" | "fix" | "confirm";
const KEY_RE = /^\s*[-*]?\s*\**\s*(error|where|cause|fix|confirm)\s*\**\s*:\s*\**\s*(.*)$/i;

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

export function DebugCard({ body, done }: { body: string; done: boolean }) {
  const d = parse(body);
  const [type, msg] = splitError(d.error ?? "");
  const locs = locations(d.where ?? "");

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
          {locs.map((l) => <LocChip key={`${l.path}:${l.line ?? ""}`} loc={l} />)}
          <RootNote />
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

/** Pulls <debug> and <review> blocks out of a message; the text around them goes through `render` */
export function DebugText({ text, render }: { text: string; render: (t: string, key: string) => ReactNode }) {
  const m = text.match(BLOCK_RE);
  if (!m || m.index === undefined) return <>{render(text, "all")}</>;
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const done = !!m[3];
  return (
    <>
      {before.trim() && render(before, "before")}
      {m[1].toLowerCase() === "debug" ? <DebugCard body={m[2]} done={done} /> : <ReviewCard body={m[2]} done={done} />}
      {after.trim() && <DebugText text={after} render={render} />}
    </>
  );
}
