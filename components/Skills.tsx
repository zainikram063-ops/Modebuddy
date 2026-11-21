"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BUILTIN_SKILLS, MODE_LABEL, modeKind, mySkillId, type Skill, type SkillMode } from "@/lib/skills";

type Row = { id: string; name: string; icon: string; mode: SkillMode; when_to_use: string; instructions: string; enabled: boolean };

/* Line icons for skills */
const ICONS: Record<string, string[]> = {
  spark: ["M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"],
  mail: ["M3 6h18v12H3z", "M3 7l9 6 9-6"],
  chat: ["M4 5h16v11H9l-5 4z"],
  doc: ["M6 3h9l4 4v14H6z", "M14 3v5h5", "M9 13h6M9 17h6"],
  list: ["M9 6h11M9 12h11M9 18h11", "M4 6h1M4 12h1M4 18h1"],
  pin: ["M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z", "M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  bowl: ["M3 11h18a9 9 0 0 1-18 0z", "M9 7c0-1.5 1.5-1.5 1.5-3M14 7c0-1.5 1.5-1.5 1.5-3"],
  dumbbell: ["M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"],
  scale: ["M12 4v16M7 20h10M5 7h14", "M5 7l-3 6a3 3 0 0 0 6 0z", "M19 7l-3 6a3 3 0 0 0 6 0z"],
  wallet: ["M3 7h16a2 2 0 0 1 2 2v9H3z", "M3 7l12-3v3", "M16 13h2"],
  text: ["M4 6h16M4 10h16M4 14h10M4 18h7"],
  bulb: ["M9 18h6M10 21h4", "M12 3a6 6 0 0 0-3.8 10.6c.6.6.8 1.3.8 2.4h6c0-1.1.2-1.8.8-2.4A6 6 0 0 0 12 3z"],
  megaphone: ["M3 10v4l12 5V5z", "M15 9a3 3 0 0 1 0 6", "M6 15l1.5 5h3L9 15.5"],
  video: ["M3 6h18v12H3z", "M10 9.5l5 2.5-5 2.5z"],
  tag: ["M3 12V4h8l10 10-8 8z", "M7.5 8.5h.01"],
  globe: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3 12h18", "M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"],
  gift: ["M4 11h16v10H4zM3 7h18v4H3zM12 7v14", "M12 7C10 3 6.5 4 7.5 7M12 7c2-4 5.5-3 4.5 0"],
  talk: ["M3 5h12v8H7l-4 3z", "M9 16h8l4 3v-9h-3"],
  check: ["M4 6h10M4 12h10M4 18h6", "M15 17l2.5 2.5L22 15"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M16 16l5 5"],
  table: ["M3 5h18v14H3z", "M3 10h18M3 15h18M9 5v14"],
  layout: ["M3 4h18v16H3z", "M3 9h18M9 9v11"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0"],
  puzzle: ["M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4z"],
  bot: ["M5 8h14v11H5z", "M12 8V4M9.5 13h.01M14.5 13h.01", "M9 16.5h6"],
  terminal: ["M3 5h18v14H3z", "M7 10l3 2.5L7 15M13 15h4"],
  code: ["M8 7l-5 5 5 5M16 7l5 5-5 5", "M14 4l-4 16"],
  plug: ["M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z", "M12 17v4"],
  wand: ["M4 20L15 9", "M17 3v4M15 5h4M20 9v2M19 10h2"],
  game: ["M6 8h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 13H9l-1.6 1.8A3 3 0 0 1 2 13v-1a4 4 0 0 1 4-4z", "M7 10.5v3M5.5 12h3M16 11h.01M18 13h.01"],
  bug: ["M12 7a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0v-3a5 5 0 0 1 5-5z", "M12 7V4M3 12h4M17 12h4M4 19l3-2M20 19l-3-2M9 4l1.5 2M15 4l-1.5 2"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  flask: ["M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3", "M7 15h10"],
  refresh: ["M20 11a8 8 0 0 0-14.3-4.5L4 8M4 13a8 8 0 0 0 14.3 4.5L20 16", "M4 4v4h4M20 20v-4h-4"],
  book: ["M4 4.5A1.5 1.5 0 0 1 5.5 3H20v16H5.5A1.5 1.5 0 0 0 4 20.5z", "M8 7h8"],
  db: ["M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z", "M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"],
  hash: ["M9 3L7 21M17 3l-2 18M4 8.5h17M3 15.5h17"],
  branch: ["M6 3v12", "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 9a9 9 0 0 1-9 9"],
  cloud: ["M7 19a4.5 4.5 0 0 1-.8-8.9A6 6 0 0 1 17.7 9 5 5 0 0 1 17 19z"],
  gauge: ["M12 21a9 9 0 1 1 9-9", "M12 12l4-4", "M21 12h-2"],
  play: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M10 8.5l5.5 3.5-5.5 3.5z"],
  notes: ["M4 3h16v18H4z", "M9 3v18", "M12 8h5M12 12h5M12 16h3"],
  target: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 12h.01"],
  bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  pen: ["M4 20l4.5-1L19 8.5 15.5 5 5 15.5z", "M13.5 7l3.5 3.5"],
  calc: ["M5 3h14v18H5z", "M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"],
  atom: ["M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z", "M12 21c2.2 0 4-4 4-9s-1.8-9-4-9-4 4-4 9 1.8 9 4 9z", "M4.2 16.5c1.1 1.9 5.5 1.4 9.8-1.1s7-6 5.8-7.9-5.5-1.4-9.8 1.1-7 6-5.8 7.9z"],
  brain: ["M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h1V4z", "M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h-1V4z"],
  calendar: ["M4 5h16v16H4z", "M4 10h16M8 3v4M16 3v4"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  tree: ["M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4z", "M12 7v5M12 12H5v5M12 12h7v5"],
  mic: ["M9 3h6v10a3 3 0 0 1-6 0z", "M5 11a7 7 0 0 0 14 0M12 18v3"],
  key: ["M8 14a4 4 0 1 1 3.5-6H21v3h-2v3h-3v-3h-4.5A4 4 0 0 1 8 14z"],
};
export const ICON_NAMES = Object.keys(ICONS);
export function SkillIcon({ name, size = 18 }: { name: string; size?: number }) {
  const d = ICONS[name] || ICONS.spark;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

const OFF_KEY = "mb-skills-off";
const readOff = (): string[] => { try { return (localStorage.getItem(OFF_KEY) || "").split(",").filter(Boolean); } catch { return []; } };
const writeOff = (ids: string[]) => { try { localStorage.setItem(OFF_KEY, ids.join(",")); } catch { /* private mode */ } };
const toSkill = (r: Row): Skill => ({ id: mySkillId(r), name: r.name, icon: r.icon || "spark", mode: r.mode, when: r.when_to_use, instructions: r.instructions, mine: true });

/* Tells the server which built-in skills you switched off */
function installSkillsFetch() {
  const w = window as Window & { __mbSkillsFetch?: boolean };
  if (w.__mbSkillsFetch) return;
  w.__mbSkillsFetch = true;
  const base = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(raw, location.href);
      const off = readOff();
      if (u.origin === location.origin && u.pathname === "/api/chat" && off.length) {
        const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        h.set("x-mb-skills-off", off.join(","));
        init = { ...init, headers: h };
      }
    } catch { /* leave the request as it is */ }
    return base(input, init);
  }) as typeof window.fetch;
}
if (typeof window !== "undefined") installSkillsFetch();

/* The user's own skills, shared by the Skills page and the / picker */
let cache: Row[] | null = null;
let needsSetup = false;
const subs = new Set<() => void>();
async function loadMine() {
  try {
    const r = await fetch("/api/skills");
    const j = await r.json().catch(() => null);
    needsSetup = r.status === 503;
    cache = Array.isArray(j) ? (j as Row[]) : [];
  } catch {
    cache = cache ?? [];
  }
  subs.forEach((f) => f());
}
function useMine() {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    if (cache === null) void loadMine();
    return () => { subs.delete(f); };
  }, []);
  return { mine: cache ?? [], needsSetup };
}

/* Puts text in the chat box without sending it */
function fillComposer(text: string) {
  const box = Array.from(document.querySelectorAll("textarea")).filter((t) => t.offsetParent !== null).pop();
  if (!box) return;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  box.setSelectionRange(text.length, text.length);
}

/* The Skills button at the top of the sidebar */
export default function SkillsMenu({ onNew }: { onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const { mine } = useMine();
  return (
    <>
      <style>{SK_CSS}</style>
      <button type="button" className="sk-side" onClick={() => setOpen(true)}>
        <span className="sk-side-ic"><SkillIcon name="spark" size={13} /></span>Skills<span className="sk-count">{BUILTIN_SKILLS.length + mine.length}</span>
      </button>
      {open && createPortal(
        <SkillsPage onClose={() => setOpen(false)} onTry={(s) => { setOpen(false); onNew(); setTimeout(() => fillComposer("/" + s.id + " "), 200); }} />,
        document.body,
      )}
    </>
  );
}

const TABS: { id: "all" | SkillMode | "mine"; label: string }[] = [
  { id: "all", label: "All" }, { id: "buddy", label: "Buddy" }, { id: "kodra", label: "Kodra" }, { id: "edura", label: "Edura" }, { id: "mine", label: "Mine" },
];

function SkillsPage({ onClose, onTry }: { onClose: () => void; onTry: (s: Skill) => void }) {
  const { mine, needsSetup } = useMine();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [off, setOff] = useState<string[]>(() => readOff());
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Row | "new" | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !form) onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [form, onClose]);
  const rows = new Map(mine.map((r) => [mySkillId(r), r] as [string, Row]));
  const all = [...BUILTIN_SKILLS, ...mine.map(toSkill)];
  const ql = q.trim().toLowerCase();
  const shown = all.filter((s) =>
    (tab === "all" || (tab === "mine" ? !!s.mine : s.mode === tab || s.mode === "any")) &&
    (!ql || (s.name + " " + s.when + " " + s.id).toLowerCase().includes(ql)));
  const isOn = (s: Skill) => (s.mine ? rows.get(s.id)?.enabled !== false : !off.includes(s.id));
  const toggle = async (s: Skill) => {
    if (!s.mine) {
      const next = off.includes(s.id) ? off.filter((x) => x !== s.id) : [...off, s.id];
      setOff(next);
      writeOff(next);
      return;
    }
    const r = rows.get(s.id);
    if (!r) return;
    await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, enabled: r.enabled === false }) }).catch(() => null);
    void loadMine();
  };
  const remove = async (s: Skill) => {
    const r = rows.get(s.id);
    if (!r || !window.confirm("Delete the skill \"" + r.name + "\"?")) return;
    await fetch("/api/skills?id=" + encodeURIComponent(r.id), { method: "DELETE" }).catch(() => null);
    void loadMine();
  };
  return (
    <div className="sk-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sk-page" role="dialog" aria-label="Skills">
        <header className="sk-head">
          <div>
            <h2>Skills</h2>
            <p>ModeBuddy uses these on its own when they fit. Type <code>/</code> in the chat box to pick one yourself.</p>
          </div>
          <button type="button" className="sk-new" onClick={() => setForm("new")}>Create a skill</button>
          <button type="button" className="sk-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="sk-bar">
          <input className="sk-search" placeholder="Search skills" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="sk-tabs">
            {TABS.map((t) => <button key={t.id} type="button" className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}{t.id === "mine" && mine.length ? " " + mine.length : ""}</button>)}
          </div>
        </div>
        <div className="sk-grid">
          {shown.map((s) => {
            const on = isOn(s);
            return (
              <div key={s.id} className={"sk-card" + (on ? "" : " off")} data-mode={s.mode}>
                <div className="sk-card-top">
                  <span className="sk-ic"><SkillIcon name={s.icon} /></span>
                  <span className="sk-tag">{MODE_LABEL[s.mode]}</span>
                  <button type="button" role="switch" aria-checked={on} aria-label={(on ? "Turn off " : "Turn on ") + s.name} className={"sk-sw" + (on ? " on" : "")} onClick={() => void toggle(s)}><span /></button>
                </div>
                <button type="button" className="sk-name" onClick={() => setOpen(open === s.id ? null : s.id)}>{s.name}</button>
                <p className="sk-when">{s.when}</p>
                {open === s.id && <pre className="sk-instr">{s.instructions}</pre>}
                <div className="sk-foot">
                  <code>/{s.id}</code>
                  <span className="sk-gap" />
                  {s.mine && <button type="button" onClick={() => { const r = rows.get(s.id); if (r) setForm(r); }}>Edit</button>}
                  {s.mine && <button type="button" onClick={() => void remove(s)}>Delete</button>}
                  <button type="button" className="sk-try" onClick={() => onTry(s)}>Try it</button>
                </div>
              </div>
            );
          })}
          {!shown.length && (
            <div className="sk-empty">
              {tab === "mine" ? (needsSetup ? "Your own skills need a one-time setup on the server first." : "You haven't made a skill yet. Teach ModeBuddy something you do often.") : "No skills match that."}
              {tab === "mine" && !needsSetup && <button type="button" onClick={() => setForm("new")}>Create a skill</button>}
            </div>
          )}
        </div>
        {form && <SkillForm initial={form === "new" ? null : form} onClose={() => setForm(null)} />}
      </div>
    </div>
  );
}

