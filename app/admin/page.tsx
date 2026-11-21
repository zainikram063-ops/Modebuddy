"use client";
import { useEffect, useState, type ReactNode } from "react";

type Stats = {
  at: string;
  users: { total: number; today: number; week: number; signups: { day: string; n: number }[] };
  chatted: number;
  active: { today: number; week: number; returning: number; source: string };
  usage: { buddy: number; kodra: number; live: number; totalMessages: number | null; chatsByMode: { name: string; n: number }[] };
  limits: { buddy: { times: number; people: number }; kodra: { times: number; people: number } };
  skills: { top: { id: string; n: number }[]; custom: number | null; customPeople: number | null };
  recent: { email: string; joined: string; lastSeen: string | null; chats: number }[];
};

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  return Math.round(h / 24) + "d ago";
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Card({ title, big, sub }: { title: string; big: number; sub: ReactNode }) {
  return <section className="ad-card"><h2>{title}</h2><div className="ad-big">{big}</div><div className="ad-sub">{sub}</div></section>;
}
function Row({ k, v }: { k: string; v: string | number }) {
  return <div className="ad-row"><span>{k}</span><span>{v}</span></div>;
}

/* Private stats, only for the owner */
export default function AdminStats() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/stats", { cache: "no-store" });
      if (r.status === 404) { setErr("notfound"); return; }
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't load stats."); return; }
      setErr("");
      setS(j as Stats);
    } catch {
      setErr("Couldn't load stats.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { void load(); }, []);

  if (err === "notfound") return <div className="ad-center"><style>{AD_CSS}</style>Not found</div>;
  if (!s) return <div className="ad-center"><style>{AD_CSS}</style>{err || "Loading stats..."}</div>;
  const max = Math.max(1, ...s.users.signups.map((d) => d.n));
  const buddyChat = Math.max(0, s.usage.buddy - s.usage.live);
  return (
    <main className="ad">
      <style>{AD_CSS}</style>
      <div className="ad-in">
        <header className="ad-head">
          <h1>ModeBuddy stats</h1>
          <small>Updated {ago(s.at)}</small>
          <button type="button" className="ad-btn" onClick={() => void load()} disabled={busy}>{busy ? "Refreshing..." : "Refresh"}</button>
        </header>
        {err && <p className="ad-note">{err}</p>}
        <div className="ad-grid">
          <Card title="Users" big={s.users.total} sub={<><b>+{s.users.week}</b> this week, {s.users.today} today</>} />
          <Card title="Added a key and chatted" big={s.chatted} sub={<><b>{pct(s.chatted, s.users.total)}%</b> of everyone who signed up</>} />
          <Card title="Active" big={s.active.today} sub={<>today, <b>{s.active.week}</b> this week</>} />
          <Card title="Coming back" big={s.active.returning} sub={<>of {s.active.week} active this week used it on 2+ days</>} />
        </div>
        <div className="ad-grid">
          <section className="ad-card ad-wide">
            <h2>Signups, last 14 days</h2>
            <div className="ad-bars">
              {s.users.signups.map((d) => (
                <div key={d.day} className="ad-bar" title={d.day + ": " + d.n}>
                  <em>{d.n || ""}</em><i style={{ height: (d.n / max) * 80 + "%" }} /><span>{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="ad-card">
            <h2>This week</h2>
            <div className="ad-list">
              <Row k="Buddy messages" v={buddyChat} />
              <Row k="Kodra messages" v={s.usage.kodra} />
              <Row k="Live (Cmd+Option) uses" v={s.usage.live} />
              <Row k="All messages ever" v={s.usage.totalMessages ?? "n/a"} />
            </div>
          </section>
        </div>
        <div className="ad-grid">
          <section className="ad-card">
            <h2>New chats by mode, this week</h2>
            <div className="ad-list">{s.usage.chatsByMode.length ? s.usage.chatsByMode.map((m) => <Row key={m.name} k={m.name} v={m.n} />) : <p className="ad-sub">No chats yet.</p>}</div>
          </section>
          <section className="ad-card">
            <h2>Hit the limit, this week</h2>
            <div className="ad-list">
              <Row k="Buddy" v={s.limits.buddy.times + " times, " + s.limits.buddy.people + " people"} />
              <Row k="Kodra" v={s.limits.kodra.times + " times, " + s.limits.kodra.people + " people"} />
            </div>
            <p className="ad-sub">These people are your first Pro customers.</p>
          </section>
          <section className="ad-card">
            <h2>Skills, this week</h2>
            <div className="ad-list">{s.skills.top.length ? s.skills.top.map((k) => <Row key={k.id} k={"/" + k.id} v={k.n} />) : <p className="ad-sub">No skills used yet.</p>}</div>
            <p className="ad-sub">{s.skills.custom === null ? "The custom skills table isn't set up." : s.skills.custom + " custom skills made by " + s.skills.customPeople + " people"}</p>
          </section>
        </div>
        <section className="ad-card">
          <h2>Newest users</h2>
          <div className="ad-scroll">
            <table className="ad-table">
              <thead><tr><th>Email</th><th>Joined</th><th>Last active</th><th>Chats</th></tr></thead>
              <tbody>{s.recent.map((u) => <tr key={u.email + u.joined}><td>{u.email}</td><td>{ago(u.joined)}</td><td>{ago(u.lastSeen)}</td><td>{u.chats}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
        <p className="ad-note">
          Only you can see this page. Gemini keys are never stored, so &quot;added a key and chatted&quot; is the closest sign someone finished setup.
          Limit, Live and skill numbers count from the day this page was added.{s.active.source === "chats" ? " Activity is based on chats." : ""}
        </p>
      </div>
    </main>
  );
}

const AD_CSS = [
  ".ad{min-height:100vh;background:var(--side);color:var(--side-ink);font-size:14px;padding:32px clamp(16px,4vw,48px);box-sizing:border-box}",
  ".ad-in{max-width:1100px;margin:0 auto}",
  ".ad-head{display:flex;align-items:center;gap:12px;margin-bottom:22px}",
  ".ad-head h1{flex:1;margin:0;font-family:var(--display);font-size:26px;letter-spacing:-.02em}",
  ".ad-head small{color:var(--side-ink-2);font-size:12px}",
  ".ad-btn{height:34px;padding:0 14px;border-radius:9px;border:1px solid var(--side-3);background:var(--side-2);color:var(--side-ink);font:inherit;font-size:13px;cursor:pointer}",
  ".ad-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:12px}",
  ".ad-card{padding:16px 18px;border-radius:16px;background:var(--side-2);border:1px solid rgba(255,255,255,.06);min-width:0}",
  ".ad-card h2{margin:0 0 10px;font-size:10.5px;font-family:var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--side-ink-2);font-weight:600}",
  ".ad-big{font-family:var(--display);font-size:34px;font-weight:600;letter-spacing:-.03em;line-height:1}",
  ".ad-sub{margin:8px 0 0;color:var(--side-ink-2);font-size:12.5px;line-height:1.45}",
  ".ad-sub b{color:var(--accent);font-weight:600}",
  ".ad-wide{grid-column:span 2}",
  ".ad-bars{display:flex;align-items:flex-end;gap:6px;height:130px}",
  ".ad-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:100%}",
  ".ad-bar i{display:block;width:100%;min-height:2px;border-radius:6px 6px 2px 2px;background:var(--accent);opacity:.85}",
  ".ad-bar em{font-style:normal;font-size:10.5px}",
  ".ad-bar span{font-size:10px;font-family:var(--mono);color:var(--side-ink-2)}",
  ".ad-list{display:flex;flex-direction:column;gap:9px}",
  ".ad-row{display:flex;justify-content:space-between;gap:12px;font-size:13px}",
  ".ad-row span:last-child{font-family:var(--mono);color:var(--side-ink-2);text-align:right}",
  ".ad-scroll{overflow-x:auto}",
  ".ad-table{width:100%;border-collapse:collapse;font-size:13px}",
  ".ad-table th{text-align:left;font-size:10.5px;font-family:var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--side-ink-2);font-weight:600;padding:0 12px 8px 0}",
  ".ad-table td{padding:9px 12px 9px 0;border-top:1px solid rgba(255,255,255,.05);white-space:nowrap}",
  ".ad-note{margin:18px 0 0;color:var(--side-ink-2);font-size:12px;line-height:1.5}",
  ".ad-center{min-height:100vh;display:grid;place-items:center;background:var(--side);color:var(--side-ink-2);font-size:14px}",
  "@media (max-width:640px){.ad-wide{grid-column:auto}}",
].join("");
