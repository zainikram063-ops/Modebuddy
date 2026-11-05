"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { addReminder, parseWhen, toLocalInput, useReminders, whenLabel } from "@/lib/reminders";

export default function ReminderCard({ info }: { info: string[] }) {
  const list = useReminders();
  const [custom, setCustom] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const text = info[0] ?? "";
  const whenRaw = info[1] ?? "";
  const src = `${text}|${whenRaw}`;
  const saved = list.some((r) => r.src === src);
  const parsed = parseWhen(whenRaw);
  const at = custom ?? (parsed ? parsed.getTime() : null);
  if (!text) return null;
  return (
    <div className="bb-card">
      <Bell size={18} strokeWidth={2} />
      <div className="bb-text">
        <b>{text}</b>
        <small>{at ? whenLabel(at) : "Pick a time"}</small>
      </div>
      {!saved && (editing || !at) && (
        <input type="datetime-local" className="bb-time" value={at ? toLocalInput(at) : ""}
               onChange={(e) => setCustom(e.target.value ? new Date(e.target.value).getTime() : null)} />
      )}
      {!saved && at && !editing && <button type="button" onClick={() => setEditing(true)}>Change time</button>}
      <button type="button" className="bb-primary" disabled={!at || saved} onClick={() => at && addReminder(text, at, src)}>
        {saved ? "Reminder set" : "Set reminder"}
      </button>
    </div>
  );
}
