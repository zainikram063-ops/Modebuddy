"use client";

import "@/lib/polyfills";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message } from "ai";
import { Check, Columns2, X } from "lucide-react";
import { PROVIDERS, modelLabel, type ModelConfig, type ProviderId } from "@/lib/providers-meta";
import MessageItem from "./MessageItem";
import Thinking from "./Thinking";
import { Icon } from "./Icons";
import Waiting from "./Waiting";

type Props = {
  chatId: string; history: Message[]; modeId: string; code: boolean; modelConfig: ModelConfig; webSearch: boolean;
  onClose: () => void; onKeep: (fresh: Message[]) => void; toast: (t: string) => void;
};
type ColProps = {
  id: string; label: string; cfg: ModelConfig; history: Message[]; modeId: string; code: boolean; webSearch: boolean;
  prompt: string; run: number; onBusy: (b: boolean) => void; onKeep: (fresh: Message[]) => void;
};

const KEYS = "mb-compare-keys";
const readKeys = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEYS) ?? "{}"); } catch { return {}; } };
const errMsg = (e?: Error) => {
  if (!e) return null;
  try { return (JSON.parse(e.message) as { error?: string }).error ?? e.message; } catch { return e.message; }
};

function Column({ id, label, cfg, history, modeId, code, webSearch, prompt, run, onBusy, onKeep }: ColProps) {
  const { messages, append, reload, status, error } = useChat({
    id,
    initialMessages: history,
    sendExtraMessageFields: true,
    experimental_throttle: 40,
    body: { model: cfg, modeId, connectors: [], memoryEnabled: false, webSearch, autoMode: false, ephemeral: true },
  });
  const busy = status === "submitted" || status === "streaming";
  const t0 = useRef(0);
  const prev = useRef(status);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => { onBusy(busy); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!run) return;
    t0.current = performance.now();
    setMs(null);
    append({ role: "user", content: prompt });
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if ((was === "submitted" || was === "streaming") && !busy) setMs(performance.now() - t0.current);
  }, [status, busy]);
  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, status]);

  const fresh = messages.slice(history.length);
  const hasAnswer = fresh.some((m) => m.role === "assistant");

  return (
    <section className="cmp-col">
      <header className="cmp-head">
        <b>{label}</b>
        {ms !== null && <span className="cmp-time">{(ms / 1000).toFixed(1)}s</span>}
        <span className="spacer" />
        <button type="button" className="cmp-keep" disabled={busy || !hasAnswer} onClick={() => onKeep(fresh)}>
          <Check size={14} strokeWidth={2} /> Keep this one
        </button>
      </header>
      <div className="cmp-body thread" ref={bodyRef}>
        {!fresh.length && <p className="cmp-empty">Waiting for your prompt…</p>}
        {fresh.map((m, i) => (
          <MessageItem key={m.id} m={m} isLast={i === fresh.length - 1} busy={m.role === "user" ? true : busy} onEdit={() => {}} onRegenerate={() => reload()} />
        ))}
        {status === "submitted" && <div className="msg assistant waiting"><Waiting code={code} /></div>}
        {error && (
          <div className="error" role="alert">
            <span>{errMsg(error)}</span>
            <button type="button" onClick={() => reload()}>Retry</button>
          </div>
        )}
      </div>
    </section>
  );
}

export default function Compare(p: Props) {
  const [history] = useState(p.history);
  const session = useMemo(() => crypto.randomUUID().slice(0, 8), []);
  const cur = p.modelConfig;

  const options = useMemo(
    () => (Object.keys(PROVIDERS) as ProviderId[])
      .filter((id) => id !== "custom")
      .flatMap((id) => PROVIDERS[id].models.map((m) => ({ value: `${id}::${m.id}`, provider: id, label: `${PROVIDERS[id].name} · ${m.label}` }))),
    []
  );
  const def =
    options.find((o) => o.provider === cur.provider && o.value !== `${cur.provider}::${cur.model}`) ??
    options.find((o) => o.provider !== cur.provider) ??
    options[0];

  const [pick, setPick] = useState(def.value);
  const [provB, modelB] = pick.split("::") as [ProviderId, string];
  const [keys, setKeys] = useState<Record<string, string>>({});
  useEffect(() => { setKeys(readKeys()); }, []);
  const sameProv = provB === cur.provider;
  const keyB = sameProv ? cur.apiKey : keys[provB] ?? "";
  const cfgB = useMemo<ModelConfig>(() => ({ provider: provB, model: modelB, apiKey: keyB }), [provB, modelB, keyB]);

  const [input, setInput] = useState("");
  const [sent, setSent] = useState("");
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState({ a: false, b: false });
  const anyBusy = busy.a || busy.b;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") p.onClose(); };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [p]);

  const setKey = (v: string) => {
    const k = { ...keys, [provB]: v.trim() };
    setKeys(k);
    localStorage.setItem(KEYS, JSON.stringify(k));
  };

  const send = () => {
    const t = input.trim();
    if (!t || anyBusy) return;
    if (!keyB) { p.toast(`Add your ${PROVIDERS[provB].name} API key to compare.`); return; }
    setSent(t);
    setInput("");
    setRun((r) => r + 1);
  };

  return (
    <div className="compare" role="dialog" aria-modal="true" aria-label="Compare models">
      <div className="cmp-panel">
        <header className="cmp-top">
          <Columns2 size={16} strokeWidth={1.75} />
          <b>Compare</b>
          <span className="cmp-vs">{modelLabel(cur)} <i>vs</i></span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={run > 0}>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {!sameProv && (
            <input
              className="cmp-key" type="password" placeholder={`${PROVIDERS[provB].name} API key`}
              value={keys[provB] ?? ""} onChange={(e) => setKey(e.target.value)} disabled={run > 0}
            />
          )}
          {!sameProv && PROVIDERS[provB].keyUrl && (
            <a className="cmp-getkey" href={PROVIDERS[provB].keyUrl} target="_blank" rel="noreferrer">Get key</a>
          )}
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={p.onClose} aria-label="Close compare"><X size={18} strokeWidth={1.75} /></button>
        </header>

        {sent && <div className="cmp-prompt"><span>You asked</span>{sent}</div>}

        <div className="cmp-cols">
          <Column
            id={`${p.chatId}-cmp-a-${session}`} label={modelLabel(cur)} cfg={cur} history={history}
            modeId={p.modeId} code={p.code} webSearch={p.webSearch} prompt={sent} run={run}
            onBusy={(b) => setBusy((s) => ({ ...s, a: b }))} onKeep={p.onKeep}
          />
          <Column
            id={`${p.chatId}-cmp-b-${session}`} label={modelLabel(cfgB)} cfg={cfgB} history={history}
            modeId={p.modeId} code={p.code} webSearch={p.webSearch} prompt={sent} run={run}
            onBusy={(b) => setBusy((s) => ({ ...s, b }))} onKeep={p.onKeep}
          />
        </div>

        <form className="cmp-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            rows={1} autoFocus value={input} placeholder="Ask both models the same thing…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          />
          <button type="submit" className="send" disabled={!input.trim() || anyBusy} aria-label="Send to both">
            <Icon name="send" />
          </button>
        </form>
      </div>
    </div>
  );
}
