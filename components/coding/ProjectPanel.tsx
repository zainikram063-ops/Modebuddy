"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { ClipboardPaste, FolderGit2, FolderOpen, GitCompare, KeyRound, Pin, RefreshCw, Search, Trash2, X } from "lucide-react";
import {
  canPickDir, droppedFolder, importGithub, isTextPath, pickFolder, projectFromEntry, projectFromFiles,
  setGithubToken, syncProject, type Project, type ProjectFile,
} from "@/lib/project";
import type { ProjectState } from "./useProject";

type Tab = "files" | "review";
type Props = { proj: ProjectState; tab: Tab; onClose: () => void; onReview: (diff: string) => void; toast: (t: string) => void };

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const DIFF_CMD = "git diff | pbcopy";
const STAGED_CMD = "git diff --staged | pbcopy";

export default function ProjectPanel({ proj, tab: startTab, onClose, onReview, toast }: Props) {
  const [tab, setTab] = useState<Tab>(startTab);
  const [adding, setAdding] = useState(!proj.project);
  const [repick, setRepick] = useState<Project | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [diff, setDiff] = useState("");
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [onClose]);
  useEffect(() => { if (tab === "files" && !adding) searchRef.current?.focus(); }, [tab, adding]);

  /* ---------- adding & syncing ---------- */
  const progress = (n: number) => setBusy(`Reading files… ${n}`);
  const finish = (p: Project | null, verb = "added") => {
    setBusy(null);
    if (!p) return;
    proj.add(p);
    setAdding(false);
    setRepick(null);
    const readable = p.files.filter((f) => f.text !== undefined).length;
    toast(`${p.name} ${verb} · ${p.files.length} files${p.source === "folder" ? `, ${readable} readable` : ""}`);
  };
  const fail = (e: unknown) => { setBusy(null); toast((e as Error)?.message || "Something went wrong."); };

  const chooseFolder = async () => {
    if (repick || !canPickDir()) { inputRef.current?.click(); return; }
    setBusy("Pick your project folder…");
    try { finish(await pickFolder(progress)); } catch (e) { fail(e); }
  };
  const onPicked = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy("Reading files…");
    try { finish(await projectFromFiles(list, repick ?? undefined, progress), repick ? "synced" : "added"); } catch (e) { fail(e); }
  };
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const entry = droppedFolder(e.dataTransfer.items);
    if (!entry) { toast("Drop a folder, not single files."); return; }
    setBusy("Reading files…");
    try { finish(await projectFromEntry(entry, repick ?? undefined, progress), repick ? "synced" : "added"); } catch (err) { fail(err); }
  };
  const fromGithub = async () => {
    if (token.trim()) setGithubToken(token);
    setBusy("Fetching from GitHub…");
    try { finish(await importGithub(repo)); } catch (e) { fail(e); }
  };
  const sync = async () => {
    const p = proj.project;
    if (!p) return;
    setBusy("Syncing…");
    try {
      const r = await syncProject(p, progress);
      if (r === "repick") { setBusy(null); setRepick(p); setAdding(true); setTab("files"); return; }
      finish(r, "synced");
    } catch (e) { fail(e); }
  };
  const removeProject = async () => {
    const p = proj.project;
    if (!p || !confirm(`Remove ${p.name} from ModeBuddy? Nothing on your computer is touched.`)) return;
    await proj.remove(p.id);
    setAdding(true);
  };

  /* ---------- files ---------- */
  const files = useMemo(() => proj.project?.files ?? [], [proj.project]);
  const pinned = useMemo(() => new Set(proj.pins), [proj.pins]);
  const rows = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = files.filter((f) => terms.every((t) => f.path.toLowerCase().includes(t)));
    hit.sort((a, b) => Number(pinned.has(b.path)) - Number(pinned.has(a.path)) || a.path.localeCompare(b.path));
    return { list: hit.slice(0, 300), total: hit.length };
  }, [files, q, pinned]);
  const github = proj.project?.source === "github";
  const why = (f: ProjectFile) =>
    f.secret ? "secret · never shared" : f.big || f.size > 200_000 ? "too big" : github ? (isTextPath(f.path) ? "" : "not text") : f.text === undefined ? "not text" : "";

  /* ---------- review ---------- */
  const looksLikeDiff = /^(diff --git|--- |\+\+\+ |@@ )/m.test(diff);
  const diffFiles = (diff.match(/^diff --git /gm) ?? []).length;
  const diffLines = diff ? diff.split("\n").length : 0;
  const copyCmd = (c: string) => navigator.clipboard.writeText(c).then(() => toast("Copied. Paste it in Terminal, inside your project folder."));
  const paste = () => navigator.clipboard.readText().then(setDiff).catch(() => toast("Click the box and press ⌘V instead."));

  const showAdd = tab === "files" && (adding || !proj.project);

  return createPortal(
    <div className="pp-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pp" role="dialog" aria-label="Your project">
        <header className="pp-head">
          <b>Project</b>
          {proj.projects.length > 0 && (
            <select
              value={adding ? "__add" : proj.project?.id ?? ""}
              onChange={(e) => {
                if (e.target.value === "__add") { setAdding(true); setRepick(null); setTab("files"); }
                else { proj.select(e.target.value); setAdding(false); }
              }}
            >
              {!proj.project && <option value="">Choose a project</option>}
              {proj.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="__add">+ Add another…</option>
            </select>
          )}
          <button type="button" className="pp-x" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        </header>

        {proj.project && !adding && (
          <div className="pp-meta">
            {proj.project.stack.map((s) => <span key={s} className="stack">{s}</span>)}
            <small>
              {proj.project.files.length} files · updated {ago(proj.project.updatedAt)}
              {proj.project.truncated ? " · big project, some files skipped" : ""}
            </small>
            <button type="button" className="pp-act" onClick={sync} disabled={!!busy}><RefreshCw size={12} strokeWidth={2} /> Sync</button>
            <button type="button" className="pp-act danger" onClick={removeProject}><Trash2 size={12} strokeWidth={2} /> Remove</button>
          </div>
        )}

        <nav className="pp-tabs">
          <button type="button" className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>
            <Pin size={13} strokeWidth={2} /> Files{proj.pins.length ? ` · ${proj.pins.length} pinned` : ""}
          </button>
          <button type="button" className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
            <GitCompare size={13} strokeWidth={2} /> Review changes
          </button>
        </nav>

        {busy && <div className="pp-busy"><i />{busy}</div>}

        <div className="pp-body">
          {showAdd ? (
            <div
              className={`pp-add ${over ? "over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <FolderOpen size={30} strokeWidth={1.5} />
              <b>{repick ? `Pick ${repick.name} again to sync it` : "Drop your project folder here"}</b>
              <span>or</span>
              <button type="button" className="pp-primary" onClick={chooseFolder} disabled={!!busy}>Choose folder</button>
              <input
                ref={(el) => { inputRef.current = el; if (el) el.setAttribute("webkitdirectory", ""); }}
                type="file"
                multiple
                hidden
                onChange={(e) => { onPicked(e.target.files); e.target.value = ""; }}
              />
              <p className="pp-privacy">
                Your files stay in this browser. <code>node_modules</code>, <code>.git</code>, build folders and secrets like{" "}
                <code>.env</code> are skipped. Only files you pin are sent to the AI, with your messages.
              </p>
              {!repick && (
                <>
                  <div className="pp-gh">
                    <input
                      value={repo}
                      onChange={(e) => setRepo(e.target.value)}
                      placeholder="github.com/owner/repo"
                      onKeyDown={(e) => { if (e.key === "Enter" && repo.trim()) fromGithub(); }}
                    />
                    <button type="button" className="pp-act" onClick={fromGithub} disabled={!repo.trim() || !!busy}>
                      <FolderGit2 size={13} strokeWidth={2} /> Import
                    </button>
                  </div>
                  <button type="button" className="pp-link" onClick={() => setShowToken((v) => !v)}>
                    <KeyRound size={12} strokeWidth={2} /> Private repo? Add a GitHub token
                  </button>
                  {showToken && (
                    <input className="pp-token" type="password" value={token} onChange={(e) => setToken(e.target.value)}
                           placeholder="Fine-grained token with read-only Contents access" />
                  )}
                </>
              )}
            </div>
          ) : tab === "files" ? (
            <>
              <label className="pf-search">
                <Search size={14} strokeWidth={2} />
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files to pin… (e.g. chat route)" />
              </label>
              <div className="pf-list">
                {rows.list.map((f) => {
                  const on = pinned.has(f.path);
                  const note = why(f);
                  const slash = f.path.lastIndexOf("/");
                  return (
                    <button key={f.path} type="button" className={`pf-row ${on ? "on" : ""}`} disabled={!!note && !on}
                            onClick={() => proj.togglePin(f.path)} title={note || (on ? "Unpin" : "Pin to this chat")}>
                      <Pin size={13} strokeWidth={2} />
                      <span className="pf-path">
                        {slash > -1 && <span>{f.path.slice(0, slash + 1)}</span>}
                        {f.path.slice(slash + 1)}
                      </span>
                      <small>{note || size(f.size)}</small>
                    </button>
                  );
                })}
                {rows.total > rows.list.length && <div className="pf-more">Showing {rows.list.length} of {rows.total}. Search to narrow it down.</div>}
                {!rows.total && <div className="pf-more">No files match “{q}”.</div>}
              </div>
            </>
          ) : (
            <div className="pr">
              <ol className="pr-steps">
                <li>
                  In Terminal, inside your project folder, run <code>{DIFF_CMD}</code>
                  <button type="button" className="pr-copy" onClick={() => copyCmd(DIFF_CMD)}>Copy</button>
                  <br />
                  <small>
                    Already ran <code>git add</code>? Use <code>{STAGED_CMD}</code>
                    <button type="button" className="pr-copy" onClick={() => copyCmd(STAGED_CMD)}>Copy</button>
                  </small>
                </li>
                <li>Paste it below, then hit <b>Review</b>.</li>
              </ol>
              <textarea className="pr-box" value={diff} onChange={(e) => setDiff(e.target.value)} placeholder="Paste your git diff here…" spellCheck={false} />
              <div className="pr-foot">
                <button type="button" className="pp-act" onClick={paste}><ClipboardPaste size={13} strokeWidth={2} /> Paste</button>
                {diff && (
                  <small className={looksLikeDiff ? "" : "warn"}>
                    {looksLikeDiff ? `${diffFiles || 1} file${diffFiles > 1 ? "s" : ""} · ${diffLines} lines` : "This doesn’t look like a git diff"}
                  </small>
                )}
                <button type="button" className="pp-primary" disabled={!diff.trim()} onClick={() => onReview(diff.slice(0, 150_000))}>
                  <GitCompare size={14} strokeWidth={2} /> Review
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
