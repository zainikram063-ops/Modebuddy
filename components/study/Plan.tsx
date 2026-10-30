"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Task = { id: string; text: string; minutes: number };
type Day = { date: string; focus: string; tasks: Task[] };
export type PlanData = { ok?: boolean; error?: string; planId: string | null; title: string; examDate: string; days: Day[]; done?: string[] };

const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysUntil = (s: string) => Math.round((parse(s).getTime() - parse(todayKey()).getTime()) / 86_400_000);
const label = (s: string) => parse(s).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const countdown = (n: number) => (n > 1 ? `${n} days to exam` : n === 1 ? "Exam tomorrow" : n === 0 ? "Exam today" : "Exam passed");

function usePlanDone(planId: string | null, initial: string[] = []) {
  const supabase = useMemo(() => createClient(), []);
  const [done, setDone] = useState<Set<string>>(() => new Set(initial));

  useEffect(() => {
    if (!planId) return;
    supabase.from("study_plans").select("done").eq("id", planId).maybeSingle()
      .then(({ data }) => { if (data?.done) setDone(new Set(data.done as string[])); });
  }, [planId, supabase]);

  const toggle = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id); else next.add(id);
    setDone(next);
    if (planId) supabase.from("study_plans").update({ done: [...next] }).eq("id", planId).then(() => {});
  };
  return { done, toggle };
}

function TaskRow({ t, on, toggle }: { t: Task; on: boolean; toggle: (id: string) => void }) {
  return (
    <button type="button" className={`plan-task ${on ? "done" : ""}`} onClick={() => toggle(t.id)} aria-pressed={on}>
      <span className="plan-check">{on && <Check size={12} strokeWidth={3} />}</span>
      <span className="plan-text">{t.text}</span>
      <small>{t.minutes} min</small>
    </button>
  );
}

export default function Plan({ data }: { data: PlanData }) {
  const days = data.days ?? [];
  const { done, toggle } = usePlanDone(data.planId);
  const listRef = useRef<HTMLDivElement>(null);
  const tk = todayKey();
  const total = days.reduce((a, d) => a + d.tasks.length, 0);
  const pct = total ? Math.round((done.size / total) * 100) : 0;
  const left = data.examDate ? daysUntil(data.examDate) : null;

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(".plan-day.today");
    if (list && el) list.scrollTop = el.offsetTop - 8;
  }, []);

  if (!days.length) return null;

  return (
    <div className="plan-card">
      <header className="quiz-head">
        <CalendarCheck size={15} strokeWidth={1.75} />
        <b>{data.title}</b>
        {left !== null && <span className="plan-count">{countdown(left)}</span>}
      </header>
      <div className="plan-progress"><i style={{ width: `${pct}%` }} /></div>
      <p className="plan-meta">{done.size}/{total} tasks · {pct}%</p>
      <div className="plan-days" ref={listRef}>
        {days.map((d) => {
          const isToday = d.date === tk;
          const complete = d.tasks.every((t) => done.has(t.id));
          return (
            <section key={d.date} className={`plan-day ${isToday ? "today" : ""} ${d.date < tk ? "past" : ""} ${complete ? "complete" : ""}`}>
              <div className="plan-date">
                <b suppressHydrationWarning>{label(d.date)}</b>
                {isToday && <span className="plan-today">Today</span>}
                <em>{d.focus}</em>
              </div>
              {d.tasks.map((t) => <TaskRow key={t.id} t={t} on={done.has(t.id)} toggle={toggle} />)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function TodayPlan({ plan }: { plan: PlanData }) {
  const { done, toggle } = usePlanDone(plan.planId, plan.done);
  const today = plan.days.find((d) => d.date === todayKey());
  const left = plan.examDate ? daysUntil(plan.examDate) : null;
  if (!today) return null;
  return (
    <div className="sh-today">
      <small>Today · {plan.title}{left !== null && left >= 0 ? ` · ${countdown(left).toLowerCase()}` : ""}</small>
      <p className="sh-today-focus">{today.focus}</p>
      {today.tasks.map((t) => <TaskRow key={t.id} t={t} on={done.has(t.id)} toggle={toggle} />)}
    </div>
  );
}
