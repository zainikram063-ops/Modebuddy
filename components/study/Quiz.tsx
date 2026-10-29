"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, ListChecks, RotateCcw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Q = { q: string; options: string[]; answer: number; explain: string };
export type QuizData = { ok?: boolean; error?: string; title: string; questions: Q[] };

const verdict = (pct: number) =>
  pct === 100 ? "Perfect. You actually know this." :
  pct >= 80 ? "Nice. Nearly there." :
  pct >= 50 ? "Solid start. Let's fix the gaps." :
  "Good. Now we know exactly what to work on.";

export default function Quiz({ id, data, onSend }: { id: string; data: QuizData; onSend?: (t: string) => void }) {
  const qs = data.questions ?? [];
  const key = `mb-quiz-${id}`;
  const supabase = useMemo(() => createClient(), []);
  const [picks, setPicks] = useState<(number | null)[]>(() => qs.map(() => null));
  const [i, setI] = useState(0);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(s) && s.length === qs.length) {
        setPicks(s);
        const next = s.findIndex((x: number | null) => x === null);
        setI(next === -1 ? qs.length : next);
      }
    } catch {}
  }, [key, qs.length]);

  if (!qs.length) return null;

  const done = i >= qs.length;
  const q = qs[Math.min(i, qs.length - 1)];
  const chosen = done ? null : picks[i];
  const score = picks.filter((p, k) => p === qs[k].answer).length;
  const missed = qs.map((x, k) => ({ x, pick: picks[k] })).filter((m) => m.pick !== null && m.pick !== m.x.answer);

  const save = (next: (number | null)[]) => { setPicks(next); localStorage.setItem(key, JSON.stringify(next)); };

  const pick = (opt: number) => {
    if (picks[i] !== null) return;
    save(picks.map((p, k) => (k === i ? opt : p)));
    supabase.from("study_attempts").insert({ kind: "quiz", topic: data.title, question: qs[i].q, correct: opt === qs[i].answer }).then(() => {});
  };
  const reset = () => { save(qs.map(() => null)); setI(0); };

  const review = () => onSend?.(
    `I got ${score}/${qs.length} on the "${data.title}" quiz. I missed:\n` +
    missed.map(({ x, pick }) => `- ${x.q} (I said "${x.options[pick!]}", answer: "${x.options[x.answer]}")`).join("\n") +
    `\nExplain my mistakes briefly.`
  );
  const again = () => onSend?.(`Quiz me again on ${data.title}: 5 new questions${missed.length ? ", focusing on what I got wrong" : ", a bit harder"}.`);

  return (
    <div className="quiz-card">
      <header className="quiz-head">
        <ListChecks size={15} strokeWidth={1.75} />
        <b>{data.title}</b>
        <span className="quiz-dots">
          {qs.map((x, k) => (
            <i key={k} className={picks[k] === null ? (k === i ? "cur" : "") : picks[k] === x.answer ? "ok" : "bad"} />
          ))}
        </span>
      </header>

      {!done ? (
        <div className="quiz-body" key={i}>
          <small className="quiz-n">Question {i + 1} of {qs.length}</small>
          <p className="quiz-q">{q.q}</p>
          <div className="quiz-opts">
            {q.options.map((o, k) => {
              const state = chosen === null ? "" : k === q.answer ? "ok" : k === chosen ? "bad" : "dim";
              return (
                <button key={k} type="button" className={`quiz-opt ${state}`} onClick={() => pick(k)} disabled={chosen !== null}>
                  <span className="quiz-letter">{"ABCDE"[k]}</span>
                  <span>{o}</span>
                  {state === "ok" && <Check size={16} strokeWidth={2.25} />}
                  {state === "bad" && <X size={16} strokeWidth={2.25} />}
                </button>
              );
            })}
          </div>
          {chosen !== null && (
            <div className={`quiz-why ${chosen === q.answer ? "ok" : "bad"}`}>
              <b>{chosen === q.answer ? "Correct." : "Not quite."}</b>
              <span>{q.explain}</span>
              <button type="button" className="quiz-next" onClick={() => setI(i + 1)}>
                {i + 1 < qs.length ? "Next →" : "See score →"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="quiz-end">
          <div className="quiz-score" style={{ "--p": `${(score / qs.length) * 100}%` } as CSSProperties}>
            <b>{score}</b><small>/{qs.length}</small>
          </div>
          <div>
            <p className="quiz-verdict">{verdict(Math.round((score / qs.length) * 100))}</p>
            <div className="quiz-actions">
              {missed.length > 0 && onSend && <button type="button" className="primary" onClick={review}>Explain my mistakes</button>}
              {onSend && <button type="button" onClick={again}>New questions</button>}
              <button type="button" onClick={reset}><RotateCcw size={13} strokeWidth={2} /> Retry</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
