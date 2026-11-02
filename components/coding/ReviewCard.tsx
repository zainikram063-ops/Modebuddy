"use client";

import { useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Copy, GitCommit, Terminal, XCircle } from "lucide-react";
import { InlineMd } from "../Markdown";
import { LocChip, RootNote, locations } from "./Locations";

type Sev = "high" | "medium" | "low";
type Issue = { sev: Sev; loc: string; title: string; detail: string };
const ORDER: Sev[] = ["high", "medium", "low"];
const LABEL: Record<Sev, string> = { high: "must fix", medium: "should fix", low: "nit" };
const KEY_RE = /^\s*[-*]?\s*\**\s*(verdict|summary|issue|good|commit|body)\s*\**\s*:\s*\**\s*(.*)$/i;

const sevOf = (s: string): Sev =>
  /high|crit|major|must|block|severe|bug|security/i.test(s) ? "high" : /med|should|warn/i.test(s) ? "medium" : "low";

function parse(text: string) {
  const r = { verdict: "", summary: "", issues: [] as Issue[], good: [] as string[], commit: "", body: [] as string[] };
  for (const raw of text.split("\n")) {
    const m = KEY_RE.exec(raw);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const v = m[2].replace(/\*+$/, "").trim();
    if (key === "issue") {
      const parts = v.split("|").map((s) => s.trim());
      let loc = parts[1] ?? "";
      let title = parts[2] ?? "";
      let detail = parts.slice(3).join(" | ");
      if (loc && loc !== "-" && !/[./:]/.test(loc)) {
        detail = [title, detail].filter(Boolean).join(" | ");
        title = loc;
        loc = "";
      }
      r.issues.push({ sev: sevOf(parts[0] ?? ""), loc: loc === "-" ? "" : loc, title, detail });
    } else if (key === "good") r.good.push(v);
    else if (key === "body") r.body.push(v.replace(/^[-•]\s*/, ""));
    else if (key === "verdict") r.verdict = v;
    else if (key === "summary") r.summary = v;
    else r.commit = v.replace(/^`+|`+$/g, "");
  }
  return r;
}

function verdict(v: string, issues: Issue[], done: boolean) {
  const s = v.toLowerCase();
  const high = issues.some((i) => i.sev === "high");
  if (!s && !done) return { key: "warn", label: "Reviewing…", icon: <AlertTriangle size={13} strokeWidth={2.25} /> };
  if (/needs? work|rethink|block|reject/.test(s)) return { key: "bad", label: "Needs work", icon: <XCircle size={13} strokeWidth={2.25} /> };
  if (!high && (/ship|lgtm|approve|good to go/.test(s) || !s))
    return { key: "ok", label: "Ship it", icon: <CheckCircle2 size={13} strokeWidth={2.25} /> };
  return { key: "warn", label: "Fix first", icon: <AlertTriangle size={13} strokeWidth={2.25} /> };
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function ReviewCard({ body, done }: { body: string; done: boolean }) {
  const r = parse(body);
  const [copied, setCopied] = useState("");
  const v = verdict(r.verdict, r.issues, done);
  const sorted = ORDER.flatMap((s) => r.issues.filter((i) => i.sev === s));
  const counts = ORDER.map((s) => [s, r.issues.filter((i) => i.sev === s).length] as const).filter(([, n]) => n > 0);
  const bodyText = r.body.map((b) => `- ${b}`).join("\n");
  const message = bodyText ? `${r.commit}\n\n${bodyText}` : r.commit;
  const gitCmd = `git commit -m ${sh(r.commit)}${bodyText ? ` -m ${sh(bodyText)}` : ""}`;

  const copy = async (what: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 1300);
  };

  return (
    <div className={`review-card v-${v.key} ${done ? "" : "loading"}`}>
      <header className="rv-head">
        <span className="rv-badge">{v.icon}{v.label}</span>
        <p className="rv-sum">{r.summary ? <InlineMd text={r.summary} /> : done ? "" : "Reading your changes…"}</p>
        {counts.length > 0 && (
          <span className="rv-counts">
            {counts.map(([s, n]) => <em key={s} className={s}>{n} {LABEL[s]}</em>)}
          </span>
        )}
      </header>

      {sorted.length > 0 && (
        <ol className="rv-issues">
          {sorted.map((i, k) => {
            const loc = locations(i.loc, 1)[0];
            return (
              <li key={k} className={`rv-issue ${i.sev}`} style={{ animationDelay: `${k * 60}ms` }}>
                <span className="rv-dot" aria-label={LABEL[i.sev]} />
                <div>
                  <div className="rv-title">
                    <b><InlineMd text={i.title || "Issue"} /></b>
                    {loc && <LocChip loc={loc} />}
                  </div>
                  {i.detail && <p><InlineMd text={i.detail} /></p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {r.good.length > 0 && (
        <ul className="rv-good">
          {r.good.map((g, k) => <li key={k}><Check size={13} strokeWidth={2.5} /><span><InlineMd text={g} /></span></li>)}
        </ul>
      )}

      {r.commit && (
        <div className="rv-commit">
          <div className="rv-commit-head">
            <GitCommit size={14} strokeWidth={2} /> Commit message
            <span className="rv-space" />
            <button type="button" onClick={() => copy("msg", message)}>
              {copied === "msg" ? <Check size={12} strokeWidth={2.5} /> : <Copy size={12} strokeWidth={2} />} Copy
            </button>
            <button type="button" onClick={() => copy("cmd", gitCmd)}>
              {copied === "cmd" ? <Check size={12} strokeWidth={2.5} /> : <Terminal size={12} strokeWidth={2} />} Copy git command
            </button>
          </div>
          <pre><b>{r.commit}</b>{bodyText ? `\n\n${bodyText}` : ""}</pre>
        </div>
      )}

      {sorted.some((i) => i.loc) && <div className="rv-root"><RootNote /></div>}
    </div>
  );
}
