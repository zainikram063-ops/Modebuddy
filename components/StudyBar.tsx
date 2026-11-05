"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen, Brain, CalendarCheck, ChevronDown, ClipboardList, FileText, GraduationCap, Layers, Lightbulb, ListChecks, ListTree,
  Mic, Puzzle, ScrollText, SearchCheck, Table2, Timer,
} from "lucide-react";
import { STUDY_LEVELS, type StudySettings } from "@/lib/study";
import ModeIcon from "@/components/ModeIcon";

export type StudyToolAction = { text: string; prefill: string; prefillOnly?: boolean };
type Props = {
  value: StudySettings;
  onChange: (s: StudySettings) => void;
  onTool: (t: StudyToolAction) => void;
  onMaterial: () => void;
  onLecture: () => void;
};

const ic = { size: 15, strokeWidth: 1.75 };

const PRACTICE: { icon: JSX.Element; label: string; sub: string; action: StudyToolAction }[] = [
  { icon: <ListChecks {...ic} />, label: "Quiz me", sub: "5 clickable questions",
    action: { text: "Quiz me on this: 5 questions.", prefill: "Quiz me on: " } },
  { icon: <Layers {...ic} />, label: "Flashcards", sub: "Saved deck, flip to review",
    action: { text: "Make flashcards from this chat.", prefill: "Make flashcards on: " } },
  { icon: <ClipboardList {...ic} />, label: "Mock exam", sub: "Timed, then marked",
    action: { text: "Make a 20-minute mock exam on what we covered.", prefill: "Make a 20-minute mock exam on: " } },
  { icon: <CalendarCheck {...ic} />, label: "Study plan", sub: "Day by day, tick it off",
    action: { text: "Make me a study plan. Exam date and topics: ", prefill: "Make me a study plan. Exam date and topics: ", prefillOnly: true } },
  { icon: <SearchCheck {...ic} />, label: "Check my work", sub: "Finds the first mistake, then hints",
    action: { text: "Check my work:\n", prefill: "Check my work:\n", prefillOnly: true } },
  { icon: <GraduationCap {...ic} />, label: "Teach it back", sub: "You explain it, I grade you /10",
    action: { text: "Teach it back: ", prefill: "Teach it back: ", prefillOnly: true } },
];
const SUMMARIES = [
  { icon: <FileText {...ic} />, label: "One-page summary", kind: "a one-page summary" },
  { icon: <Table2 {...ic} />, label: "Key terms glossary", kind: "a glossary" },
  { icon: <ListTree {...ic} />, label: "Mind map", kind: "a mind map" },
  { icon: <ScrollText {...ic} />, label: "Exam cheat sheet", kind: "an exam cheat sheet" },
];
const ANALOGIES = [
  { label: "Things I like", use: "something you know I'm into" },
  { label: "Football", use: "football" },
  { label: "Cooking", use: "cooking" },
  { label: "Gaming", use: "gaming" },
  { label: "Music", use: "music" },
  { label: "Movies", use: "movies" },
];

export default function StudyBar({ value, onChange, onTool, onMaterial, onLecture }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<StudySettings>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);

  const run = (a: StudyToolAction) => { setOpen(false); onTool(a); };

  return (
    <div className={`study-bar ${value.examDay ? "exam" : ""}`}>
      <div className={`seg ${value.examDay ? "paused" : ""}`} role="radiogroup" aria-label="Teaching style"
           title={value.examDay ? "Paused on exam day" : undefined}>
        <button type="button" role="radio" aria-checked={value.style === "explain"} className={value.style === "explain" ? "on" : ""}
                onClick={() => set({ style: "explain" })}>
          <Lightbulb {...ic} /> Explain
        </button>
        <button type="button" role="radio" aria-checked={value.style === "socratic"} className={value.style === "socratic" ? "on" : ""}
                onClick={() => set({ style: "socratic" })}>
          <Brain {...ic} /> Make me think
        </button>
      </div>

      <div className="seg level" role="radiogroup" aria-label="Level">
        {STUDY_LEVELS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={value.level === l.id} title={l.title}
                  className={value.level === l.id ? "on" : ""} onClick={() => set({ level: l.id })}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="study-tools" ref={ref}>
        <button type="button" className={`sb-btn ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
          <Puzzle {...ic} /> Tools <ChevronDown size={13} strokeWidth={2} className="chev" />
        </button>
        {open && (
          <div className="study-menu" role="menu">
            <small>Practice</small>
            {PRACTICE.map((t) => (
              <button key={t.label} type="button" role="menuitem" onClick={() => run(t.action)}>
                <ModeIcon icon={t.icon} /><span><b>{t.label}</b><em>{t.sub}</em></span>
              </button>
            ))}

            <small>Your material</small>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onMaterial(); }}>
              <BookOpen {...ic} /><span><b>Course material</b><em>Slides &amp; notes Study mode cites</em></span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onLecture(); }}>
              <Mic {...ic} /><span><b>Lecture → notes</b><em>Recording to notes + flashcards</em></span>
            </button>

            <small>Summarize</small>
            {SUMMARIES.map((s) => (
              <button key={s.label} type="button" role="menuitem"
                      onClick={() => run({ text: `Summarize as ${s.kind}.`, prefill: `Summarize this as ${s.kind}:\n` })}>
                <ModeIcon icon={s.icon} /><span><b>{s.label}</b></span>
              </button>
            ))}

            <small>Analogy from</small>
            <div className="analogy-row">
              {ANALOGIES.map((a) => (
                <button key={a.label} type="button" role="menuitem"
                        onClick={() => run({ text: `Analogy, please. Use ${a.use}.`, prefill: `Explain this with an analogy from ${a.use}: ` })}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button type="button" className={`sb-btn exam-btn ${value.examDay ? "on" : ""}`} aria-pressed={value.examDay}
              onClick={() => set({ examDay: !value.examDay })} title="Short, confident revision answers">
        <Timer {...ic} /> Exam day
      </button>
    </div>
  );
}
