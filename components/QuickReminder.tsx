"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { addReminder, toInput } from "@/lib/reminders";

const inHour = () => { const d = new Date(Date.now() + 3_600_000); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); return d.getTime(); };
const at = (h: number, plusDays = 0) => { const d = new Date(); d.setDate(d.getDate() + plusDays); d.setHours(h, 0, 0, 0); return d.getTime(); };

/* Add a reminder straight from the Home screen */
export default function QuickReminder() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [when, setWhen] = useState(inHour);
  const [saved, setSaved] = useState(false);

  if (!open)
    return (
      <div className="bh-form-actions">
        <button type="button" className="bh-link" onClick={() => { setOpen(true); setWhen(inHour()); }}>
          <Plus size={14} strokeWidth={2} /> {saved ? "Add another" : "Add a reminder"}
        </button>
        {saved && <span className="bh-saved">Reminder added</span>}
      </div>
    );

  const add = () => {
    const t = text.trim();
    if (!t || when <= Date.now()) return;
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    addReminder(t, when);
    setText(""); setOpen(false); setSaved(true);
  };

  const chips = [
    { label: "In 1 hour", at: inHour() },
    ...(new Date().getHours() < 19 ? [{ label: "Tonight", at: at(20) }] : []),
    { label: "Tomorrow 9 AM", at: at(9, 1) },
  ];

  return (
    <form className="bh-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <input autoFocus placeholder="What should I remind you about?" value={text} maxLength={140} onChange={(e) => setText(e.target.value)} />
      <div className="bh-when">
        {chips.map((c) => (
          <button key={c.label} type="button" className={Math.abs(c.at - when) < 60_000 ? "on" : ""} onClick={() => setWhen(c.at)}>{c.label}</button>
        ))}
        <input type="datetime-local" value={toInput(when)} min={toInput(Date.now())}
               onChange={(e) => { const v = new Date(e.target.value).getTime(); if (!Number.isNaN(v)) setWhen(v); }} />
      </div>
      <div className="bh-form-actions">
        <button type="submit" className="bh-primary" disabled={!text.trim()}>Add reminder</button>
        <button type="button" className="bh-link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
