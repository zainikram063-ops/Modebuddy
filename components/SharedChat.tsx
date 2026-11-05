"use client";
/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from "react";
import { Globe } from "lucide-react";
import Markdown from "./Markdown";
import ModeIcon from "@/components/ModeIcon";

export type SharePart =
  | { type: "text"; text: string }
  | { type: "sources"; query: string; results: { title: string; url: string }[] };
export type ShareData = {
  id: string;
  title: string;
  created_at: string;
  mode: { name: string; icon: string; accent: string; theme: string } | null;
  messages: { role: "user" | "assistant"; parts: SharePart[]; attachments: { name: string; url: string }[] }[];
};

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export default function SharedChat({ s }: { s: ShareData }) {
  const style = { "--mb-a": s.mode?.accent || "#c6ff3d" } as CSSProperties;

  return (
    <main className="share" data-theme={s.mode?.theme ?? "dark"} style={style}>
      <div className="share-inner">
        <header className="share-top">
          <span className="share-brand"><span>⌥</span> ModeBuddy</span>
          {s.mode && <span className="mode-badge"><span><ModeIcon icon={s.mode.icon} /></span>{s.mode.name}</span>}
        </header>
        <h1 className="share-title">{s.title}</h1>
        <p className="share-sub" suppressHydrationWarning>
          Shared {new Date(s.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })} · read-only
        </p>

        <div className="thread">
          {s.messages.map((m, i) =>
            m.role === "user" ? (
              <article key={i} className="msg user">
                {m.attachments.length > 0 && (
                  <div className="att-row">
                    {m.attachments.map((a, j) => (
                      <a key={j} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name} className="att-img" /></a>
                    ))}
                  </div>
                )}
                {m.parts.map((p, j) => p.type === "text" ? <div key={j} className="bubble">{p.text}</div> : null)}
              </article>
            ) : (
              <article key={i} className="msg assistant">
                <div className="avatar" aria-hidden>⌥</div>
                <div className="answer">
                  {m.parts.map((p, j) =>
                    p.type === "text" ? (
                      <Markdown key={j} text={p.text} />
                    ) : (
                      <div key={j} className="web-card">
                        <div className="web-head"><Globe size={14} strokeWidth={1.75} /> Searched <em>{p.query}</em></div>
                        <div className="web-sources">
                          {p.results.map((r) => (
                            <a key={r.url} className="src-card" href={r.url} target="_blank" rel="noreferrer" title={r.title}>
                              <img src={`https://www.google.com/s2/favicons?domain=${host(r.url)}&sz=64`} alt="" />
                              <span className="src-meta"><b>{r.title}</b><small>{host(r.url)}</small></span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </article>
            )
          )}
        </div>

        <footer className="share-foot">
          <a className="share-cta" href="/">Made with ModeBuddy · Start your own chat →</a>
        </footer>
      </div>
    </main>
  );
}
