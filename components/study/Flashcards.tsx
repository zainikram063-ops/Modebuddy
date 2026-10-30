"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Layers, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { InlineMd } from "../Markdown";

type Card = { id: string; front: string; back: string };
export type DeckData = { ok?: boolean; error?: string; title: string; deckId: string | null; cards: Card[] };
type CardState = { box: number; lapses: number; reps: number };

/* days until a card comes back, by box (Leitner-style) */
const DAYS = [0, 1, 3, 7, 16, 35];

export default function Flashcards({ data }: { data: DeckData }) {
  const cards = data.cards ?? [];
  const supabase = useMemo(() => createClient(), []);
  const [queue, setQueue] = useState<number[]>(() => cards.map((_, k) => k));
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [state, setState] = useState<Record<string, CardState>>({});

  useEffect(() => {
    if (!data.deckId) return;
    supabase.from("flashcards").select("id,box,lapses,reps").eq("deck_id", data.deckId).then(({ data: rows }) => {
      if (rows) setState(Object.fromEntries(rows.map((r) => [r.id as string, { box: r.box, lapses: r.lapses, reps: r.reps }])));
    });
  }, [data.deckId, supabase]);

  if (!cards.length) return null;

  const cur = queue[0];
  const card = cur !== undefined ? cards[cur] : null;
  const doneCount = cards.length - new Set(queue).size;

  const grade = (good: boolean) => {
    if (cur === undefined || !card) return;
    setFlipped(false);
    if (!good) setMissed((s) => new Set(s).add(cur));
    setQueue((q) => (good ? q.slice(1) : [...q.slice(1), cur]));
    if (!data.deckId) return;
    const s = state[card.id] ?? { box: 0, lapses: 0, reps: 0 };
    const box = good ? Math.min(s.box + 1, DAYS.length - 1) : 0;
    const due = new Date(Date.now() + (good ? DAYS[box] * 86_400_000 : 10 * 60_000)).toISOString();
    const next = { box, lapses: s.lapses + (good ? 0 : 1), reps: s.reps + 1 };
    setState((st) => ({ ...st, [card.id]: next }));
    supabase.from("flashcards").update({ ...next, due_at: due }).eq("id", card.id).then(() => {});
    supabase.from("study_attempts").insert({ kind: "flashcard", topic: data.title, question: card.front, correct: good }).then(() => {});
  };

  const restart = () => { setQueue(cards.map((_, k) => k)); setMissed(new Set()); setFlipped(false); };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " && e.target === e.currentTarget) { e.preventDefault(); setFlipped((f) => !f); }
    else if (flipped && e.key === "1") grade(false);
    else if (flipped && e.key === "2") grade(true);
  };

  return (
    <div className="deck" tabIndex={0} onKeyDown={onKey}>
      <header className="quiz-head">
        <Layers size={15} strokeWidth={1.75} />
        <b>{data.title}</b>
        <span className="deck-count">{doneCount}/{cards.length}</span>
      </header>

      {card ? (
        <>
          <button type="button" className={`flash ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((f) => !f)}
                  aria-label={flipped ? "Show front" : "Show answer"}>
            <span className="flash-inner">
              <span className="flash-face front"><small>Front</small><InlineMd text={card.front} /><em>Tap to flip · Space</em></span>
              <span className="flash-face back"><small>Back</small><InlineMd text={card.back} /></span>
            </span>
          </button>
          <div className={`deck-actions ${flipped ? "show" : ""}`}>
            <button type="button" className="again" onClick={() => grade(false)} disabled={!flipped}>Again <kbd>1</kbd></button>
            <button type="button" className="got" onClick={() => grade(true)} disabled={!flipped}>Got it <kbd>2</kbd></button>
          </div>
          <div className="deck-progress"><i style={{ width: `${(doneCount / cards.length) * 100}%` }} /></div>
        </>
      ) : (
        <div className="deck-end">
          <p className="quiz-verdict">Deck done. {cards.length - missed.size}/{cards.length} on the first try.</p>
          <p className="deck-note">{data.deckId ? "Saved. Cards come back right before you'd forget them." : "Practice deck (not saved)."}</p>
          <div className="quiz-actions"><button type="button" onClick={restart}><RotateCcw size={13} strokeWidth={2} /> Study again</button></div>
        </div>
      )}
    </div>
  );
}
