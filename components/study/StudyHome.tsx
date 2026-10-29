"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Flame, Layers, Target, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { countByDay, dayKey, heatLevel, heatmap, streak, weakSpots, type Attempt, type WeakSpot } from "@/lib/progress";

type Stats = {
  streak: number; today: boolean; due: number; mastered: number; cards: number;
  acc7: number | null; weak: WeakSpot[]; days: Map<string, number>; empty: boolean;
};
type Props = { refreshKey: number; onReview: () => void; onPractice: (topic: string) => void };

const DAY = 86_400_000;
const ic = { size: 16, strokeWidth: 1.75 };

export default function StudyHome({ refreshKey, onReview, onPractice }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    const since = new Date(Date.now() - 84 * DAY).toISOString();
    Promise.all([
      supabase.from("study_attempts").select("topic,correct,created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(3000),
      supabase.from("flashcards").select("box,due_at").limit(5000),
      supabase.from("conversations").select("updated_at").eq("mode_id", "study").gte("updated_at", since).limit(1000),
    ]).then(([a, c, v]) => {
      if (!alive) return;
      const atts = (a.data ?? []) as Attempt[];
      const cards = (c.data ?? []) as { box: number; due_at: string }[];
      const convs = (v.data ?? []) as { updated_at: string }[];
      const now = Date.now();
      const days = countByDay([...atts.map((x) => x.created_at), ...convs.map((x) => x.updated_at)]);
      const week = atts.filter((x) => new Date(x.created_at).getTime() >= now - 7 * DAY);
      const month = atts.filter((x) => new Date(x.created_at).getTime() >= now - 30 * DAY);
      setS({
        streak: streak(days),
        today: days.has(dayKey(new Date())),
        due: cards.filter((x) => new Date(x.due_at).getTime() <= now).length,
        mastered: cards.filter((x) => x.box >= 3).length,
        cards: cards.length,
        acc7: week.length ? Math.round((week.filter((x) => x.correct).length / week.length) * 100) : null,
        weak: weakSpots(month),
        days,
        empty: !atts.length && !cards.length && !convs.length,
      });
    });
    return () => { alive = false; };
  }, [supabase, refreshKey]);

  const cols = useMemo(() => (s ? heatmap(s.days) : []), [s]);

  if (!s) return <section className="study-home loading" aria-busy="true"><div className="sh-skel" /><div className="sh-skel" /><div className="sh-skel" /><div className="sh-skel" /></section>;

  if (s.empty)
    return (
      <section className="study-home empty">
        <Flame {...ic} />
        <p>Take a quiz or make flashcards. Your <b>streak</b>, <b>weak spots</b> and <b>reviews</b> show up here.</p>
      </section>
    );

  return (
    <section className="study-home">
      <div className="sh-stats">
        <div className={`sh-stat streak ${s.today ? "lit" : ""}`} title={s.today ? "Studied today" : "Study today to keep it going"}>
          <Flame {...ic} /><b>{s.streak}</b><span>day streak</span>
        </div>
        <div className="sh-stat"><Layers {...ic} /><b>{s.due}</b><span>cards due</span></div>
        <div className="sh-stat"><Target {...ic} /><b>{s.acc7 === null ? "–" : `${s.acc7}%`}</b><span>accuracy · 7 days</span></div>
        <div className="sh-stat"><Trophy {...ic} /><b>{s.mastered}</b><span>of {s.cards} mastered</span></div>
      </div>

      {s.due > 0 && (
        <button type="button" className="sh-review" onClick={onReview}>
          <span>Review {s.due} card{s.due > 1 ? "s" : ""}<em>about {Math.max(1, Math.ceil(s.due * 0.15))} min</em></span>
          <ArrowRight size={16} strokeWidth={2} />
        </button>
      )}

      {s.weak.length > 0 && (
        <div className="sh-weak">
          <small>Weak spots</small>
          {s.weak.map((w) => (
            <button key={w.topic} type="button" onClick={() => onPractice(w.topic)}>
              <span className="sh-bar"><i style={{ width: `${Math.max(6, w.pct)}%` }} /></span>
              <b>{w.topic}</b>
              <em>{w.right}/{w.total} right</em>
              <span className="sh-go">Practice <ArrowRight size={13} strokeWidth={2} /></span>
            </button>
          ))}
        </div>
      )}

      <div className="sh-heat">
        <small>Last 12 weeks</small>
        <div className="heat-grid" role="img" aria-label="Study activity heatmap">
          {cols.map((col, i) => (
            <div key={i} className="heat-col">
              {col.map((c) => (
                <i key={c.key} className={c.future ? "future" : `h${heatLevel(c.count)}`}
                   title={c.future ? "" : `${c.label}: ${c.count ? `${c.count} activit${c.count > 1 ? "ies" : "y"}` : "no study"}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
