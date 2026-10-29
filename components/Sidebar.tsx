"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import { Icon } from "./Icons";
import { VERSION } from "@/lib/version";
import type { Mode } from "@/lib/modes";
import type { AppUser } from "./Workspace";
import type { SettingsTab } from "./Settings";

export type ConvoRow = { id: string; title: string; mode_id: string; pinned: boolean; updated_at: string };

type Props = {
  user: AppUser; convos: ConvoRow[]; activeId: string; modes: Mode[];
  onNew: () => void; onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void; onPin: (id: string, pinned: boolean) => void; onDelete: (id: string) => void;
  openSettings: (t: SettingsTab) => void; onSignOut: () => void;
};

function group(list: ConvoRow[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const g: Record<string, ConvoRow[]> = { Pinned: [], Today: [], Yesterday: [], "Previous 7 days": [], Older: [] };
  for (const c of list) {
    const t = new Date(c.updated_at).getTime();
    if (c.pinned) g.Pinned.push(c);
    else if (t >= today) g.Today.push(c);
    else if (t >= today - day) g.Yesterday.push(c);
    else if (t >= today - 7 * day) g["Previous 7 days"].push(c);
    else g.Older.push(c);
  }
  return Object.entries(g).filter(([, v]) => v.length);
}

export default function Sidebar(p: Props) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);

  const groups = useMemo(() => group(p.convos.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))), [p.convos, q]);
  const iconFor = (id: string) => p.modes.find((m) => m.id === id)?.icon ?? "⌥";
  const initial = (p.user.name ?? p.user.email).slice(0, 1).toUpperCase();

  const commitRename = (id: string) => { if (draft.trim()) p.onRename(id, draft.trim().slice(0, 80)); setEditing(null); };

  return (
    <aside className="side">
      <div className="side-top">
        <div className="brand"><span className="brand-key">⌥</span><span>modebuddy</span></div>
        <span className="ver">{VERSION.family} {VERSION.number}</span>
      </div>

      <button className="new-chat" onClick={p.onNew}><Icon name="plus" /> New chat <kbd>⌘K</kbd></button>
      <label className="search"><Icon name="search" size={14} /><input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} /></label>

      <nav className="convos" aria-label="Chat history">
        {groups.map(([label, items]) => (
          <div key={label} className="group">
            <div className="group-label">{label}</div>
            {items.map((c) => (
              <div key={c.id} className={`convo ${c.id === p.activeId ? "active" : ""}`}>
                {editing === c.id ? (
                  <input
                    className="rename" autoFocus value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(c.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(c.id); if (e.key === "Escape") setEditing(null); }}
                  />
                ) : (
                  <button className="convo-btn" onClick={() => p.onOpen(c.id)} title={c.title}>
                    <span className="convo-mode">{iconFor(c.mode_id)}</span>
                    <span className="convo-title">{c.title}</span>
                  </button>
                )}
                {confirm === c.id ? (
                  <div className="confirm">
                    <button className="danger" onClick={() => { p.onDelete(c.id); setConfirm(null); }}>Delete</button>
                    <button onClick={() => setConfirm(null)}>Cancel</button>
                  </div>
                ) : editing !== c.id && (
                  <div className="convo-actions">
                    <button title={c.pinned ? "Unpin" : "Pin"} onClick={() => p.onPin(c.id, !c.pinned)}><Icon name="pin" size={14} /></button>
                    <button title="Rename" onClick={() => { setEditing(c.id); setDraft(c.title); }}><Icon name="edit" size={14} /></button>
                    <button title="Delete" onClick={() => setConfirm(c.id)}><Icon name="trash" size={14} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
        {!groups.length && <p className="empty-side">{q ? "No matches." : "No chats yet. Say something."}</p>}
      </nav>

      <div className="side-foot">
        {menu && (
          <div className="user-menu" onMouseLeave={() => setMenu(false)}>
            <button onClick={() => { p.openSettings("models"); setMenu(false); }}><Icon name="key" /> Models & keys</button>
            <button onClick={() => { p.openSettings("modes"); setMenu(false); }}><Icon name="layers" /> Modes & knowledge</button>
            <button onClick={() => { p.openSettings("memory"); setMenu(false); }}><Icon name="brain" /> Memory</button>
            <button onClick={() => { p.openSettings("connectors"); setMenu(false); }}><Icon name="plug" /> Connectors</button>
            <button onClick={() => { p.openSettings("about"); setMenu(false); }}><Icon name="spark" /> About {VERSION.family} {VERSION.number}</button>
            <hr />
            <button onClick={p.onSignOut}><Icon name="logout" /> Sign out</button>
          </div>
        )}
        <button className="user" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
          {p.user.avatar ? <img src={p.user.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="initials">{initial}</span>}
          <span className="user-name">{p.user.name ?? p.user.email}</span>
          <Icon name="chevron" size={14} />
        </button>
      </div>
    </aside>
  );
}
