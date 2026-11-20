"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, Sparkles } from "lucide-react";
import { Icon } from "./Icons";
import { DEFAULT_MODEL, GEMINI_MODELS, isChatModel, pickDefault, type PlatformModel } from "@/lib/models";
import { KeyAndLimits } from "./KeyBridge";
import { PROVIDERS, modelLabel, type ModelConfig } from "@/lib/providers-meta";
import Floating from "./Floating";

const KEY = "mb-model";
const OWN = "byok:";

export function useModelChoice(): [string, (id: string) => void] {
  const [id, setId] = useState(DEFAULT_MODEL);
  useEffect(() => {
    const v = localStorage.getItem(KEY);
    if (v && (v.startsWith(OWN) || isChatModel(v))) setId(v);
  }, []);
  return [id, (v: string) => { setId(v); localStorage.setItem(KEY, v); }];
}

/* models for the provider + key chosen in Settings */
function ownModels(cfg: ModelConfig) {
  const list = (PROVIDERS[cfg.provider]?.models ?? []).map((m) => m.id);
  return [...new Set([cfg.model, ...list])].filter((id) => !!id && /^[\w.:/@+-]+$/.test(id));
}

export default function ModelPicker({ value, onChange, byok }: { value: string; onChange: (id: string) => void; byok?: ModelConfig | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !(e.target as Element | null)?.closest?.(".menu-pop")) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const [models, setModels] = useState<PlatformModel[]>(GEMINI_MODELS);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((list: PlatformModel[] | null) => {
        if (!Array.isArray(list) || !list.length) return;
        setModels(list);
        const want = localStorage.getItem(KEY) ?? value;
        if (!want.startsWith(OWN) && !list.some((m) => m.id === want)) onChange(pickDefault(list));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* key removed in Settings: go back to the free models */
  useEffect(() => {
    if (value.startsWith(OWN) && (!byok || !ownModels(byok).includes(value.slice(OWN.length)))) onChange(pickDefault(models));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byok, value]);

  const own = byok ? ownModels(byok) : [];
  const mine = value.startsWith(OWN) && !!byok;
  const label = mine && byok ? modelLabel({ ...byok, model: value.slice(OWN.length) }) : models.find((m) => m.id === value)?.label ?? "Gemini";

  return (
    <div className="picker" ref={box}>
      <button type="button" className="pill ghost-pill" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {mine ? <KeyRound size={13} strokeWidth={2} /> : <Sparkles size={13} strokeWidth={2} />} {label}<Icon name="chevron" size={12} />
      </button>
      {open && (
        <Floating className="menu-pop" role="menu" style={{ maxHeight: 380, overflowY: "auto" }}>
          <div className="mp-group">ModeBuddy · free</div>
          {models.map((m) => (
            <button key={m.id} type="button" role="menuitem" className={m.id === value ? "on" : ""} onClick={() => { onChange(m.id); setOpen(false); }}>
              <span className="mi"><Sparkles size={14} strokeWidth={2} /></span>
              <span><b>{m.label}</b><small>{m.note}</small></span>
            </button>
          ))}
          <KeyAndLimits />
          {byok && own.length > 0 && <div className="mp-group">Your API key</div>}
          {byok && own.map((id) => (
            <button key={id} type="button" role="menuitem" className={OWN + id === value ? "on" : ""} onClick={() => { onChange(OWN + id); setOpen(false); }}>
              <span className="mi"><KeyRound size={14} strokeWidth={2} /></span>
              <span><b>{modelLabel({ ...byok, model: id })}</b><small>Uses your own key</small></span>
npm run dev            </button>
          ))}
        </Floating>
      )}
    </div>
  );
}
