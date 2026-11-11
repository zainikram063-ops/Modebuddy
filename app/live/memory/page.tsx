"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type S = { do: string; app?: string; url?: string; path?: string; text?: string; keys?: string; target?: string; name?: string };
type Mem = { routines: { name: string; triggers?: string[]; steps?: S[]; uses?: number }[]; facts: string[] };

const stepText = (s: S) =>
  s.do === "open_app" ? `Open ${s.app}`
  : s.do === "open_url" ? String(s.url || "").replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)
  : s.do === "open_path" ? `Open ${String(s.path || "").split("/").slice(-2).join("/")}`
  : s.do === "type" ? `Type “${String(s.text || "").slice(0, 24)}…”`
  : s.do === "key" ? `Press ${s.keys}`
  : s.do === "click" ? `Click ${s.target || ""}`
  : s.do;

export default function LiveMemory() {
  const [m, setM] = useState<Mem | null>(null);
  useEffect(() => {
    fetch("/api/live/learn").then((r) => r.json()).then((d) => setM({ routines: d.routines || [], facts: d.facts || [] })).catch(() => setM({ routines: [], facts: [] }));
  }, []);
  const save = (next: Mem) => {
    setM(next);
    fetch("/api/live/learn", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }).catch(() => {});
  };
  return (
    <div className="legal-wrap">
      <main className="legal lv-hist">
        <h1>What ModeBuddy remembers</h1>
        <p>ModeBuddy learns your routines and preferences as you use Live. Say a routine (or just “start everything up”) and it runs straight away. Remove anything you don&apos;t want it to remember.</p>
        {!m ? <p>Loading…</p> : (
          <>
            <h2>Routines</h2>
            {m.routines.length === 0 && <p>None yet. Ask ModeBuddy to open your usual apps and it will learn them.</p>}
            {m.routines.map((r, i) => (
              <div key={i} className="lv-mem">
                <div>
                  <b>{r.name}{r.uses ? ` · used ${r.uses}×` : ""}</b>
                  <span>{(r.steps || []).map(stepText).join(" → ")}</span>
                  {r.triggers?.length ? <em>Say: “{r.triggers.slice(0, 3).join("”, “")}”</em> : null}
                </div>
                <button onClick={() => save({ ...m, routines: m.routines.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
            <h2>Things it knows about you</h2>
            {m.facts.length === 0 && <p>Nothing yet.</p>}
            {m.facts.map((f, i) => (
              <div key={i} className="lv-mem">
                <div><span>{f}</span></div>
                <button onClick={() => save({ ...m, facts: m.facts.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
          </>
        )}
        <p className="legal-back"><Link href="/live">Live settings</Link> · <Link href="/live/history">Live history</Link> · <Link href="/">← Back to ModeBuddy</Link></p>
      </main>
    </div>
  );
}
