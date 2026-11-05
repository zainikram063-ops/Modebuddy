"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

type Res = { url: string; title?: string };
type Part = { type: string; toolInvocation?: { toolName: string; state: string; result?: unknown } };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const fav = (u: string) => `https://www.google.com/s2/favicons?domain=${host(u)}&sz=64`;

/* Small logo row at the end of an answer; click to list every source */
export default function Sources({ parts, cites }: { parts?: readonly unknown[]; cites: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const seen = new Set<string>();
  const items: Res[] = [];
  for (const p of (parts ?? []) as Part[]) {
    const t = p.toolInvocation;
    if (p.type !== "tool-invocation" || t?.toolName !== "web_search" || t.state !== "result") continue;
    for (const r of (t.result as { results?: Res[] })?.results ?? [])
      if (r?.url && !seen.has(r.url)) { seen.add(r.url); items.push(r); }
  }
  if (!items.length) return null;
  return (
    <div className="srcs">
      <button type="button" className="srcs-pill" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="srcs-logos">{items.slice(0, 5).map((s) => <img key={s.url} src={fav(s.url)} alt="" />)}</span>
        {items.length} sources <ChevronDown size={13} strokeWidth={2} className={open ? "up" : ""} />
      </button>
      {open && (
        <ol className="srcs-list">
          {items.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer">
                <span className="srcs-n">{cites.get(s.url) ?? ""}</span>
                <img src={fav(s.url)} alt="" />
                <span><b>{s.title || host(s.url)}</b><small>{host(s.url)}</small></span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
