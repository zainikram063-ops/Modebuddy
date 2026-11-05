"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createClient } from "@/lib/supabase/client";
import { PROVIDERS, type ProviderId } from "@/lib/providers-meta";
import { onAccent, type Mode, type Theme } from "@/lib/modes";
import type { LocalSettings } from "@/lib/local";
import type { Connector } from "@/lib/types";
import { VERSION } from "@/lib/version";
import { Icon } from "./Icons";
import type { AppUser } from "./Workspace";
import ModeIcon from "@/components/ModeIcon";

export type SettingsTab = "models" | "modes" | "memory" | "connectors" | "about";
type Update = (p: Partial<LocalSettings> | ((s: LocalSettings) => Partial<LocalSettings>)) => void;
type Props = {
  tab: SettingsTab; setTab: (t: SettingsTab) => void; onClose: () => void;
  settings: LocalSettings; update: Update; modes: Mode[]; reloadModes: () => Promise<void>;
  toast: (t: string) => void; user: AppUser;
};

const TABS: [SettingsTab, string, string][] = [
  ["models", "Models & keys", "key"], ["modes", "Modes & knowledge", "layers"],
  ["memory", "Memory", "brain"], ["connectors", "Connectors", "plug"], ["about", "About", "spark"],
];

export default function Settings(p: Props) {
  const { onClose } = p;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="modal-nav">
          <div className="modal-title">Settings</div>
          {TABS.map(([id, label, icon]) => (
            <button key={id} className={p.tab === id ? "on" : ""} onClick={() => p.setTab(id)}><Icon name={icon} />{label}</button>
          ))}
        </nav>
        <section className="modal-body">
          <button className="modal-close" onClick={onClose} aria-label="Close settings"><Icon name="x" /></button>
          {p.tab === "models" && <ModelsTab {...p} />}
          {p.tab === "modes" && <ModesTab {...p} />}
          {p.tab === "memory" && <MemoryTab {...p} />}
          {p.tab === "connectors" && <ConnectorsTab {...p} />}
          {p.tab === "about" && <AboutTab />}
        </section>
      </div>
    </div>
  );
}

/* ================= MODELS ================= */
function ModelsTab({ settings, update }: Props) {
  const [show, setShow] = useState(false);
  const pid = settings.provider;
  const meta = PROVIDERS[pid];

  return (
    <div className="tab">
      <h2>Models & keys</h2>
      <p className="muted">Bring your own key. Any provider works. <b>Gemini is recommended</b> for its high free usage limits.</p>

      <div className="provider-grid">
        {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
          const m = PROVIDERS[id];
          const has = !!settings.keys[id];
          return (
            <button key={id} className={`provider ${pid === id ? "on" : ""}`} onClick={() => update({ provider: id })}>
              {m.recommended && <span className="badge">Recommended</span>}
              <span className="p-name">{m.name}</span>
              <span className={`p-key ${has ? "ok" : ""}`}>{has ? "● Key saved" : id === "custom" ? "Key optional" : "No key yet"}</span>
            </button>
          );
        })}
      </div>

      <div className="field">
        <label>
          API key
          {meta.keyUrl && <a href={meta.keyUrl} target="_blank" rel="noreferrer">Get a {meta.name} key ↗</a>}
        </label>
        <div className="input-row">
          <input
            type={show ? "text" : "password"} autoComplete="off" spellCheck={false}
            placeholder={pid === "google" ? "AIza…" : pid === "anthropic" ? "sk-ant-…" : "sk-…"}
            value={settings.keys[pid] ?? ""}
            onChange={(e) => update((s) => ({ keys: { ...s.keys, [pid]: e.target.value.trim() } }))}
          />
          <button className="btn-icon" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide key" : "Show key"}><Icon name="eye" /></button>
        </div>
      </div>

      <div className="field">
        <label>Model</label>
        <input
          list={`models-${pid}`} placeholder="model id"
          value={settings.models[pid] ?? meta.models[0]?.id ?? ""}
          onChange={(e) => update((s) => ({ models: { ...s.models, [pid]: e.target.value.trim() } }))}
        />
        <datalist id={`models-${pid}`}>{meta.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
        <small className="muted">Pick a suggestion or type any model id your provider supports.</small>
      </div>

      {meta.needsBaseURL && (
        <div className="field">
          <label>Base URL</label>
          <input placeholder="https://api.together.xyz/v1" value={settings.baseURL} onChange={(e) => update({ baseURL: e.target.value.trim() })} />
        </div>
      )}

      {meta.note && <div className="note"><Icon name="spark" size={14} /><span>{meta.note}</span></div>}
      <div className="privacy">
        <Icon name="key" size={14} />
        <span>Keys are stored only in this browser. They're sent over HTTPS to call your provider and are never saved on ModeBuddy's servers.</span>
      </div>
    </div>
  );
}

