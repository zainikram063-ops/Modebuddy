"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message } from "ai";
import { Columns2, Globe, Share2, Shuffle, Timer, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { modeCopy, onAccent, type Mode } from "@/lib/modes";
import { modelLabel, type ModelConfig } from "@/lib/providers-meta";
import { DEFAULT_STUDY, STUDY_CHIPS, STUDY_KEY, isStudyChip, parseStudy, studyChipPrompt, type StudySettings } from "@/lib/study";
import type { Connector } from "@/lib/types";
import { VERSION } from "@/lib/version";
import MessageItem, { FOLLOW_RE } from "./MessageItem";
import { useChatMotion, playModeSwitch } from "./Motion";
import Thinking from "./Thinking";
import Compare from "./Compare";
import StudyBar, { type StudyToolAction } from "./StudyBar";
import { MicButton, speak } from "./Voice";
import { Icon } from "./Icons";
import type { AppUser } from "./Workspace";
import type { SettingsTab } from "./Settings";

type Props = {
  id: string; initialMessages: Message[]; title: string; user: AppUser;
  mode: Mode; modes: Mode[]; onModeChange: (id: string) => void;
  modelConfig: ModelConfig; connectors: Connector[]; memoryEnabled: boolean;
  onFinished: (first: boolean, firstText: string) => void;
  openSettings: (t: SettingsTab) => void; toast: (t: string) => void; onMenu: () => void;
};
type Pending = { id: string; file: File; kind: "upload" | "text"; preview?: string; text?: string };
type Switched = { from: string; to: string; name: string; reason?: string };

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|js|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|cs|php|css|scss|html|xml|ya?ml|toml|ini|sql|sh|log)$/i;
const PDF_CHIP = "Save as PDF";

