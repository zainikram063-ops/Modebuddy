"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Message } from "ai";
import { createClient } from "@/lib/supabase/client";
import { BUILTIN_MODES, onAccent, type Mode } from "@/lib/modes";
import { useLocalSettings } from "@/lib/local";
import { PROVIDERS, type ModelConfig } from "@/lib/providers-meta";
import Sidebar, { type ConvoRow } from "./Sidebar";
import ChatView from "./ChatView";
import Settings, { type SettingsTab } from "./Settings";
import { ArtifactPanel } from "./Artifacts";
import { ArtifactProvider } from "./ArtifactsLegacy";

export type AppUser = { id: string; email: string; name: string | null; avatar: string | null };
type Active = { id: string; initial: Message[] | null };

const newId = () => (typeof window === "undefined" ? "ssr" : crypto.randomUUID());

export default function Workspace({ user }: { user: AppUser }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { settings, update, ready } = useLocalSettings();

  const [convos, setConvos] = useState<ConvoRow[]>([]);
  const [customModes, setCustomModes] = useState<Mode[]>([]);
  const [active, setActive] = useState<Active>(() => ({ id: newId(), initial: [] }));
  const [pendingMode, setPendingMode] = useState("default");
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [sideOpen, setSideOpen] = useState(false);

  const modes = useMemo(() => [...BUILTIN_MODES, ...customModes.map((m) => ({ ...m, builtin: false }))], [customModes]);
  const activeConvo = convos.find((c) => c.id === active.id);
  const mode = modes.find((m) => m.id === (activeConvo?.mode_id ?? pendingMode)) ?? BUILTIN_MODES[0];

  const modelConfig: ModelConfig = useMemo(() => {
    const pid = settings.provider;
    return { provider: pid, model: settings.models[pid] || PROVIDERS[pid].models[0]?.id || "", apiKey: settings.keys[pid] ?? "", baseURL: settings.baseURL };
  }, [settings]);

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  /* ---------- data ---------- */
  const loadConvos = useCallback(async () => {
    const { data } = await supabase.from("conversations").select("id,title,mode_id,pinned,updated_at").order("updated_at", { ascending: false }).limit(300);
    if (data) setConvos(data as ConvoRow[]);
  }, [supabase]);

  const loadModes = useCallback(async () => {
    const { data } = await supabase.from("modes").select("*").order("created_at");
    if (data) setCustomModes(data as Mode[]);
  }, [supabase]);

  useEffect(() => { loadConvos(); loadModes(); }, [loadConvos, loadModes]);

  /* ---------- theme follows the mode ---------- */
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("theme-anim");
    el.dataset.theme = mode.theme;
    el.style.setProperty("--accent", mode.accent);
    el.style.setProperty("--on-accent", onAccent(mode.accent));
    const t = setTimeout(() => el.classList.remove("theme-anim"), 450);
    return () => clearTimeout(t);
  }, [mode.theme, mode.accent]);

  /* ---------- actions ---------- */
  const newChat = useCallback(() => { setActive({ id: crypto.randomUUID(), initial: [] }); setSideOpen(false); }, []);

  const openConvo = useCallback(async (id: string) => {
    setSideOpen(false);
    if (id === active.id) return;
    setActive({ id, initial: null });
    const { data } = await supabase.from("messages").select("id,role,content,parts,attachments,created_at").eq("conversation_id", id).order("created_at");
    const initial = (data ?? []).map((r) => ({
      id: r.id, role: r.role, content: r.content, parts: r.parts ?? undefined,
      experimental_attachments: r.attachments ?? undefined, createdAt: new Date(r.created_at),
    })) as Message[];
    setActive((a) => (a.id === id ? { id, initial } : a));
  }, [active.id, supabase]);

  const changeMode = useCallback(async (id: string) => {
    setPendingMode(id);
    if (activeConvo) {
      setConvos((cs) => cs.map((c) => (c.id === activeConvo.id ? { ...c, mode_id: id } : c)));
      await supabase.from("conversations").update({ mode_id: id }).eq("id", activeConvo.id);
    }
  }, [activeConvo, supabase]);

  const onFinished = useCallback(async (first: boolean, firstText: string) => {
    await loadConvos();
    if (first) {
      const r = await fetch("/api/title", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: active.id, model: modelConfig, text: firstText }),
      });
      if (r.ok) loadConvos();
    }
  }, [loadConvos, active.id, modelConfig]);

  const renameConvo = async (id: string, title: string) => {
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
    await supabase.from("conversations").update({ title }).eq("id", id);
  };
  const pinConvo = async (id: string, pinned: boolean) => {
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, pinned } : c)));
    await supabase.from("conversations").update({ pinned }).eq("id", id);
  };
  const deleteConvo = async (id: string) => {
    setConvos((cs) => cs.filter((c) => c.id !== id));
    await supabase.from("conversations").delete().eq("id", id);
    if (id === active.id) newChat();
    toast("Chat deleted.");
  };
  const signOut = async () => { await supabase.auth.signOut(); router.replace("/login"); router.refresh(); };

  /* ---------- shortcuts ---------- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); setSettingsTab("models"); }
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [newChat]);

  if (!ready) return <div className="splash"><span className="brand-key big"><img src="/logos/buddy.png" alt="ModeBuddy" className="brand-logo" /></span></div>;

  return (
    <ArtifactProvider>
      <div className={`app ${sideOpen ? "side-open" : ""}`}>
        <Sidebar
          user={user} convos={convos} activeId={active.id} modes={modes}
          onNew={newChat} onOpen={openConvo} onRename={renameConvo} onPin={pinConvo} onDelete={deleteConvo}
          openSettings={setSettingsTab} onSignOut={signOut}
        />
        <div className="scrim" onClick={() => setSideOpen(false)} />

        <main className="main">
          {active.initial === null ? (
            <div className="loading-thread" aria-busy="true">
              {[80, 55, 90, 40, 70].map((w, i) => <div key={i} className="skel" style={{ width: `${w}%` }} />)}
            </div>
          ) : (
            <ChatView
              key={active.id}
              id={active.id}
              initialMessages={active.initial}
              title={activeConvo?.title ?? "New chat"}
              user={user}
              mode={mode}
              modes={modes}
              onModeChange={changeMode}
              modelConfig={modelConfig}
              connectors={settings.connectors}
              memoryEnabled={settings.memoryEnabled}
              onFinished={onFinished}
              openSettings={setSettingsTab}
              toast={toast}
              onMenu={() => setSideOpen(true)}
            />
          )}
        </main>

        <ArtifactPanel />

        {settingsTab && (
          <Settings
            tab={settingsTab} setTab={setSettingsTab} onClose={() => setSettingsTab(null)}
            settings={settings} update={update} modes={modes} reloadModes={loadModes} toast={toast} user={user}
          />
        )}

        <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
      </div>
    </ArtifactProvider>
  );
}