/* ================= MODES + KNOWLEDGE ================= */
type Doc = { id: string; title: string; content: string };
const PRESETS = ["#c4ff2e", "#e07a2f", "#7c5cff", "#22d3ee", "#ff4d8d", "#ffd43b"];
const THEMES: [Theme, string][] = [["light", "Light"], ["dark", "Dark"], ["warm", "Warm"]];
const BUDGET = 60_000;

function ModesTab({ modes, reloadModes, toast }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [sel, setSel] = useState(modes[0]?.id ?? "default");
  const [draft, setDraft] = useState<Mode | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = sel === "__new" ? draft : modes.find((m) => m.id === sel) ?? null;
  const isNew = sel === "__new";

  useEffect(() => {
    if (sel === "__new") return;
    const m = modes.find((x) => x.id === sel);
    setDraft(m && !m.builtin ? { ...m } : null);
  }, [sel, modes]);

  const loadDocs = useCallback(async () => {
    if (sel === "__new") { setDocs([]); return; }
    const { data } = await supabase.from("knowledge").select("id,title,content").eq("mode_id", sel).order("created_at");
    setDocs((data as Doc[]) ?? []);
  }, [sel, supabase]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  const startNew = () => {
    setSel("__new");
    setDraft({ id: "__new", name: "", icon: "✦", theme: "light", accent: "#7c5cff", instructions: "", tagline: "", builtin: false });
  };

  const save = async () => {
    if (!draft?.name.trim()) return toast("Give your mode a name.");
    setSaving(true);
    const row = {
      name: draft.name.trim().slice(0, 40), icon: draft.icon.trim().slice(0, 3) || "✦", theme: draft.theme,
      accent: draft.accent, tagline: draft.tagline?.slice(0, 60) || null, instructions: draft.instructions.slice(0, 8000),
    };
    if (isNew) {
      const { data, error } = await supabase.from("modes").insert(row).select("id").single();
      setSaving(false);
      if (error) return toast(error.message);
      await reloadModes(); setSel(data.id); toast("Mode created.");
    } else {
      const { error } = await supabase.from("modes").update(row).eq("id", draft.id);
      setSaving(false);
      if (error) return toast(error.message);
      await reloadModes(); toast("Mode saved.");
    }
  };

  const remove = async () => {
    if (!draft || isNew || !window.confirm(`Delete “${draft.name}” and its knowledge?`)) return;
    await supabase.from("knowledge").delete().eq("mode_id", draft.id);
    await supabase.from("modes").delete().eq("id", draft.id);
    await reloadModes(); setSel("default"); toast("Mode deleted.");
  };

  const addDoc = async (title: string, content: string) => {
    if (isNew) return toast("Create the mode first.");
    if (!content.trim()) return;
    const { error } = await supabase.from("knowledge").insert({ mode_id: sel, title: title.trim().slice(0, 120) || "Untitled", content: content.slice(0, 200_000) });
    if (error) return toast(error.message);
    setDocTitle(""); setDocBody(""); loadDocs();
  };
  const onFiles = async (list: FileList) => {
    for (const f of Array.from(list)) {
      if (f.size > 1_000_000) { toast(`${f.name} is over 1 MB.`); continue; }
      await addDoc(f.name, await f.text());
    }
  };
  const delDoc = async (id: string) => { setDocs((d) => d.filter((x) => x.id !== id)); await supabase.from("knowledge").delete().eq("id", id); };

  const total = docs.reduce((n, d) => n + d.content.length, 0);
  const shown = draft ?? current;

  return (
    <div className="tab">
      <h2>Modes & knowledge</h2>
      <p className="muted">Modes change ModeBuddy's personality, colours and what it knows. Any mode can have its own knowledge.</p>

      <div className="split">
        <div className="mode-list">
          {modes.map((m) => (
            <button key={m.id} className={`mode-item ${sel === m.id ? "on" : ""}`} onClick={() => setSel(m.id)}>
              <span className="mi" style={{ background: m.accent, color: onAccent(m.accent) }}><ModeIcon icon={m.icon} /></span>
              <span><b>{m.name}</b><small>{m.builtin ? "built-in" : "custom"} · {m.theme}</small></span>
            </button>
          ))}
          <button className={`mode-item ${isNew ? "on" : ""}`} onClick={startNew}>
            <span className="mi" style={{ background: "var(--surface-2)" }}><Icon name="plus" size={14} /></span>
            <span><b>New mode</b><small>make your own</small></span>
          </button>
        </div>

        <div>
          {draft ? (
            <>
              <div className="field"><label>Name</label><input value={draft.name} maxLength={40} placeholder="Spanish Tutor" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
              <div className="field"><label>Tagline</label><input value={draft.tagline ?? ""} maxLength={60} placeholder="Patient, bilingual, a little cheeky" onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} /></div>
              <div className="field"><label>Icon <small className="muted">1–3 characters or an emoji</small></label><input value={draft.icon} maxLength={3} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} /></div>
              <div className="field">
                <label>Theme</label>
                <div className="seg-theme">
                  {THEMES.map(([t, l]) => <button key={t} type="button" className={draft.theme === t ? "on" : ""} onClick={() => setDraft({ ...draft, theme: t })}>{l}</button>)}
                </div>
              </div>
              <div className="field">
                <label>Accent</label>
                <div className="swatches">
                  {PRESETS.map((c) => <button key={c} type="button" aria-label={c} className={draft.accent === c ? "on" : ""} style={{ background: c }} onClick={() => setDraft({ ...draft, accent: c })} />)}
                  <input type="color" value={draft.accent} onChange={(e) => setDraft({ ...draft, accent: e.target.value })} aria-label="Custom colour" />
                </div>
              </div>
              <div className="field">
                <label>Instructions</label>
                <textarea value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                  placeholder="You're my Spanish tutor. Reply in simple Spanish, correct my mistakes gently, and add the English in brackets." />
              </div>
              <div className="row">
                <button className="btn primary" onClick={save} disabled={saving}>{saving ? <span className="spin" /> : isNew ? "Create mode" : "Save changes"}</button>
                {!isNew && <button className="btn danger" onClick={remove}>Delete mode</button>}
              </div>
            </>
          ) : current && (
            <div className="note"><Icon name="layers" size={14} /><span><b>{current.name}</b> is a built-in mode. {current.tagline} You can still give it knowledge below.</span></div>
          )}

          {shown && (
            <div className="mini" data-theme={shown.theme} style={{ "--accent": shown.accent, "--on-accent": onAccent(shown.accent) } as CSSProperties}>
              <div className="mini-bubble">quiz me</div>
              <div className="mini-text"><ModeIcon icon={shown.icon} /> {shown.name || "Your mode"}<small>Preview of chats in this mode.</small></div>
            </div>
          )}

          <h3><Icon name="book" size={16} /> Knowledge</h3>
          {isNew ? (
            <p className="muted">Create the mode first, then add knowledge.</p>
          ) : (
            <>
              <small className="muted">{total.toLocaleString()} / {BUDGET.toLocaleString()} characters included in each chat</small>
              <div className="budget"><i style={{ width: `${Math.min(100, (total / BUDGET) * 100)}%` }} /></div>
              <div className="list" style={{ marginTop: 12 }}>
                {docs.map((d) => (
                  <div key={d.id} className="list-item">
                    <Icon name="book" size={16} />
                    <div className="grow"><b>{d.title}</b><small>{d.content.length.toLocaleString()} chars · {d.content.slice(0, 80)}</small></div>
                    <button className="x" onClick={() => delDoc(d.id)} aria-label={`Delete ${d.title}`}><Icon name="trash" size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="field">
                <label>Add knowledge</label>
                <input placeholder="Title (e.g. Biology notes, chapter 3)" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                <textarea placeholder="Paste notes, docs, a style guide, product FAQs…" value={docBody} onChange={(e) => setDocBody(e.target.value)} />
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => addDoc(docTitle, docBody)} disabled={!docBody.trim()}>Add</button>
                <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="clip" size={14} /> Upload .txt / .md / .csv / .json</button>
                <input ref={fileRef} type="file" hidden multiple accept=".txt,.md,.markdown,.csv,.json,text/*"
                  onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================= MEMORY ================= */
function MemoryTab({ settings, update, toast }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<{ id: string; content: string; created_at: string }[]>([]);
  const [text, setText] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("memories").select("id,content,created_at").order("created_at", { ascending: false });
    setItems(data ?? []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from("memories").insert({ content: text.trim().slice(0, 500) });
    if (error) return toast(error.message);
    setText(""); load();
  };
  const del = async (id: string) => { setItems((i) => i.filter((x) => x.id !== id)); await supabase.from("memories").delete().eq("id", id); };
  const clear = async () => {
    if (!window.confirm("Forget everything ModeBuddy remembers about you?")) return;
    await supabase.from("memories").delete().not("id", "is", null);
    load(); toast("Memory cleared.");
  };

  return (
    <div className="tab">
      <h2>Memory</h2>
      <p className="muted">ModeBuddy remembers lasting things you tell it (your name, stack, goals and preferences) across chats. You're in control.</p>

      <div className="list-item">
        <div className="grow"><b>Use memory</b><small>Read and save memories in every chat</small></div>
        <button className={`switch ${settings.memoryEnabled ? "on" : ""}`} role="switch" aria-checked={settings.memoryEnabled} aria-label="Use memory"
          onClick={() => update({ memoryEnabled: !settings.memoryEnabled })} />
      </div>

      <h3>{items.length} {items.length === 1 ? "memory" : "memories"}</h3>
      <div className="list">
        {items.map((m) => (
          <div key={m.id} className="list-item">
            <Icon name="brain" size={16} />
            <div className="grow"><p>{m.content}</p><small>{new Date(m.created_at).toLocaleDateString()}</small></div>
            <button className="x" onClick={() => del(m.id)} aria-label="Forget"><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {!items.length && <p className="muted">Nothing yet. Tell ModeBuddy “remember that I…”</p>}
      </div>

      <div className="field">
        <label>Add a memory</label>
        <div className="input-row">
          <input value={text} placeholder="I'm learning Rust and prefer short answers" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button className="btn primary" onClick={add}>Add</button>
        </div>
      </div>
      {items.length > 0 && <div className="row"><button className="btn danger" onClick={clear}>Clear all memory</button></div>}
    </div>
  );
}

/* ================= CONNECTORS ================= */
function ConnectorsTab({ settings, update, toast }: Props) {
  const blank: Connector = { id: "", name: "", url: "", headerName: "Authorization", token: "", enabled: true };
  const [form, setForm] = useState<Connector | null>(null);
  const [status, setStatus] = useState<Record<string, { ok: boolean; text: string; tools?: string[] }>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const list = settings.connectors;

  const test = async (c: Connector) => {
    setTesting(c.id);
    try {
      const r = await fetch("/api/connectors/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connector: c }) });
      const j = (await r.json()) as { ok: boolean; error?: string; tools?: { name: string }[] };
      setStatus((s) => ({
        ...s,
        [c.id]: j.ok
          ? { ok: true, text: `Connected · ${j.tools!.length} tool${j.tools!.length === 1 ? "" : "s"}`, tools: j.tools!.map((t) => t.name) }
          : { ok: false, text: j.error ?? "Couldn't connect." },
      }));
    } catch (e) {
      setStatus((s) => ({ ...s, [c.id]: { ok: false, text: (e as Error).message } }));
    } finally {
      setTesting(null);
    }
  };

  const save = () => {
    if (!form?.name.trim() || !form.url.trim()) return toast("Name and URL are required.");
    try { new URL(form.url); } catch { return toast("That URL doesn't look right."); }
    const c: Connector = { ...form, name: form.name.trim(), url: form.url.trim(), id: form.id || crypto.randomUUID() };
    update((s) => ({ connectors: s.connectors.some((x) => x.id === c.id) ? s.connectors.map((x) => (x.id === c.id ? c : x)) : [...s.connectors, c] }));
    setForm(null);
    test(c);
  };
  const toggle = (id: string) => update((s) => ({ connectors: s.connectors.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)) }));
  const remove = (id: string) => update((s) => ({ connectors: s.connectors.filter((c) => c.id !== id) }));

  return (
    <div className="tab">
      <h2>Connectors</h2>
      <p className="muted">Plug any remote <b>MCP server</b> into ModeBuddy. Paste its URL and, if it needs one, an API key. Its tools become available in every chat.</p>

      <div className="list">
        {list.map((c) => {
          const st = status[c.id];
          return (
            <div key={c.id} className="list-item" style={{ alignItems: "flex-start" }}>
              <Icon name="plug" size={16} />
              <div className="grow">
                <b>{c.name}</b><small>{c.url}</small>
                {st && <div className={`test ${st.ok ? "ok" : "err"}`}>{st.text}</div>}
                {st?.tools && (
                  <div className="tool-tags">
                    {st.tools.slice(0, 12).map((t) => <code key={t}>{t}</code>)}
                    {st.tools.length > 12 && <code>+{st.tools.length - 12}</code>}
                  </div>
                )}
              </div>
              <button className="btn" onClick={() => test(c)} disabled={testing === c.id}>{testing === c.id ? <span className="spin" /> : "Test"}</button>
              <button className="x" onClick={() => setForm({ ...c })} aria-label={`Edit ${c.name}`}><Icon name="edit" size={14} /></button>
              <button className="x" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}><Icon name="trash" size={14} /></button>
              <button className={`switch ${c.enabled ? "on" : ""}`} role="switch" aria-checked={c.enabled} aria-label={`Enable ${c.name}`} onClick={() => toggle(c.id)} />
            </div>
          );
        })}
        {!list.length && !form && <p className="muted">No connectors yet.</p>}
      </div>

      {form ? (
        <div className="form-card">
          <div className="field"><label>Name</label><input value={form.name} placeholder="GitHub" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="field"><label>MCP server URL</label><input value={form.url} placeholder="https://example.com/mcp" onChange={(e) => setForm({ ...form, url: e.target.value })} /></div>
          <div className="field"><label>Auth header <small className="muted">usually Authorization</small></label><input value={form.headerName ?? ""} placeholder="Authorization" onChange={(e) => setForm({ ...form, headerName: e.target.value })} /></div>
          <div className="field"><label>API key / token <small className="muted">“Bearer ” is added for you</small></label><input type="password" autoComplete="off" value={form.token ?? ""} onChange={(e) => setForm({ ...form, token: e.target.value })} /></div>
          <div className="row">
            <button className="btn primary" onClick={save}>Save & test</button>
            <button className="btn" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="row"><button className="btn primary" onClick={() => setForm(blank)}><Icon name="plus" size={14} /> Add connector</button></div>
      )}

      <div className="note">
        <Icon name="key" size={14} />
        <span>Works with remote MCP servers using <b>Streamable HTTP</b> or <b>SSE</b> that accept a header token. Local (stdio) servers and servers that require an OAuth sign-in flow aren't supported yet. Tokens are stored in this browser only.</span>
      </div>
    </div>
  );
}

/* ================= ABOUT ================= */
function AboutTab() {
  return (
    <div className="tab">
      <div className="about-hero">
        <div className="v">{VERSION.family} <span>{VERSION.number}</span></div>
        <p>{VERSION.full} · released {VERSION.released}</p>
      </div>
      <h3>What's new</h3>
      <ul className="notes">{VERSION.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      <h3>Personality</h3>
      <ul className="notes">
        <li>Sharp, warm, quietly confident</li>
        <li>Says less, does more: short replies are commands</li>
        <li>Opinionated when it helps, honest when it doesn't know</li>
      </ul>
    </div>
  );
}
