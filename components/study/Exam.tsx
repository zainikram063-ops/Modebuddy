"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { InlineMd } from "../Markdown";

type EQ = { q: string; type: "mcq" | "short"; options?: string[]; correct?: number; answer: string; marks: number };
export type ExamData = { ok?: boolean; error?: string; title: string; minutes: number; questions: EQ[] };
type Saved = { answers: string[]; startedAt: number | null; submittedAt: number | null };

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const isMcq = (q: EQ) => q.type === "mcq" && !!q.options?.length;

export default function Exam({ id, data, onSend }: { id: string; data: ExamData; onSend?: (t: string) => void }) {
  const qs = useMemo(() => data.questions ?? [], [data.questions]);
  const key = `mb-exam-${id}`;
  const supabase = useMemo(() => createClient(), []);
  const [saved, setSaved] = useState<Saved>({ answers: qs.map(() => ""), startedAt: null, submittedAt: null });
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(key) ?? "null"); if (s && Array.isArray(s.answers)) setSaved(s); } catch {}
  }, [key]);

  const persist = useCallback((s: Saved) => { setSaved(s); localStorage.setItem(key, JSON.stringify(s)); }, [key]);

  const limit = data.minutes * 60;
  const running = !!saved.startedAt && !saved.submittedAt;
  const elapsed = saved.startedAt ? Math.floor(((saved.submittedAt ?? now) - saved.startedAt) / 1000) : 0;
  const left = limit - elapsed;
  const totalMarks = qs.reduce((a, q) => a + q.marks, 0);
  const answered = saved.answers.filter((a) => a?.trim()).length;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const submit = useCallback((auto: boolean) => {
    if (!saved.startedAt || saved.submittedAt) return;
    const s: Saved = { ...saved, submittedAt: Date.now() };
    persist(s);
    setOpen(false);

    let mcqGot = 0, mcqTotal = 0;
    qs.forEach((q, k) => {
      if (!isMcq(q) || q.correct === undefined) return;
      const ok = s.answers[k] === String(q.correct);
      mcqTotal += q.marks;
      if (ok) mcqGot += q.marks;
      supabase.from("study_attempts").insert({ kind: "exam", topic: data.title, question: q.q, correct: ok }).then(() => {});
    });

    const used = Math.min(limit, Math.floor((s.submittedAt! - s.startedAt!) / 1000));
    const paper = qs.map((q, k) => {
      const a = s.answers[k] ?? "";
      const given = isMcq(q) ? (a !== "" ? q.options![Number(a)] : "") : a;
      return [
        `Q${k + 1} [${q.marks} mark${q.marks > 1 ? "s" : ""}] (${isMcq(q) ? "multiple choice" : "written"})`,
        `Question: ${q.q}`,
        isMcq(q) ? `Options: ${q.options!.map((o, j) => `${"ABCDE"[j]}) ${o}`).join(" | ")}` : "",
        `Student answer: ${given.trim() || "(blank)"}`,
        `Mark scheme: ${q.answer}`,
      ].filter(Boolean).join("\n");
    }).join("\n\n");

    onSend?.(
      `Mark my mock exam: ${data.title} · answered ${s.answers.filter((x) => x?.trim()).length}/${qs.length} in ${fmt(used)}` +
      `${auto ? " (time ran out)" : ""}${mcqTotal ? ` · multiple choice ${mcqGot}/${mcqTotal}` : ""}.` +
      `\n\n<file name="mock-exam-answers.txt">\n${paper}\n</file>`
    );
  }, [saved, persist, qs, supabase, data.title, limit, onSend]);

  useEffect(() => { if (running && left <= 0) submit(true); }, [running, left, submit]);

  const start = () => {
    if (!saved.startedAt) persist({ ...saved, startedAt: Date.now() });
    setNow(Date.now());
    setOpen(true);
  };
  const setAnswer = (k: number, v: string) => persist({ ...saved, answers: saved.answers.map((a, j) => (j === k ? v : a)) });
  const trySubmit = () => {
    const blank = qs.length - answered;
    if (blank > 0 && !confirm(`${blank} question${blank > 1 ? "s" : ""} unanswered. Submit anyway?`)) return;
    submit(false);
  };

  if (!qs.length) return null;

  return (
    <>
      <div className="exam-card">
        <div className="exam-icon"><ClipboardList size={20} strokeWidth={1.75} /></div>
        <div className="exam-info">
          <b>{data.title}</b>
          <span>{qs.length} questions · {totalMarks} marks · {data.minutes} min</span>
          {saved.submittedAt && <span className="exam-done">Submitted · {answered}/{qs.length} answered in {fmt(Math.min(limit, elapsed))}</span>}
        </div>
        {!saved.submittedAt && (
          <button type="button" className="exam-start" onClick={start}>{running ? `Resume · ${fmt(left)}` : "Start exam"}</button>
        )}
      </div>

      {open && running && typeof document !== "undefined" && createPortal(
        <div className="exam-overlay" role="dialog" aria-modal="true" aria-label={data.title}>
          <div className="exam-paper">
            <header className="exam-top">
              <b>{data.title}</b>
              <span className={`exam-timer ${left <= 60 ? "low" : left <= 300 ? "warn" : ""}`}><Clock size={14} strokeWidth={2} /> {fmt(left)}</span>
              <span className="exam-prog">{answered}/{qs.length} answered</span>
              <span className="spacer" />
              <button type="button" className="exam-hide" onClick={() => setOpen(false)} title="The timer keeps running">Hide</button>
              <button type="button" className="exam-submit" onClick={trySubmit}>Submit</button>
              <div className="exam-time-bar"><i style={{ width: `${(Math.max(0, left) / limit) * 100}%` }} /></div>
            </header>
            <ol className="exam-qs">
              {qs.map((q, k) => (
                <li key={k} className={saved.answers[k]?.trim() ? "answered" : ""}>
                  <div className="exam-q"><span><InlineMd text={q.q} /></span><em>[{q.marks} mark{q.marks > 1 ? "s" : ""}]</em></div>
                  {isMcq(q) ? (
                    <div className="quiz-opts">
                      {q.options!.map((o, j) => (
                        <button key={j} type="button" className={`quiz-opt ${saved.answers[k] === String(j) ? "picked" : ""}`} onClick={() => setAnswer(k, String(j))}>
                          <span className="quiz-letter">{"ABCDE"[j]}</span><span><InlineMd text={o} /></span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <textarea rows={3} value={saved.answers[k] ?? ""} placeholder="Your answer…" onChange={(e) => setAnswer(k, e.target.value)} />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
