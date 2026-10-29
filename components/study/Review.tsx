"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Layers, RotateCcw, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { relTime, schedule, type CardState } from "@/lib/progress";

type Due = { id: string; front: string; back: string; deck: string } & CardState;

export default function Review({ onClose }: { onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [cards, setCards] = useState<Due[] | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [mem, setMem] = useState<Record<string, CardState>>({});
  const [next, setNext] = useState<string | null>(null);

  const load = useCallback(() => {
    setCards(null); setMissed(new Set()); setMem({}); setNext(null); setFlipped(false);
    supabase
      .from("flashcards")
      .select("id,front,back,box,lapses,reps,flashcard_decks(title)")
      .lte("due_at", new Date().toISOString())
      .order("due_at")
      .limit(50)
      .then(({ data }) => {
        const list: Due[] = (data ?? []).map((r) => ({
          id: r.id, front: r.front, back: r.back, box: r.box, lapses: r.lapses, reps: r.reps,
          deck: ((r.flashcard_decks as unknown) as { title?: string } | null)?.title ?? "",
        }));
        setCards(list);
        setQueue(list.map((_, i) => i));
      });
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const total = cards?.length ?? 0;
  const done = cards ? total - new Set(queue).size : 0;
  const cur = queue[0];
  const card = cards && cur !== undefined ? cards[cur] : null;
  const finished = !!cards && total > 0 && !card;

  useEffect(() => {
    if (!finished && !(cards && !total)) return;
    supabase.from("flashcards").select("due_at").gt("due_at", new Date().toISOString()).order("due_at").limit(1)
      .then(({ data }) => setNext(data?.[0]?.due_at ?? null));
  }, [finished, cards, total, supabase]);

  const grade = useCallback((good: boolean) => {
    if (!card || cur === undefined) return;
    const st = mem[card.id] ?? { box: card.box, lapses: card.lapses, reps: card.reps };
    const n = schedule(st, good);
    setMem((m) => ({ ...m, [card.id]: { box: n.box, lapses: n.lapses, reps: n.reps } }));
    supabase.from("flashcards").update(n).eq("id", card.id).then(() => {});
    supabase.from("study_attempts").insert({ kind: "flashcard", topic: card.deck || null, question: card.front, correct: good }).then(() => {});
    setFlipped(false);
    if (!good) setMissed((s) => new Set(s).add(cur));
    setQueue((q) => (good ? q.slice(1) : [...q.slice(1), cur]));
  }, [card, cur, mem, supabase]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (!card) return;
      if (e.key === " ") {
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault(); setFlipped((f) => !f);
      } else if (flipped && e.key === "1") grade(false);
      else if (flipped && e.key === "2") grade(true);
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [card, flipped, grade, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="review-overlay" role="dialog" aria-modal="true" aria-label="Flashcard review">
      <div className="review-wrap">
        <header className="review-top">
          <Layers size={16} strokeWidth={1.75} />
          <b>Review</b>
          {total > 0 && <span className="review-count">{done}/{total}</span>}
          <span className="spacer" />
          <button type="button" className="exam-hide" onClick={onClose}><X size={14} strokeWidth={2} /> Close</button>
        </header>
        <div className="deck-progress"><i style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>

        {!cards ? (
          <p className="review-msg">Loading your cards…</p>
        ) : !total ? (
          <div className="review-end">
            <p className="quiz-verdict">Nothing due. You&apos;re all caught up.</p>
            {next && <p className="deck-note">Next card comes back {relTime(next)}.</p>}
          </div>
        ) : card ? (
          <div className="review-card">
            {card.deck && <span className="review-deck">{card.deck}</span>}
            <button type="button" className={`flash ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((f) => !f)}
                    aria-label={flipped ? "Show front" : "Show answer"}>
              <span className="flash-inner">
                <span className="flash-face front"><small>Front</small>{card.front}<em>Tap to flip · Space</em></span>
                <span className="flash-face back"><small>Back</small>{card.back}</span>
              </span>
            </button>
            <div className={`deck-actions ${flipped ? "show" : ""}`}>
              <button type="button" className="again" onClick={() => grade(false)} disabled={!flipped}>Again <kbd>1</kbd></button>
              <button type="button" className="got" onClick={() => grade(true)} disabled={!flipped}>Got it <kbd>2</kbd></button>
            </div>
          </div>
        ) : (
          <div className="review-end">
            <p className="quiz-verdict">Session done. {total - missed.size}/{total} on the first try.</p>
            <p className="deck-note">{next ? `Next card comes back ${relTime(next)}.` : "Every card is scheduled."}</p>
            <div className="quiz-actions">
              <button type="button" onClick={load}><RotateCcw size={13} strokeWidth={2} /> Check again</button>
              <button type="button" className="primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
