"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Flame } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  countByDay, dayKey, heatLevel, heatmap, streak, weakSpots,
  type Attempt, type HeatCell, type WeakSpot,
} from "@/lib/study-progress";
import { TodayPlan, type PlanData } from "./Plan";

type Stats = {
  streak: number; today: boolean; due: number; mastered: number; cards: number;
  acc7: number | null; focus7: number; weak: WeakSpot[]; days: Map<string, number>; plan: PlanData | null; empty: boolean;
};
type Props = { refreshKey: number; onReview: () => void; onPractice: (topic: string) => void };
type PlanRow = { id: string; title: string; exam_date: string | null; days: PlanData["days"]; done: string[] };

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
      supabase.from("focus_sessions").select("minutes,created_at").gte("created_at", since).limit(2000),
      supabase.from("study_plans").select("id,title,exam_date,days,done").order("created_at", { ascending: false }).limit(1),
    ]).then(([a, c, v, f, pl]) => {
      if (!alive) return;
      const atts = (a.data ?? []) as Attempt[];
      const cards = (c.data ?? []) as { box: number; due_at: string }[];
      const convs = (v.data ?? []) as { updated_at: string }[];
      const focus = (f.data ?? []) as { minutes: number; created_at: string }[];
      const p0 = ((pl.data ?? []) as PlanRow[])[0];
      const now = Date.now();
      const days = countByDay([
        ...atts.map((x) => x.created_at),
        ...convs.map((x) => x.updated_at),
        ...focus.map((x) => x.created_at),
      ]);
      const week = atts.filter((x) => new Date(x.created_at).getTime() >= now - 7 * DAY);
      const month = atts.filter((x) => new Date(x.created_at).getTime() >= now - 30 * DAY);
      setS({
        streak: streak(days),
        today: days.has(dayKey(new Date())),
        due: cards.filter((x) => new Date(x.due_at).getTime() <= now).length,
        mastered: cards.filter((x) => x.box >= 3).length,
        cards: cards.length,
        acc7: week.length ? Math.round((week.filter((x) => x.correct).length / week.length) * 100) : null,
        focus7: focus.filter((x) => new Date(x.created_at).getTime() >= now - 7 * DAY).reduce((t, x) => t + x.minutes, 0),
        weak: weakSpots(month),
        days,
        plan: p0 ? { planId: p0.id, title: p0.title, examDate: p0.exam_date ?? "", days: p0.days ?? [], done: p0.done ?? [] } : null,
        empty: !atts.length && !cards.length && !convs.length && !focus.length && !p0,
      });
    });
    return () => { alive = false; };
  }, [supabase, refreshKey]);

  const cols = useMemo<HeatCell[][]>(() => (s ? heatmap(s.days) : []), [s]);

  if (!s)
    return (
      <section className="study-home loading" aria-busy="true">
        <div className="sh-skel" /><div className="sh-skel" /><div className="sh-skel" /><div className="sh-skel" />
      </section>
    );

  if (s.empty)
    return (
      <section className="study-home empty">
        <Flame {...ic} />
        <p>Take a quiz, make flashcards or start a <b>Focus</b> session. Your <b>streak</b>, <b>weak spots</b> and <b>reviews</b> show up here.</p>
      </section>
    );

  return (
    <section className="study-home">

      {s.plan && <TodayPlan plan={s.plan} />}

      {s.due > 0 && (
        <button type="button" className="sh-review" onClick={onReview}>
          <span>Review {s.due} card{s.due > 1 ? "s" : ""}<em>about {Math.max(1, Math.ceil(s.due * 0.15))} min</em></span>
          <ArrowRight size={16} strokeWidth={2} />
        </button>
      )}

      {s.weak.length > 0 && (
        <div className="sh-weak">
          <small>Weak spots</small>
          {s.weak.map((w: WeakSpot) => (
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
          {cols.map((col: HeatCell[], i: number) => (
            <div key={i} className="heat-col">
              {col.map((c: HeatCell) => (
                <i
                  key={c.key}
                  className={c.future ? "future" : `h${heatLevel(c.count)}`}
                  title={c.future ? "" : `${c.label}: ${c.count ? `${c.count} activit${c.count > 1 ? "ies" : "y"}` : "no study"}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
