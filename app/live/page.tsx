"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { desktop, type LiveState } from "../../lib/desktop";

type Kind = "mic" | "screen" | "access";
const ROWS: { key: Kind; name: string; why: string }[] = [
  { key: "mic", name: "Microphone", why: "to hear you while you hold ⌘ ⌥" },
  { key: "screen", name: "Screen Recording", why: "to see your screen when you ask something" },
  { key: "access", name: "Accessibility", why: "for the ⌘ ⌥ shortcut and the Insert button" },
];

export default function LiveSetup() {
  const [mounted, setMounted] = useState(false);
  const [st, setSt] = useState<LiveState | null>(null);

  const refresh = useCallback(async () => {
    const api = desktop()?.live;
    if (api) setSt(await api.get());
  }, []);

  useEffect(() => {
    setMounted(true);
    refresh();
    const t = window.setInterval(refresh, 1500);
    return () => window.clearInterval(t);
  }, [refresh]);

  if (!mounted) return null;
  const api = desktop()?.live;

  if (!api) {
    return (
      <div className="legal-wrap">
        <main className="legal">
          <h1>ModeBuddy Live</h1>
          <p>Live works in the ModeBuddy Mac app. Open the app and turn it on from the green dot in your menu bar.</p>
          <p className="legal-back"><Link href="/live/history">Live history</Link> · <Link href="/live/memory">Memory</Link> · <Link href="/">← Back to ModeBuddy</Link></p>
        </main>
      </div>
    );
  }

  const ok = (k: Kind) => (k === "access" ? !!st?.perms.access : st?.perms[k] === "granted");
  const allOk = ROWS.every((r) => ok(r.key));

  return (
    <div className="legal-wrap">
      <main className="legal lv-setup">
        <h1>ModeBuddy Live</h1>
        <p>
          Hold <kbd>⌘</kbd> + <kbd>⌥</kbd> anywhere on your Mac, ask out loud, then let go. ModeBuddy looks at your screen,
          answers in a little window at the top, and reads a short version out loud.
        </p>

        <div className="lv-toggle-row">
          <div>
            <b>Live mode</b>
            <span>{st?.enabled ? (allOk && st.hookOn ? "On. Hold ⌘ ⌥ to try it." : "On, but it needs the permissions below.") : "Off"}</span>
          </div>
          <button className={`lv-switch ${st?.enabled ? "on" : ""}`} onClick={async () => setSt(await api.set(!st?.enabled))} aria-label="Turn Live mode on or off">
            <i />
          </button>
        </div>

        <h2>Permissions</h2>
        <ul className="lv-perms">
          {ROWS.map((r) => (
            <li key={r.key}>
              <span className={`lv-ok ${ok(r.key) ? "yes" : ""}`}>{ok(r.key) ? "✓" : "!"}</span>
              <div>
                <b>{r.name}</b>
                <span>{r.why}</span>
              </div>
              {!ok(r.key) && <button className="lv-btn2" onClick={async () => setSt(await api.request(r.key))}>Allow</button>}
            </li>
          ))}
        </ul>

        <p className="lv-note">
          Just allowed Screen Recording or Accessibility? Restart ModeBuddy so it takes effect.
          <button className="lv-btn2" onClick={() => api.restart()}>Restart ModeBuddy</button>
        </p>

        <p className="legal-back"><Link href="/live/history">Live history</Link> · <Link href="/live/memory">Memory</Link> · <Link href="/">← Back to ModeBuddy</Link></p>
      </main>
    </div>
  );
}
