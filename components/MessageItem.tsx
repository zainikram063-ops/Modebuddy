"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState, type CSSProperties } from "react";
import type { Message } from "ai";
import { CalendarCheck, ClipboardList, Globe, Layers, ListChecks, Shuffle } from "lucide-react";
import Markdown from "./Markdown";
import { Icon } from "./Icons";
import { SpeakButton } from "./Voice";
import Quiz, { type QuizData } from "./study/Quiz";
import Flashcards, { type DeckData } from "./study/Flashcards";
import Exam, { type ExamData } from "./study/Exam";
import Plan, { type PlanData } from "./study/Plan";
import Mermaid from "./study/Mermaid";

type Part = NonNullable<Message["parts"]>[number];
type ToolInv = { state: "partial-call" | "call" | "result"; toolCallId: string; toolName: string; args?: unknown; result?: unknown };
type McpContent = { type: string; text?: string; data?: string; mimeType?: string };
type WebResult = { n: number; title: string; url: string; snippet?: string; date?: string | null };

const FILE_RE = /<file name="([^"]+)">[\s\S]*?<\/file>/g;
const CITE_RE = /\[\[?(\d+)\]?\]\((https?:\/\/[^)\s]+)\)/g;
export const FOLLOW_RE = /<followups>([\s\S]*?)(?:<\/followups>|$)/i;
const stripFollow = (t: string) => t.replace(/\n*<followups>[\s\S]*$/i, "").replace(/<[a-z]{0,9}$/i, "").trimEnd();

/* ---------- diagram detection ---------- */
const KINDS = "graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|timeline|mindmap|gitGraph|quadrantChart";
const KIND_RE = new RegExp(`^\\s*(?:%%[^\\n]*\\n\\s*)*(?:${KINDS})\\b`);
const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)(```|$)/g;
const BARE_RE = /(^|\n)((?:graph|flowchart)[ \t]+(?:TD|TB|LR|RL|BT)\b[^\n]*(?:\n[ \t]*\S[^\n]*)+)/;

type Seg = { kind: "text"; text: string } | { kind: "diagram"; code: string; done: boolean };

function splitDiagrams(text: string): Seg[] {
  const segs: Seg[] = [];
  let last = 0;
  for (const m of text.matchAll(FENCE_RE)) {
    const lang = m[1].trim();
    const body = m[2];
    const isDiagram =
      lang.toLowerCase() === "mermaid" ||
      (KIND_RE.test(lang) && !!body.trim()) ||
      (lang === "" && KIND_RE.test(body));
    if (!isDiagram) continue;
    const idx = m.index ?? 0;
    if (idx > last) segs.push({ kind: "text", text: text.slice(last, idx) });
    const code = KIND_RE.test(lang) && lang.toLowerCase() !== "mermaid" ? `${lang}\n${body}` : body;
    segs.push({ kind: "diagram", code: code.trim(), done: !!m[3] });
    last = idx + m[0].length;
  }
  if (last < text.length) segs.push({ kind: "text", text: text.slice(last) });

  /* diagram code written without a code block */
  const out: Seg[] = [];
  for (const s of segs) {
    if (s.kind !== "text" || s.text.includes("```")) { out.push(s); continue; }
    const m = s.text.match(BARE_RE);
    if (!m || m.index === undefined) { out.push(s); continue; }
    const start = m.index + m[1].length;
    out.push({ kind: "text", text: s.text.slice(0, start) });
    out.push({ kind: "diagram", code: m[2].trim(), done: true });
    out.push({ kind: "text", text: s.text.slice(start + m[2].length) });
  }
  return out;
}

const pretty = (v: unknown) => {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    return s.length > 6000 ? s.slice(0, 6000) + "\n…" : s;
  } catch { return String(v); }
};
const mcpContent = (r: unknown) => (r as { content?: McpContent[] })?.content;
const imagesFrom = (r: unknown) =>
  (mcpContent(r) ?? []).filter((c) => c.type === "image" && c.data).map((c) => `data:${c.mimeType ?? "image/png"};base64,${c.data}`);
const withoutImages = (r: unknown) => {
  const c = mcpContent(r);
  return Array.isArray(c) ? { ...(r as object), content: c.map((x) => (x.type === "image" ? { type: "image", mimeType: x.mimeType, data: "[image]" } : x)) } : r;
};
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/* ---------- Teach-it-back grade card ---------- */
const GRADE_RE = /<grade\s+score="?(\d+(?:\.\d+)?)"?\s*>([\s\S]*?)(<\/grade>|$)/i;

function GradeCard({ score, body, done }: { score: number; body: string; done: boolean }) {
  const s = Math.max(0, Math.min(10, Number.isFinite(score) ? score : 0));
  const rows = body.split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean)
    .map((l) => { const i = l.indexOf(":"); return i > 0 && i < 20 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : ["", l]; });
  return (
    <div className={`grade-card ${done ? "" : "loading"}`}>
      <div className="grade-score" style={{ "--p": `${done ? s * 10 : 0}%` } as CSSProperties}>
        <b>{done ? s : "…"}</b><small>/10</small>
      </div>
      <div className="grade-rows">
        {rows.map(([k, v], i) => (
          <div key={i} className={`grade-row ${k.toLowerCase()}`}>{k && <span>{k}</span>}<p>{v}</p></div>
        ))}
      </div>
    </div>
  );
}