function SkillForm({ initial, onClose }: { initial: Row | null; onClose: () => void }) {
  const [icon, setIcon] = useState(initial?.icon || "spark");
  const [name, setName] = useState(initial?.name || "");
  const [mode, setMode] = useState<SkillMode>(initial?.mode || "any");
  const [when, setWhen] = useState(initial?.when_to_use || "");
  const [text, setText] = useState(initial?.instructions || "");
  const [state, setState] = useState("");
  const ok = name.trim().length >= 2 && when.trim().length >= 5 && text.trim().length >= 10;
  const save = async () => {
    if (!ok) return;
    setState("saving");
    try {
      const r = await fetch("/api/skills", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: initial?.id, icon, name, mode, when_to_use: when, instructions: text, enabled: initial?.enabled !== false }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setState(j?.error === "setup" ? "Skills need a one-time setup on the server first." : j?.error || "Couldn't save that skill."); return; }
      await loadMine();
      onClose();
    } catch {
      setState("Couldn't save that skill.");
    }
  };
  return (
    <div className="sk-form-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sk-form" role="dialog" aria-label={initial ? "Edit skill" : "Create a skill"}>
        <h3>{initial ? "Edit skill" : "Create a skill"}</h3>
        <div className="sk-row">
          <label className="sk-f"><span>Name</span><input value={name} maxLength={60} placeholder="Physics lab report" onChange={(e) => setName(e.target.value)} /></label>
          <label className="sk-f sk-f-mode"><span>Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as SkillMode)}>
              <option value="any">Any mode</option><option value="buddy">Buddy</option><option value="kodra">Kodra</option><option value="edura">Edura</option>
            </select>
          </label>
        </div>
        <div className="sk-f"><span>Icon</span>
          <div className="sk-icons">
            {ICON_NAMES.map((n) => <button key={n} type="button" className={icon === n ? "on" : ""} onClick={() => setIcon(n)} aria-label={n} title={n}><SkillIcon name={n} size={16} /></button>)}
          </div>
        </div>
        <label className="sk-f"><span>When should ModeBuddy use it?</span>
          <textarea rows={2} maxLength={300} value={when} placeholder="When I ask for a lab report or write-up for a physics practical." onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="sk-f"><span>Instructions</span>
          <textarea rows={8} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"Tell ModeBuddy exactly how to do it, like you'd brief a smart friend.\nUse these sections: Aim, Apparatus, Method, Results table, Analysis, Conclusion. Simple words. Always include units."} />
        </label>
        {state && state !== "saving" && <p className="sk-err">{state}</p>}
        <div className="sk-form-btns">
          <button type="button" className="sk-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="sk-save" disabled={!ok || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving..." : "Save skill"}</button>
        </div>
      </div>
    </div>
  );
}

