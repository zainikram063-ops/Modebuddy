"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as RPE } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, ExternalLink, FileCode2, Files, Image as ImageIcon, Printer, X } from "lucide-react";
import { useCanSend } from "@/lib/chat-bus";
import { closeArts, dropArt, editArt, newResponse, openArt, putArt, useArts } from "@/lib/artifacts";

export const isArtifact = (lang: string, raw: string) =>
  (lang === "html" && /<!doctype html|<html[\s>]/i.test(raw)) || (lang === "svg" && raw.length > 400 && /<svg[\s>]/i.test(raw));

const titleOf = (lang: string, raw: string) =>
  (/<title>([^<]{1,80})<\/title>/i.exec(raw)?.[1] ?? /<h1[^>]*>([^<]{1,80})</i.exec(raw)?.[1] ?? (lang === "svg" ? "Image" : "Web page")).trim();

const SANDBOX = "allow-scripts allow-modals allow-forms allow-popups";
const PRINT = `<script>addEventListener("message",function(e){if(e.data==="mb-print")print()})<\/script>`;
const buildDoc = (lang: string, code: string) => {
  const doc = lang === "svg" ? `<!doctype html><html><body style="margin:0;min-height:100vh;display:grid;place-items:center">${code}</body></html>` : code;
  return doc.includes("</body>") ? doc.replace("</body>", `${PRINT}</body>`) : doc + PRINT;
};

/* Card shown in the chat instead of the raw code */
export function ArtifactCard({ lang, raw }: { lang: string; raw: string }) {
  const id = useId();
  const busy = !useCanSend();
  const prev = useRef<string | null>(null);
  const title = titleOf(lang, raw);
  const { open, active } = useArts();

  useEffect(() => {
    const changed = prev.current !== raw;
    prev.current = raw;
    putArt({ id, lang, title, code: raw }, busy && changed);
  }, [id, lang, title, raw, busy]);
  useEffect(() => () => dropArt(id), [id]);

  const writing = busy && !(lang === "svg" ? /<\/svg>\s*$/i : /<\/html>\s*$/i).test(raw.trim());
  return (
    <button type="button" className={`art-card ${open && active === id ? "on" : ""}`} onClick={() => openArt(id)}>
      <span className="art-ic">{lang === "svg" ? <ImageIcon size={18} strokeWidth={1.8} /> : <FileCode2 size={18} strokeWidth={1.8} />}</span>
      <span className="art-meta">
        <b>{title}</b>
        <small>{writing ? "Writing…" : `${lang.toUpperCase()} · ${raw.split("\n").length} lines · Click to open`}</small>
      </span>
    </button>
  );
}

/* The resizable panel on the right */
export function ArtifactPanel() {
  const st = useArts();
  const busy = !useCanSend();
  const [view, setView] = useState<"preview" | "code">("preview");
  const [w, setW] = useState(600);
  const [showFiles, setShowFiles] = useState(false);
  const [doc, setDoc] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const wasBusy = useRef(false);
  const wasLive = useRef(false);
  const art = st.arts.find((a) => a.id === st.active) ?? null;
  const code = art ? st.edits[art.id] ?? art.code : "";
  const live = busy && !!art && st.streaming === art.id;

  useEffect(() => { const v = Number(localStorage.getItem("mb-panel-w")); if (v > 0) setW(v); }, []);
  useEffect(() => { localStorage.setItem("mb-panel-w", String(w)); }, [w]);
  useEffect(() => { if (busy && !wasBusy.current) newResponse(); wasBusy.current = busy; }, [busy]);
  useEffect(() => { if (live) setView("code"); else if (wasLive.current) setView("preview"); wasLive.current = live; }, [live]);
  useEffect(() => { if (live && ta.current) ta.current.scrollTop = ta.current.scrollHeight; }, [live, code]);
  useEffect(() => {
    if (!art) return;
    const t = setTimeout(() => setDoc(buildDoc(art.lang, code)), 300);
    return () => clearTimeout(t);
  }, [art, code]);
  useEffect(() => {
    const on = st.open && !!art;
    document.body.classList.toggle("art-open", on);
    document.body.style.marginRight = on && window.innerWidth >= 900 ? `${w}px` : "";
  }, [st.open, art, w]);
  useEffect(() => () => { document.body.classList.remove("art-open"); document.body.style.marginRight = ""; }, []);

  if (!st.open || !art) return null;

  const file = (art.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "artifact") + (art.lang === "svg" ? ".svg" : ".html");
  const save = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([code], { type: art.lang === "svg" ? "image/svg+xml" : "text/html" }));
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const pdf = () => {
    const go = () => frame.current?.contentWindow?.postMessage("mb-print", "*");
    if (view === "preview") go(); else { setView("preview"); setTimeout(go, 700); }
  };
  const openTab = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.title = art.title;
    win.document.body.style.margin = "0";
    const f = win.document.createElement("iframe");
    f.setAttribute("sandbox", SANDBOX);
    f.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0";
    f.srcdoc = buildDoc(art.lang, code);
    win.document.body.appendChild(f);
  };
  const drag = (e: RPE) => {
    e.preventDefault();
    document.body.classList.add("art-dragging");
    const move = (ev: PointerEvent) => setW(Math.round(Math.min(Math.max(360, window.innerWidth - ev.clientX), window.innerWidth - 320)));
    const up = () => {
      document.body.classList.remove("art-dragging");
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  return createPortal(
    <aside className="art-panel" style={{ width: w }}>
      <div className="art-grip" onPointerDown={drag} />
      <header className="art-head">
        {st.arts.length > 1 && <button type="button" className="art-ib" title="All files" onClick={() => setShowFiles((x) => !x)}><Files size={16} /></button>}
        <b className="art-title">{art.title}{st.edits[art.id] !== undefined && <small> · edited</small>}</b>
        <div className="art-tabs">
          <button type="button" className={view === "preview" ? "on" : ""} onClick={() => setView("preview")}>Preview</button>
          <button type="button" className={view === "code" ? "on" : ""} onClick={() => setView("code")}>Code</button>
        </div>
        <button type="button" className="art-ib" title="Copy code" onClick={() => void navigator.clipboard.writeText(code)}><Copy size={16} /></button>
        <button type="button" className="art-ib" title="Download" onClick={save}><Download size={16} /></button>
        {art.lang === "html" && <button type="button" className="art-ib" title="Save as PDF" onClick={pdf}><Printer size={16} /></button>}
        <button type="button" className="art-ib" title="Open in new tab" onClick={openTab}><ExternalLink size={16} /></button>
        <button type="button" className="art-ib" title="Close" onClick={closeArts}><X size={16} /></button>
      </header>
      <div className="art-body">
        {showFiles && st.arts.length > 1 && (
          <nav className="art-files">
            {st.arts.map((a) => (
              <button key={a.id} type="button" className={a.id === art.id ? "on" : ""} onClick={() => openArt(a.id)}>
                {a.title}<small>{a.lang}</small>
              </button>
            ))}
          </nav>
        )}
        {view === "preview" ? (
          <iframe ref={frame} className="art-frame" sandbox={SANDBOX} srcDoc={doc} title={art.title} />
        ) : (
          <textarea ref={ta} className="art-code" value={code} spellCheck={false} readOnly={live} onChange={(e) => editArt(art.id, e.target.value)} />
        )}
      </div>
    </aside>,
    document.body,
  );
}
