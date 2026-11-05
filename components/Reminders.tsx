"use client";

import { useEffect, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { removeReminder, updateReminder, useReminders, whenLabel, type Reminder } from "@/lib/reminders";

export default function Reminders({ buddy }: { buddy: boolean }) {
  const list = useReminders();
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState<Reminder[]>([]);
  const upcoming = list.filter((r) => !r.done && !due.some((d) => d.id === r.id));
  const dismiss = (id: string) => setDue((d) => d.filter((x) => x.id !== id));

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const r of list) {
        if (r.done || r.fired || r.at > now) continue;
        updateReminder(r.id, { fired: true });
        setDue((d) => [...d.filter((x) => x.id !== r.id), r]);
        if ("Notification" in window && Notification.permission === "granted") {
          try { new Notification("Reminder", { body: r.text, tag: r.id }); } catch { /* some phones need a service worker */ }
        }
      }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [list]);

  if (!buddy && !upcoming.length && !due.length) return null;
  const show = open || due.length > 0;
  const count = upcoming.length + due.length;

  return (
    <div className="picker">
      <button type="button" className="pill ghost-pill" onClick={() => setOpen((o) => !o)} title="Reminders" aria-expanded={show}>
        <Bell size={13} strokeWidth={2} />
        {count > 0 && <span className="rm-count">{count}</span>}
      </button>
      {show && (
        <div className="menu-pop rm-pop" role="dialog" onMouseLeave={() => { if (!due.length) setOpen(false); }}>
          {due.length > 0 && <div className="rm-head">Due now</div>}
          {due.map((r) => (
            <div key={r.id} className="rm-row rm-due">
              <Bell size={15} strokeWidth={2} />
              <span className="bb-text"><b>{r.text}</b><small>{whenLabel(r.at)}</small></span>
              <span className="rm-actions">
                <button type="button" className="rm-btn primary" onClick={() => { updateReminder(r.id, { done: true }); dismiss(r.id); }}>Done</button>
                <button type="button" className="rm-btn" onClick={() => { updateReminder(r.id, { at: Date.now() + 6e5, fired: false }); dismiss(r.id); }}>Snooze 10 min</button>
              </span>
            </div>
          ))}
          <div className="rm-head">Reminders</div>
          {!upcoming.length && <p className="rm-empty">Nothing coming up. Try asking Buddy to remind you tomorrow at 9 to call mom.</p>}
          {upcoming.map((r) => (
            <div key={r.id} className="rm-row">
              <button type="button" className="rm-check" title="Mark done" onClick={() => updateReminder(r.id, { done: true })}>
                <Check size={12} strokeWidth={3} />
              </button>
              <span className="bb-text"><b>{r.text}</b><small>{whenLabel(r.at)}</small></span>
              <button type="button" className="rm-x" title="Delete" onClick={() => removeReminder(r.id)}><X size={14} strokeWidth={2} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