export default function ChatView(p: Props) {
  const supabase = useMemo(() => createClient(), []);
  const connectors = useMemo(() => p.connectors.filter((c) => c.enabled), [p.connectors]);
  const [webOn, setWebOn] = useState(false);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [study, setStudy] = useState<StudySettings>(DEFAULT_STUDY);
  const isStudy = p.mode.id === "study";

  useEffect(() => {
    try { const s = localStorage.getItem(STUDY_KEY); if (s) setStudy(parseStudy(JSON.parse(s))); } catch {}
  }, []);
  const updateStudy = (s: StudySettings) => { setStudy(s); localStorage.setItem(STUDY_KEY, JSON.stringify(s)); };

  const { messages, setMessages, append, reload, stop, status, error } = useChat({
    id: p.id,
    initialMessages: p.initialMessages,
    sendExtraMessageFields: true,
    experimental_throttle: 40,
    body: {
      model: p.modelConfig, modeId: p.mode.id, connectors, memoryEnabled: p.memoryEnabled,
      webSearch: webOn, autoMode: autoSwitch, study: isStudy ? study : undefined,
    },
    onResponse: (res) => {
      const e = res.headers.get("x-connector-errors");
      if (e) p.toast(`Connector problem · ${decodeURIComponent(e)}`);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [line, setLine] = useState("");
  const [switched, setSwitched] = useState<Switched | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareId, setShareId] = useState<string | null | undefined>(undefined);
  const [sharing, setSharing] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevStatus = useRef(status);
  const handledSwitch = useRef(new Set(p.initialMessages.map((m) => m.id)));
  const copy = modeCopy(p.mode);
  useChatMotion(scrollRef, p.id);
  const codeMode = /code/i.test(`${p.mode.id} ${p.mode.name}`);
  const examDay = isStudy && study.examDay;

  /* voice: if the user spoke, read the reply aloud when it finishes */
  const voiceTurn = useRef(false);
  const prevVoice = useRef(status);
  useEffect(() => {
    const was = prevVoice.current;
    prevVoice.current = status;
    if (!voiceTurn.current) return;
    if (status === "error") { voiceTurn.current = false; return; }
    if ((was === "submitted" || was === "streaming") && status === "ready") {
      voiceTurn.current = false;
      const l = messages[messages.length - 1];
      if (l?.role === "assistant")
        speak(l.parts?.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n") || l.content);
    }
  }, [status, messages]);

  /* smart mode auto-switch */
  useEffect(() => {
    if (busy || !autoSwitch) return;
    const l = messages[messages.length - 1];
    if (!l || l.role !== "assistant" || handledSwitch.current.has(l.id)) return;
    handledSwitch.current.add(l.id);
    for (const part of l.parts ?? []) {
      if (part.type !== "tool-invocation") continue;
      const ti = part.toolInvocation;
      if (ti.toolName !== "suggest_mode" || ti.state !== "result") continue;
      const r = ti.result as { ok?: boolean; modeId?: string; name?: string; reason?: string };
      if (r?.ok && r.modeId && r.modeId !== p.mode.id && p.modes.some((x) => x.id === r.modeId)) {
        setSwitched({ from: p.mode.id, to: r.modeId, name: r.name ?? "", reason: r.reason });
        p.onModeChange(r.modeId);
      }
      break;
    }
  }, [busy, messages, autoSwitch, p]);

  useEffect(() => {
    if (!switched) return;
    const t = setTimeout(() => setSwitched(null), 9000);
    return () => clearTimeout(t);
  }, [switched]);

  const undoSwitch = () => {
    if (!switched) return;
    p.onModeChange(switched.from);
    setAutoSwitch(false);
    setSwitched(null);
    p.toast("Switched back. Auto-switch is off for this chat.");
  };

  /* greeting line (client-only to avoid hydration mismatch) */
  useEffect(() => {
    if (examDay) { setLine("Exam day. Quick, sharp revision. You've got this."); return; }
    setLine(copy.lines[Math.floor(Math.random() * copy.lines.length)] ?? "");
  }, [p.mode.id, examDay]); // eslint-disable-line react-hooks/exhaustive-deps

  /* turn finished → refresh sidebar, generate title on first exchange */
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if ((was === "submitted" || was === "streaming") && (status === "ready" || status === "error")) {
      const users = messages.filter((m) => m.role === "user");
      p.onFinished(status === "ready" && users.length === 1, users[0]?.content ?? "");
    }
  }, [status, messages, p]);

  /* auto-scroll only when the user is near the bottom */
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && busy) stop(); };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [busy, stop]);

  useEffect(() => { taRef.current?.focus(); }, []);

  const fitInput = () => requestAnimationFrame(() => {
    const ta = taRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 240) + "px"; }
  });

  /* ---------- files ---------- */
  const addFiles = useCallback(async (list: FileList | File[]) => {
    const out: Pending[] = [];
    for (const file of Array.from(list).slice(0, 6)) {
      const id = crypto.randomUUID();
      if (file.type.startsWith("image/") || file.type === "application/pdf") {
        if (file.size > 10_000_000) { p.toast(`${file.name} is over 10 MB.`); continue; }
        out.push({ id, file, kind: "upload", preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined });
      } else if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) {
        if (file.size > 300_000) { p.toast(`${file.name} is over 300 KB.`); continue; }
        out.push({ id, file, kind: "text", text: await file.text() });
      } else {
        p.toast(`${file.name}: unsupported file type.`);
      }
    }
    setFiles((f) => [...f, ...out].slice(0, 8));
  }, [p]);

  const removeFile = (id: string) =>
    setFiles((f) => { const x = f.find((y) => y.id === id); if (x?.preview) URL.revokeObjectURL(x.preview); return f.filter((y) => y.id !== id); });

  /* ---------- send ---------- */
  const submit = useCallback(async (raw?: string) => {
    const text = (raw ?? input).trim();
    if ((!text && !files.length) || busy || uploading) return;
    if (!p.modelConfig.apiKey && p.modelConfig.provider !== "custom") {
      p.toast("Add an API key to start. Gemini has a free tier.");
      p.openSettings("models");
      return;
    }

    let attachments: { name: string; contentType: string; url: string }[] = [];
    let extra = "";
    try {
      setUploading(true);
      attachments = await Promise.all(
        files.filter((f) => f.kind === "upload").map(async ({ file }) => {
          const path = `${p.user.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
          const { error: upErr } = await supabase.storage.from("attachments").upload(path, file, { contentType: file.type });
          if (upErr) throw upErr;
          return { name: file.name, contentType: file.type, url: supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl };
        })
      );
      for (const f of files.filter((x) => x.kind === "text")) extra += `\n\n<file name="${f.file.name.replace(/"/g, "")}">\n${f.text}\n</file>`;
    } catch (e) {
      p.toast(`Upload failed: ${(e as Error).message}`);
      setUploading(false);
      return;
    }
    setUploading(false);

    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setInput(""); setFiles([]); stick.current = true;
    if (taRef.current) taRef.current.style.height = "auto";

    const content = (text || (attachments.length ? "What's in this?" : "Take a look.")) + extra;
    append({ role: "user", content }, { experimental_attachments: attachments.length ? attachments : undefined });
  }, [input, files, busy, uploading, p, supabase, append]);

  /* ---------- study tools ---------- */
  const runTool = (t: StudyToolAction) => {
    if (!t.prefillOnly && messages.length && !busy) { submit(t.text); return; }
    setInput(t.prefill);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    fitInput();
  };

  const whyDepth = useMemo(() => {
    let d = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      if (/^why\?/i.test(m.content)) d++; else break;
    }
    return d;
  }, [messages]);

  /* ---------- edit / regenerate (keeps DB in sync) ---------- */
  const editMessage = useCallback(async (index: number, text: string) => {
    if (busy) return;
    const original = messages[index];
    const removed = messages.slice(index).map((m) => m.id);
    await supabase.from("messages").delete().in("id", removed);
    setMessages(messages.slice(0, index));
    append({ role: "user", content: text }, { experimental_attachments: original.experimental_attachments });
  }, [busy, messages, supabase, setMessages, append]);

  const regenerate = useCallback(async () => {
    if (busy) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") await supabase.from("messages").delete().eq("id", last.id);
    reload();
  }, [busy, messages, supabase, reload]);

  /* ---------- compare: keep the winning answer ---------- */
  const keepCompare = useCallback(async (fresh: Message[]) => {
    setCompareOpen(false);
    if (!fresh.length) return;
    const firstUserText = messages.find((m) => m.role === "user")?.content ?? fresh.find((m) => m.role === "user")?.content ?? "New chat";
    await supabase.from("conversations").upsert(
      { id: p.id, user_id: p.user.id, title: firstUserText.replace(/<file[\s\S]*?<\/file>/g, "").trim().slice(0, 60) || "New chat", mode_id: p.mode.id },
      { onConflict: "id", ignoreDuplicates: true }
    );
    const { error: e } = await supabase.from("messages").insert(
      fresh.map((m) => ({
        id: m.id, conversation_id: p.id, user_id: p.user.id, role: m.role,
        content: m.content ?? "", parts: m.parts ?? null, attachments: m.experimental_attachments ?? null,
      }))
    );
    if (e) p.toast(`Couldn't save: ${e.message}`);
    fresh.forEach((m) => handledSwitch.current.add(m.id));
    const wasEmpty = !messages.some((m) => m.role === "user");
    setMessages([...messages, ...fresh]);
    stick.current = true;
    p.onFinished(wasEmpty, fresh.find((m) => m.role === "user")?.content ?? "");
  }, [messages, supabase, setMessages, p]);

  /* ---------- share ---------- */
  const shareUrl = shareId && typeof window !== "undefined" ? `${window.location.origin}/share/${shareId}` : "";

  const toggleShare = async () => {
    const opening = !shareOpen;
    setShareOpen(opening);
    if (!opening || shareId !== undefined) return;
    try {
      const r = await fetch(`/api/share?conversationId=${encodeURIComponent(p.id)}`);
      const j = await r.json();
      setShareId(j.id ?? null);
    } catch { setShareId(null); }
  };

  const createShare = async () => {
    if (!messages.length) { p.toast("Send a message first."); return; }
    setSharing(true);
    try {
      const r = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: p.id, title: p.title, messages,
          mode: { name: p.mode.name, icon: p.mode.icon, accent: p.mode.accent, theme: p.mode.theme },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't create the link.");
      setShareId(j.id);
      await navigator.clipboard.writeText(`${window.location.origin}/share/${j.id}`).catch(() => {});
      p.toast(shareId ? "Link updated and copied." : "Link copied. Anyone with it can view this chat.");
    } catch (e) {
      p.toast((e as Error).message);
    } finally {
      setSharing(false);
    }
  };

  const unshare = async () => {
    await fetch(`/api/share?conversationId=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    setShareId(null);
    p.toast("Link removed. It won't open anymore.");
  };

  /* ---------- derived ---------- */
  const last = messages[messages.length - 1];
  const chips = useMemo(() => {
    if (busy || !last || last.role !== "assistant") return [];
    const text = last.parts?.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n") || last.content;
    const offers = (text.match(FOLLOW_RE)?.[1] ?? "")
      .split("\n").map((s) => s.replace(/^\s*[-*•\d.)]+\s*/, "").trim()).filter(Boolean).slice(0, 3);
    const body = text.replace(FOLLOW_RE, "");
    const n = (body.match(/^\s*\d+[.)]\s/gm) || []).length;
    const nums = Array.from({ length: Math.min(n, 5) }, (_, i) => String(i + 1));
    const pdf = body.length > 600 && !offers.some((o) => /pdf/i.test(o)) ? [PDF_CHIP] : [];

    if (isStudy) {
      const hintLadder = offers.some((o) => /hint|fixed step|full answer/i.test(o));
      const studyChips = hintLadder ? [] : STUDY_CHIPS.map((c) => (c === "Why?" && whyDepth > 0 ? `Why? · ${whyDepth + 1}` : c));
      return [...nums, ...offers, ...studyChips, ...pdf];
    }
    const fallback = offers.length ? [] : body.includes("```") ? ["optimize", "explain"] : ["explain", "shorter"];
    return [...nums, ...offers, ...fallback, ...pdf];
  }, [busy, last, isStudy, whyDepth]);

  const onChip = (c: string) => {
    if (c === PDF_CHIP || /pdf/i.test(c)) { exportPdf(); return; }
    if (isStudy && isStudyChip(c)) { submit(studyChipPrompt(c, whyDepth + 1)); return; }
    submit(c);
  };

  const exportPdf = useCallback(() => {
    const nodes = scrollRef.current?.querySelectorAll<HTMLElement>(".msg.assistant .answer");
    const el = nodes?.[nodes.length - 1];
    if (!el) return;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".msg-actions, .tool-card, .mem-pill, button").forEach((n) => n.remove());
    const w = window.open("", "_blank");
    if (!w) { p.toast("Allow pop-ups to save as PDF."); return; }
    const title = p.title.replace(/</g, "&lt;");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
      body{font:15px/1.65 -apple-system,system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 24px;color:#111}
      h1{font-size:26px;margin-bottom:24px}pre{background:#f5f5f5;padding:12px;border-radius:6px;white-space:pre-wrap}
      code{font-family:ui-monospace,Menlo,monospace;font-size:13px}table{border-collapse:collapse}
      td,th{border:1px solid #ddd;padding:6px 10px}img{max-width:100%}
    </style></head><body><h1>${title}</h1>${clone.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }, [p]);

  const errText = useMemo(() => {
    if (!error) return null;
    try { return (JSON.parse(error.message) as { error?: string }).error ?? error.message; } catch { return error.message; }
  }, [error]);

  const firstName = (p.user.name ?? p.user.email.split("@")[0]).split(" ")[0];
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const noKey = !p.modelConfig.apiKey && p.modelConfig.provider !== "custom";

  return (
    <div
      className={`chat ${codeMode ? "code-mode" : ""} ${examDay ? "exam-day" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
    >
      <header className="topbar">
        <button className="icon-btn menu" onClick={p.onMenu} aria-label="Open sidebar"><Icon name="menu" /></button>
        <span className="title">{p.title}</span>
        <span className="mode-badge"><span>{p.mode.icon}</span>{p.mode.name}</span>
        {examDay && <span className="exam-badge"><Timer size={12} strokeWidth={2} /> Exam day</span>}

        <button className="icon-btn top-act" onClick={() => setCompareOpen(true)} disabled={busy} title="Compare models" aria-label="Compare models">
          <Columns2 size={16} strokeWidth={1.75} />
        </button>
        <div className="share-wrap">
          <button className={`icon-btn top-act ${shareId ? "on" : ""}`} onClick={toggleShare} title="Share chat" aria-label="Share chat" aria-expanded={shareOpen}>
            <Share2 size={16} strokeWidth={1.75} />
          </button>
          {shareOpen && (
            <div className="share-pop" role="dialog" aria-label="Share chat">
              <button className="share-close" onClick={() => setShareOpen(false)} aria-label="Close"><X size={14} strokeWidth={2} /></button>
              {shareId === undefined ? (
                <p className="share-text">Checking…</p>
              ) : shareId ? (
                <>
                  <p className="share-text"><b>Public link is on</b>Anyone with this link sees a read-only copy.</p>
                  <input className="share-url" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                  <div className="share-row">
                    <button onClick={() => { navigator.clipboard.writeText(shareUrl); p.toast("Link copied."); }}>Copy</button>
                    <button onClick={createShare} disabled={sharing}>{sharing ? "Updating…" : "Update"}</button>
                    <button className="danger" onClick={unshare}>Unshare</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="share-text"><b>Share this chat</b>Creates a read-only snapshot. Memory and connector results stay private.</p>
                  <div className="share-row">
                    <button className="primary" onClick={createShare} disabled={sharing}>{sharing ? "Creating…" : "Create link"}</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <span className={`status ${busy ? "live" : ""}`}><i />{busy ? (status === "submitted" ? "cooking" : "spilling") : "ready"}</span>
      </header>

      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        {!messages.length ? (
          <div className="empty">
            <div className="keys" aria-hidden>
              {[..."SAY LESS."].map((ch, i) =>
                ch === " " ? <span key={i} className="key gap" /> : <span key={i} className={`key ${i > 3 ? "lime" : ""}`} style={{ animationDelay: `${i * 55}ms` }}>{ch}</span>
              )}
            </div>
            <h1 className="hello">{hello}, <span>{firstName}</span>.</h1>
            <p className="hello-line">{line}</p>
            {noKey && (
              <button className="key-cta" onClick={() => p.openSettings("models")}>
                <Icon name="key" /> Add your API key to start. Gemini is free to try →
              </button>
            )}
            <div className="sugs">
              {copy.suggestions.map(([t, d]) => (
                <button key={t} className="sug" onClick={() => submit(t)}><b>{t}</b><span>{d}</span></button>
              ))}
            </div>
          </div>
        ) : (
          <div className="thread">
            {messages.map((m, i) => (
              <MessageItem key={m.id} m={m} isLast={i === messages.length - 1} busy={busy} onEdit={(t) => editMessage(i, t)} onRegenerate={regenerate} />
            ))}
            {status === "submitted" && (
              <div className="msg assistant"><div className="avatar" aria-hidden>⌥</div><Thinking code={codeMode} /></div>
            )}
            {errText && (
              <div className="error" role="alert">
                <span>{errText}</span>
                <button onClick={() => reload()}>Retry</button>
                <button onClick={() => p.openSettings("models")}>Settings</button>
              </div>
            )}
            {chips.length > 0 && (
              <div className="chips">
                {chips.map((c) => (
                  <button key={c} className={`chip ${isStudy && isStudyChip(c) ? "study-chip" : ""}`} onClick={() => onChip(c)}>{c}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {drag && <div className="dropzone"><Icon name="image" size={30} />Drop images, PDFs or text files</div>}

      {switched && (
        <div className="mode-note" role="status">
          <Shuffle size={14} strokeWidth={1.75} />
          <span>Switched to <b>{switched.name}</b>{switched.reason ? ` · ${switched.reason}` : ""}</span>
          <button onClick={undoSwitch}>Undo</button>
          <button className="x" onClick={() => setSwitched(null)} aria-label="Dismiss"><X size={13} strokeWidth={2} /></button>
        </div>
      )}

      {isStudy && <StudyBar value={study} onChange={updateStudy} onTool={runTool} />}

      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="composer-box">
          {files.length > 0 && (
            <div className="file-row">
              {files.map((f) => (
                <div key={f.id} className="file-chip">
                  {f.preview ? <img src={f.preview} alt="" /> : <span className="file-ext">{f.file.name.split(".").pop()?.slice(0, 4)}</span>}
                  <span>{f.file.name}</span>
                  <button type="button" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.file.name}`}><Icon name="x" size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder={
              messages.length
                ? isStudy ? "Ask anything, or tap Why? · Simpler · Analogy…" : "Say less. Try “2”, “optimize”, “shorter”…"
                : `Message ModeBuddy · ${p.mode.name} mode`
            }
            onChange={(e) => {
              setInput(e.target.value);
              const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 240) + "px";
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
          />
          <div className="composer-bar">
            <button type="button" className="tool" onClick={() => fileRef.current?.click()} title="Attach files"><Icon name="clip" /></button>
            <input
              ref={fileRef} type="file" multiple hidden
              accept="image/*,application/pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.py,.html,.css,.yml,.yaml,.sql,.sh"
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
            />
            <MicButton
              disabled={busy}
              getBase={() => input}
              onText={(t) => { setInput(t); fitInput(); }}
              onFinal={(t) => { voiceTurn.current = true; submit(t); }}
              onError={p.toast}
            />
            <button
              type="button"
              className={`tool web ${webOn ? "on" : ""}`}
              onClick={() => setWebOn((v) => !v)}
              title={webOn ? "Web search: always on" : "Web search: auto"}
              aria-pressed={webOn}
            >
              <Globe size={18} strokeWidth={1.75} />
            </button>

            <div className="picker">
              <button type="button" className="pill" onClick={() => setModeOpen((o) => !o)} aria-haspopup="menu" aria-expanded={modeOpen}>
                <span>{p.mode.icon}</span>{p.mode.name}<Icon name="chevron" size={12} />
              </button>
              {modeOpen && (
                <div className="menu-pop" role="menu" onMouseLeave={() => setModeOpen(false)}>
                  {p.modes.map((m) => (
                    <button key={m.id} type="button" role="menuitem" className={m.id === p.mode.id ? "on" : ""} onClick={(e) => { setModeOpen(false); if (m.id === p.mode.id) return; playModeSwitch(m, () => p.onModeChange(m.id), e); }}>
                      <span className="mi" style={{ background: m.accent, color: onAccent(m.accent) }}>{m.icon}</span>
                      <span><b>{m.name}</b><small>{m.tagline ?? `${m.theme} theme`}</small></span>
                    </button>
                  ))}
                  <button type="button" className="add" onClick={() => { p.openSettings("modes"); setModeOpen(false); }}>
                    <Icon name="plus" size={14} /> Create a mode
                  </button>
                </div>
              )}
            </div>

            <button type="button" className="pill ghost-pill" onClick={() => p.openSettings("models")} title="Change model">
              {modelLabel(p.modelConfig)}{noKey && <span className="warn-dot" />}
            </button>
            {connectors.length > 0 && (
              <button type="button" className="pill ghost-pill" onClick={() => p.openSettings("connectors")} title="Connectors">
                <Icon name="plug" size={13} />{connectors.length}
              </button>
            )}

            <span className="spacer" />
            {busy ? (
              <button type="button" className="send stop" onClick={stop} aria-label="Stop"><Icon name="stop" /></button>
            ) : (
              <button type="submit" className="send" disabled={(!input.trim() && !files.length) || uploading} aria-label="Send">
                {uploading ? <span className="spin" /> : <Icon name="send" />}
              </button>
            )}
          </div>
        </div>
        <p className="hint">{VERSION.full} can make mistakes. Check important info.</p>
      </form>

      {compareOpen && (
        <Compare
          chatId={p.id} history={messages} modeId={p.mode.id} code={codeMode}
          modelConfig={p.modelConfig} webSearch={webOn}
          onClose={() => setCompareOpen(false)} onKeep={keepCompare} toast={p.toast}
        />
      )}
    </div>
  );
}