function GradeText({ text }: { text: string }) {
  const clean = text.replace(/<grade[^>]*$/i, "");
  if (!clean.trim()) return null;
  const m = clean.match(GRADE_RE);
  if (!m || m.index === undefined) return <Markdown text={clean} />;
  const before = clean.slice(0, m.index).trim();
  const after = clean.slice(m.index + m[0].length).trim();
  return (
    <>
      {before && <Markdown text={before} />}
      <GradeCard score={Number(m[1])} body={m[2]} done={!!m[3]} />
      {after && <Markdown text={after} />}
    </>
  );
}

/** Text with diagrams and grade cards pulled out */
function TextBlock({ text }: { text: string }) {
  return (
    <>
      {splitDiagrams(text).map((s, i) =>
        s.kind === "text" ? (
          <GradeText key={i} text={s.text} />
        ) : s.done ? (
          <Mermaid key={i} code={s.code} />
        ) : (
          <div key={i} className="diagram-loading">Drawing diagram…</div>
        )
      )}
    </>
  );
}

/* ---------- Web search source cards ---------- */
function WebCard({ inv, cites }: { inv: ToolInv; cites: Map<string, string> }) {
  const query = (inv.args as { query?: string })?.query ?? "";
  if (inv.state !== "result")
    return (
      <div className="web-card searching">
        <Globe size={14} strokeWidth={1.75} /> Searching{query && <>: <em>{query}</em></>}…
      </div>
    );

  const r = inv.result as { ok?: boolean; error?: string; results?: WebResult[] };
  if (!r?.ok) return <div className="web-card err"><Globe size={14} strokeWidth={1.75} /> Search failed{r?.error ? ` · ${r.error}` : ""}</div>;
  const results = r.results ?? [];

  return (
    <div className="web-card">
      <div className="web-head">
        <Globe size={14} strokeWidth={1.75} /> Searched <em>{query}</em> · {results.length} sources
      </div>
      <div className="web-sources">
        {results.map((s, i) => {
          const n = cites.get(s.url);
          return (
            <a key={s.url} className={`src-card ${n ? "cited" : ""}`} href={s.url} target="_blank" rel="noreferrer"
               title={s.title} style={{ animationDelay: `${i * 60}ms` }}>
              {n && <span className="src-n">{n}</span>}
              <img src={`https://www.google.com/s2/favicons?domain=${host(s.url)}&sz=64`} alt="" />
              <span className="src-meta"><b>{s.title}</b><small>{host(s.url)}</small></span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Study practice cards ---------- */
const PRACTICE_META: Record<string, { icon: JSX.Element; loading: string }> = {
  create_quiz: { icon: <ListChecks size={14} strokeWidth={1.75} />, loading: "Writing your quiz" },
  create_flashcards: { icon: <Layers size={14} strokeWidth={1.75} />, loading: "Making your flashcards" },
  create_exam: { icon: <ClipboardList size={14} strokeWidth={1.75} />, loading: "Setting your mock exam" },
  create_plan: { icon: <CalendarCheck size={14} strokeWidth={1.75} />, loading: "Planning your days" },
};

function PracticeCard({ inv, onSend }: { inv: ToolInv; onSend?: (t: string) => void }) {
  const meta = PRACTICE_META[inv.toolName];
  if (inv.state !== "result") return <div className="web-card searching">{meta.icon} {meta.loading}…</div>;
  const r = inv.result as { ok?: boolean; error?: string };
  if (!r?.ok) return <div className="web-card err">{meta.icon} Couldn&apos;t create it{r?.error ? ` · ${r.error}` : ""}</div>;
  if (inv.toolName === "create_quiz") return <Quiz id={inv.toolCallId} data={r as QuizData} onSend={onSend} />;
  if (inv.toolName === "create_flashcards") return <Flashcards data={r as DeckData} />;
  if (inv.toolName === "create_plan") return <Plan data={r as PlanData} />;
  return <Exam id={inv.toolCallId} data={r as ExamData} onSend={onSend} />;
}

function ToolCard({ inv, cites, onSend }: { inv: ToolInv; cites: Map<string, string>; onSend?: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const done = inv.state === "result";

  if (inv.toolName === "web_search") return <WebCard inv={inv} cites={cites} />;
  if (PRACTICE_META[inv.toolName]) return <PracticeCard inv={inv} onSend={onSend} />;
  if (inv.toolName === "suggest_mode") {
    const r = inv.result as { ok?: boolean; name?: string } | undefined;
    return done && r?.ok ? <div className="mem-pill"><Shuffle size={14} strokeWidth={1.75} />Switching to {r.name}</div> : null;
  }
  if (inv.toolName === "save_memory")
    return <div className="mem-pill"><Icon name="brain" size={14} />{done ? "Saved to memory" : "Remembering…"}<em>{(inv.args as { content?: string })?.content}</em></div>;
  if (inv.toolName === "forget_memory")
    return <div className="mem-pill"><Icon name="brain" size={14} />{done ? "Forgot that" : "Forgetting…"}</div>;

  const [conn, ...rest] = inv.toolName.split("__");
  const toolName = rest.join("__") || conn;
  const imgs = done ? imagesFrom(inv.result) : [];

  return (
    <div className={`tool-card ${done ? "done" : ""}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="tool-dot" />
        {rest.length > 0 && <><b>{conn.replace(/_/g, " ")}</b><span>·</span></>}
        <code>{toolName}</code>
        <span className="tool-state">{done ? "done" : "running…"}</span>
        <Icon name="chevron" size={12} />
      </button>
      {imgs.map((src, i) => <img key={i} className="tool-img" src={src} alt="Tool result" />)}
      {open && (
        <div className="tool-body">
          <div><small>Input</small><pre>{pretty(inv.args)}</pre></div>
          {done && <div><small>Output</small><pre>{pretty(withoutImages(inv.result))}</pre></div>}
        </div>
      )}
    </div>
  );
}

type Props = {
  m: Message; isLast: boolean; busy: boolean;
  onEdit: (text: string) => void; onRegenerate: () => void; onSend?: (text: string) => void;
};

export default function MessageItem({ m, isLast, busy, onEdit, onRegenerate, onSend }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const textAll = stripFollow((m.parts?.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n") || m.content).replace(FILE_RE, "")).replace(/<\/?grade[^>]*>/gi, "").trim();
  const cites = useMemo(() => {
    const map = new Map<string, string>();
    for (const x of textAll.matchAll(CITE_RE)) if (!map.has(x[2])) map.set(x[2], x[1]);
    return map;
  }, [textAll]);

  const copy = async () => { await navigator.clipboard.writeText(textAll); setCopied(true); setTimeout(() => setCopied(false), 1200); };

  /* ---------- user ---------- */
  if (m.role === "user") {
    const atts = m.experimental_attachments ?? [];
    const files = [...m.content.matchAll(FILE_RE)].map((x) => x[1]);
    const fileBlocks = m.content.match(FILE_RE) ?? [];
    const visible = m.content.replace(FILE_RE, "").trim();

    return (
      <article className="msg user">
        {(atts.length > 0 || files.length > 0) && (
          <div className="att-row">
            {atts.map((a, i) =>
              a.contentType?.startsWith("image/") ? (
                <a key={i} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name ?? "attachment"} className="att-img" /></a>
              ) : (
                <a key={i} className="att-file" href={a.url} target="_blank" rel="noreferrer">{a.name ?? "file"}</a>
              )
            )}
            {files.map((f) => <span key={f} className="att-file">{f}</span>)}
          </div>
        )}
        {editing ? (
          <div className="edit-box">
            <textarea autoFocus rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div>
              <button className="btn-sm" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn-sm primary" onClick={() => { setEditing(false); if (draft.trim()) onEdit(draft.trim() + fileBlocks.map((b) => "\n\n" + b).join("")); }}>
                Save & send
              </button>
            </div>
          </div>
        ) : visible ? <div className="bubble">{visible}</div> : null}
        {!editing && (
          <div className="msg-actions">
            <button onClick={copy} title="Copy">{copied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}</button>
            {!busy && <button onClick={() => { setDraft(visible); setEditing(true); }} title="Edit"><Icon name="edit" size={14} /></button>}
          </div>
        )}
      </article>
    );
  }

  /* ---------- assistant ---------- */
  const parts = (m.parts?.length ? m.parts : [{ type: "text", text: m.content }]) as Part[];

  return (
    <article className="msg assistant">
      <div className="avatar" aria-hidden>⌥</div>
      <div className="answer">
        {parts.map((part, i) => {
          switch (part.type) {
            case "text": { const t = stripFollow(part.text); return t ? <TextBlock key={i} text={t} /> : null; }
            case "reasoning": return <details key={i} className="think"><summary>Thought process</summary><div>{part.reasoning}</div></details>;
            case "tool-invocation": return <ToolCard key={i} inv={part.toolInvocation as ToolInv} cites={cites} onSend={onSend} />;
            case "source": return <a key={i} className="source" href={part.source.url} target="_blank" rel="noreferrer">{part.source.title ?? part.source.url}</a>;
            case "file": return part.mimeType?.startsWith("image/") ? <img key={i} className="gen-img" src={`data:${part.mimeType};base64,${part.data}`} alt="Generated" /> : null;
            default: return null;
          }
        })}
        {!(busy && isLast) && textAll && (
          <div className="msg-actions">
            <button onClick={copy} title="Copy">{copied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}</button>
            <SpeakButton text={textAll} />
            {isLast && <button onClick={onRegenerate} title="Regenerate"><Icon name="refresh" size={14} /></button>}
          </div>
        )}
      </div>
    </article>
  );
}
