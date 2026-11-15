"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, FileText, Trash2, Upload, X } from "lucide-react";

type Doc = { id: string; title: string; chars: number; created_at: string };
const BUDGET = 60_000; // matches KNOWLEDGE_BUDGET in lib/persona.ts

export default function Material({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/study/material");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setDocs(j.docs);
    } catch (e) {
      toast((e as Error).message || "Couldn't load your material.");
      setDocs([]);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  const upload = async (list: FileList | File[]) => {
    for (const f of Array.from(list).slice(0, 10)) {
      setUploading((u) => [...u, f.name]);
      try {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/study/material", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) toast(j.error ?? `Couldn't add ${f.name}.`);
        else toast(j.truncated ? `Added ${j.title}. It's very long, so only the first part is used.` : `Added ${j.title}.`);
      } catch {
        toast(`Couldn't add ${f.name}.`);
      }
      setUploading((u) => u.filter((n) => n !== f.name));
    }
    load();
  };

  const remove = async (d: Doc) => {
    if (!confirm(`Remove "${d.title}" from your course material?`)) return;
    setDocs((x) => x?.filter((y) => y.id !== d.id) ?? null);
    await fetch(`/api/study/material?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
  };

  const total = docs?.reduce((a, d) => a + d.chars, 0) ?? 0;
  const pct = Math.min(100, Math.round((total / BUDGET) * 100));

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="mat-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mat-panel" role="dialog" aria-modal="true" aria-label="Course material">
        <header className="mat-head">
          <BookOpen size={18} strokeWidth={1.75} />
          <b>Course material</b>
          <button type="button" className="mat-x" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        </header>
        <p className="mat-sub">Edura reads these in every Edura chat, uses your course&apos;s terms and cites them by name.</p>

        <button
          type="button"
          className={`mat-drop ${drag ? "on" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
        >
          <Upload size={20} strokeWidth={1.75} />
          <b>Drop slides, notes or readings</b>
          <span>or click to choose · PDF, TXT, MD · up to 15 MB each</span>
        </button>
        <input ref={inputRef} type="file" multiple hidden accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.tex,application/pdf,text/*"
               onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />

        <div className="mat-list">
          {uploading.map((n) => (
            <div key={n} className="mat-doc busy"><span className="spin" /><span className="mat-title">{n}</span><small>Reading…</small></div>
          ))}
          {docs === null ? (
            <p className="mat-empty">Loading…</p>
          ) : !docs.length && !uploading.length ? (
            <p className="mat-empty">Nothing yet. Add your lecture slides or notes to get answers in your course&apos;s own words.</p>
          ) : (
            docs.map((d) => (
              <div key={d.id} className="mat-doc">
                <FileText size={16} strokeWidth={1.75} />
                <span className="mat-title" title={d.title}>{d.title}</span>
                <small>{d.chars >= 1000 ? `${Math.round(d.chars / 1000)}k chars` : `${d.chars} chars`}</small>
                <button type="button" onClick={() => remove(d)} aria-label={`Remove ${d.title}`}><Trash2 size={14} strokeWidth={1.75} /></button>
              </div>
            ))
          )}
        </div>

        {!!docs?.length && (
          <div className="mat-usage">
            <div className={`mat-bar ${total > BUDGET ? "over" : ""}`}><i style={{ width: `${pct}%` }} /></div>
            <small>
              {total > BUDGET
                ? `Over the limit: only the first ~${Math.round(BUDGET / 1000)}k characters are read per chat. Remove older docs to prioritise new ones.`
                : `${Math.round(total / 1000)}k of ~${Math.round(BUDGET / 1000)}k characters used per chat`}
            </small>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