/* Type / at the start of the chat box to pick a skill */
export function SlashSkills({ modeId }: { modeId: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const { mine } = useMine();
  const [q, setQ] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const kind = modeKind(modeId);
  const list = useMemo(() => {
    if (q === null) return [] as Skill[];
    const off = new Set(readOff());
    const ql = q.toLowerCase();
    const fits = (s: Skill) => Number(s.mode === kind || s.mode === "any");
    return [...BUILTIN_SKILLS.filter((s) => !off.has(s.id)), ...mine.filter((r) => r.enabled !== false).map(toSkill)]
      .filter((s) => !ql || s.id.includes(ql) || s.name.toLowerCase().includes(ql))
      .sort((a, b) => fits(b) - fits(a))
      .slice(0, 8);
  }, [q, mine, kind]);
  const live = useRef({ list, sel });
  useEffect(() => { live.current = { list, sel }; });
  const chooseRef = useRef<(s: Skill) => void>(() => undefined);
  useEffect(() => {
    const ta = anchor.current?.closest("form")?.querySelector("textarea");
    if (!ta) return;
    const choose = (s: Skill) => {
      const text = "/" + s.id + " ";
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      setQ(null);
    };
    chooseRef.current = choose;
    const sync = () => {
      const m = /^\/([\w-]*)$/.exec(ta.value);
      setQ(m ? m[1] : null);
      setSel(0);
      const r = ta.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width });
    };
    const key = (e: KeyboardEvent) => {
      const { list: l, sel: i } = live.current;
      if (!l.length || !/^\/[\w-]*$/.test(ta.value)) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((i + (e.key === "ArrowDown" ? 1 : l.length - 1)) % l.length); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopImmediatePropagation(); choose(l[i] ?? l[0]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setQ(null); }
    };
    const blur = () => { setTimeout(() => setQ(null), 150); };
    ta.addEventListener("input", sync);
    ta.addEventListener("keydown", key, true);
    ta.addEventListener("blur", blur);
    return () => { ta.removeEventListener("input", sync); ta.removeEventListener("keydown", key, true); ta.removeEventListener("blur", blur); };
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {q !== null && list.length > 0 && rect && createPortal(
        <div className="sk-slash" style={{ left: rect.left, bottom: window.innerHeight - rect.top + 10, width: Math.min(rect.width, 440) }} role="listbox" aria-label="Skills">
          <style>{SK_CSS}</style>
          <div className="sk-slash-head">Skills</div>
          {list.map((s, i) => (
            <button key={s.id} type="button" role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} data-mode={s.mode}
              onMouseDown={(e) => { e.preventDefault(); chooseRef.current(s); }} onMouseEnter={() => setSel(i)}>
              <span className="sk-ic sm"><SkillIcon name={s.icon} size={15} /></span>
              <span className="sk-slash-txt"><b>{s.name}</b><small>/{s.id}</small></span>
              <span className="sk-tag">{MODE_LABEL[s.mode]}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const SK_CSS = [
  /* sidebar button */
  ".sk-side{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;margin:6px 0 2px;padding:9px 12px;border:1px solid var(--side-3);border-radius:12px;background:transparent;color:var(--side-ink);font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;text-align:left;transition:background .2s,border-color .2s}",
  ".sk-side:hover{background:var(--side-2);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}",
  ".sk-side-ic{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--accent);color:var(--on-accent)}",
  ".sk-count{margin-left:auto;font-size:11px;font-weight:500;color:var(--side-ink-2);font-family:var(--mono)}",
  /* page */
  ".sk-back{position:fixed;inset:0;z-index:9980;display:grid;place-items:center;padding:24px;background:rgba(6,6,5,.55);backdrop-filter:blur(8px)}",
  ".sk-page{position:relative;display:flex;flex-direction:column;width:min(1040px,100%);height:min(86vh,860px);border-radius:22px;background:var(--side);color:var(--side-ink);border:1px solid rgba(255,255,255,.08);box-shadow:0 30px 80px -20px rgba(0,0,0,.6);overflow:hidden;animation:skIn .2s ease-out}",
  ".sk-head{display:flex;align-items:flex-start;gap:12px;padding:22px 24px 14px}",
  ".sk-head>div{flex:1}",
  ".sk-head h2{margin:0;font-family:var(--display);font-size:24px;letter-spacing:-.02em}",
  ".sk-head p{margin:4px 0 0;color:var(--side-ink-2);font-size:13px}",
  ".sk-head code{padding:1px 6px;border-radius:5px;background:var(--side-2);font-family:var(--mono)}",
  ".sk-new{padding:9px 16px;border-radius:999px;border:0;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;font-size:13px;cursor:pointer;white-space:nowrap}",
  ".sk-x{width:34px;height:34px;flex:none;border-radius:50%;border:0;background:var(--side-2);color:var(--side-ink);font-size:20px;line-height:1;cursor:pointer}",
  ".sk-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:0 24px 14px;border-bottom:1px solid rgba(255,255,255,.06)}",
  ".sk-search{flex:1;min-width:200px;padding:9px 12px;border-radius:10px;border:1px solid var(--side-3);background:var(--side-2);color:var(--side-ink);font:inherit;font-size:13px;outline:none}",
  ".sk-search:focus{border-color:color-mix(in srgb,var(--accent) 50%,transparent)}",
  ".sk-tabs{display:flex;gap:4px;padding:3px;border-radius:999px;background:var(--side-2)}",
  ".sk-tabs button{padding:6px 12px;border-radius:999px;border:0;background:transparent;color:var(--side-ink-2);font:inherit;font-size:12.5px;cursor:pointer}",
  ".sk-tabs button.on{background:var(--side-3);color:var(--side-ink);font-weight:600}",
  ".sk-grid{flex:1;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;padding:16px 24px 24px;align-content:start}",
  ".sk-card{display:flex;flex-direction:column;gap:6px;padding:14px;border-radius:14px;background:var(--side-2);border:1px solid rgba(255,255,255,.05);transition:border-color .2s,transform .2s,opacity .2s}",
  ".sk-card:hover{border-color:rgba(255,255,255,.14);transform:translateY(-1px)}",
  ".sk-card.off{opacity:.5}",
  ".sk-card-top{display:flex;align-items:center;gap:8px}",
  ".sk-ic{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:10px;background:var(--side-3);color:var(--side-ink)}",
  ".sk-ic.sm{width:28px;height:28px;border-radius:8px}",
  "[data-mode=buddy] .sk-ic{color:#c4ff2e}",
  "[data-mode=kodra] .sk-ic{color:#7dd3fc}",
  "[data-mode=edura] .sk-ic{color:#fdba74}",
  "[data-mode=any] .sk-ic{color:#e4e4e7}",
  ".sk-tag{font-size:10px;font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:5px;background:var(--side-3);color:var(--side-ink-2);white-space:nowrap}",
  ".sk-sw{margin-left:auto;position:relative;flex:none;width:30px;height:18px;border-radius:999px;border:0;background:var(--side-3);cursor:pointer;transition:background .2s}",
  ".sk-sw span{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .2s}",
  ".sk-sw.on{background:var(--accent)}",
  ".sk-sw.on span{transform:translateX(12px);background:var(--on-accent)}",
  ".sk-name{all:unset;cursor:pointer;font-weight:600;font-size:14.5px;margin-top:4px}",
  ".sk-name:hover{text-decoration:underline}",
  ".sk-when{margin:0;font-size:12.5px;line-height:1.45;color:var(--side-ink-2);flex:1}",
  ".sk-instr{margin:4px 0 0;padding:10px;border-radius:10px;background:rgba(0,0,0,.25);font-family:var(--mono);font-size:11.5px;line-height:1.5;white-space:pre-wrap;color:var(--side-ink);max-height:220px;overflow:auto}",
  ".sk-foot{display:flex;align-items:center;gap:6px;margin-top:6px}",
  ".sk-foot code{font-family:var(--mono);font-size:11px;color:var(--side-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".sk-gap{flex:1}",
  ".sk-foot button{padding:5px 10px;border-radius:999px;border:1px solid var(--side-3);background:transparent;color:var(--side-ink);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}",
  ".sk-foot .sk-try{border-color:transparent;background:var(--accent);color:var(--on-accent);font-weight:600}",
  ".sk-empty{grid-column:1/-1;display:grid;justify-items:center;gap:12px;padding:48px 12px;color:var(--side-ink-2);text-align:center}",
  ".sk-empty button{padding:8px 16px;border-radius:999px;border:0;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;cursor:pointer}",
  /* create / edit */
  ".sk-form-back{position:absolute;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.45);animation:skFade .15s ease-out}",
  ".sk-form{width:min(580px,100%);max-height:100%;overflow:auto;box-sizing:border-box;padding:22px;border-radius:18px;background:var(--side-2);border:1px solid rgba(255,255,255,.08);box-shadow:0 20px 60px rgba(0,0,0,.5)}",
  ".sk-form h3{margin:0 0 14px;font-family:var(--display);font-size:18px}",
  ".sk-row{display:flex;gap:10px}",
  ".sk-f{display:flex;flex-direction:column;gap:5px;flex:1;margin-bottom:12px}",
  ".sk-f>span{font-size:12px;color:var(--side-ink-2)}",
  ".sk-f input,.sk-f textarea,.sk-f select{padding:9px 11px;border-radius:10px;border:1px solid var(--side-3);background:var(--side);color:var(--side-ink);font:inherit;font-size:13px;outline:none;resize:vertical}",
  ".sk-f textarea{line-height:1.5}",
  ".sk-f input:focus,.sk-f textarea:focus,.sk-f select:focus{border-color:color-mix(in srgb,var(--accent) 50%,transparent)}",
  ".sk-f-mode{flex:0 0 140px}",
  ".sk-icons{display:flex;flex-wrap:wrap;gap:4px;max-height:104px;overflow:auto;padding:6px;border-radius:10px;border:1px solid var(--side-3);background:var(--side)}",
  ".sk-icons button{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;border:0;background:transparent;color:var(--side-ink-2);cursor:pointer}",
  ".sk-icons button:hover{background:var(--side-2);color:var(--side-ink)}",
  ".sk-icons button.on{background:var(--accent);color:var(--on-accent)}",
  ".sk-err{margin:0 0 10px;color:#fca5a5;font-size:12.5px}",
  ".sk-form-btns{display:flex;justify-content:flex-end;gap:8px}",
  ".sk-ghost{padding:9px 16px;border-radius:999px;border:1px solid var(--side-3);background:transparent;color:var(--side-ink);font:inherit;cursor:pointer}",
  ".sk-save{padding:9px 18px;border-radius:999px;border:0;background:var(--accent);color:var(--on-accent);font:inherit;font-weight:600;cursor:pointer}",
  ".sk-save:disabled{opacity:.45;cursor:default}",
  /* the / picker */
  ".sk-slash{position:fixed;z-index:9985;padding:6px;box-sizing:border-box;border-radius:14px;background:var(--side);color:var(--side-ink);border:1px solid rgba(255,255,255,.08);box-shadow:0 18px 50px -10px rgba(0,0,0,.5);animation:skFade .12s ease-out}",
  ".sk-slash-head{padding:6px 10px 4px;font-size:10.5px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--side-ink-2)}",
  ".sk-slash button{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}",
  ".sk-slash button.on{background:var(--side-2)}",
  ".sk-slash-txt{flex:1;min-width:0;display:flex;flex-direction:column}",
  ".sk-slash-txt b{font-size:13px;font-weight:600}",
  ".sk-slash-txt small{font-family:var(--mono);font-size:11px;color:var(--side-ink-2)}",
  "@keyframes skIn{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}",
  "@keyframes skFade{from{opacity:0}to{opacity:1}}",
  "@media (max-width:640px){.sk-back{padding:0}.sk-page{height:100vh;border-radius:0}.sk-row{flex-wrap:wrap}}",
].join("");
