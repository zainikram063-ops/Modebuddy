"use client";
import { useEffect, useState } from "react";

const STORE = "mb-gemini-key";
const AI_ROUTE = /^\/api\/(chat|title|study|live|models)/;
export const getGeminiKey = () => { try { return localStorage.getItem(STORE) || ""; } catch { return ""; } };
const openKeyWindow = () => window.dispatchEvent(new Event("mb:gemini-key"));
const until = (iso: string) => { const mins = Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)); return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`; };

/* Sends the user's own Gemini key with every request to ModeBuddy's server (it is never saved there) */
function install() {
  const w = window as Window & { __mbKeyFetch?: boolean };
  if (w.__mbKeyFetch) return;
  w.__mbKeyFetch = true;
  const base = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(raw, location.href);
      if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
        const key = getGeminiKey();
        if (key) {
          const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          h.set("x-gemini-key", key);
          init = { ...init, headers: h };
        } else if (AI_ROUTE.test(u.pathname) && !location.pathname.startsWith("/live/panel")) openKeyWindow();
      }
    } catch { /* leave the request as it is */ }
    return base(input, init);
  }) as typeof window.fetch;
}
if (typeof window !== "undefined") install();

export default function KeyBridge() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [state, setState] = useState<"" | "testing" | "bad" | "saved">("");
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (location.pathname.startsWith("/live/panel")) return;
    const on = () => { setKey(getGeminiKey()); setState(""); setOpen(true); };
    window.addEventListener("mb:gemini-key", on);
    if (location.hash === "#gemini-key") on();
    return () => window.removeEventListener("mb:gemini-key", on);
  }, []);
  if (!open) return <style>{MBK_CSS}</style>;
  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setState("testing");
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": k } });
      if (!r.ok) { setState("bad"); return; }
      localStorage.setItem(STORE, k);
      setState("saved");
      setTimeout(() => setOpen(false), 900);
    } catch { setState("bad"); }
  };
  const remove = () => { localStorage.removeItem(STORE); setKey(""); setState(""); };
  return (
    <div className="mbk-back" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <style>{MBK_CSS}</style>
      <div className="mbk" role="dialog" aria-label="Your Gemini key">
        <button type="button" className="mbk-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
        <h2>Add your free Gemini key</h2>
        <p className="mbk-sub">ModeBuddy runs on your own free Google key. It takes about a minute.</p>
        <ol>
          <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> and sign in with Google.</li>
          <li>Click <b>Create API key</b> and copy it.</li>
          <li>Paste it here.</li>
        </ol>
        <div className="mbk-row">
          <input type={show ? "text" : "password"} value={key} placeholder="Paste your key (starts with AIza…)" spellCheck={false}
            onChange={(e) => { setKey(e.target.value); setState(""); }} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
          <button type="button" className="mbk-eye" onClick={() => setShow((v) => !v)}>{show ? "Hide" : "Show"}</button>
        </div>
        {state === "bad" && <p className="mbk-err">Google didn&apos;t accept that key. Check you copied all of it.</p>}
        <div className="mbk-btns">
          {getGeminiKey() && <button type="button" className="mbk-ghost" onClick={remove}>Remove key</button>}
          <button type="button" className="mbk-go" disabled={!key.trim() || state === "testing"} onClick={save}>{state === "testing" ? "Checking…" : state === "saved" ? "Saved ✓" : "Test & save"}</button>
        </div>
        <p className="mbk-note">Your key stays on this device and is only used to talk to Gemini for you. Free keys have their own limits from Google, and on the free tier Google may use your chats to improve its products.</p>
      </div>
    </div>
  );
}

type Spend = { left: number; max: number; resetAt: string | null };

/* In the model menu: the key button and how many free messages are left */
export function KeyAndLimits() {
  const [has, setHas] = useState(false);
  const [lim, setLim] = useState<{ buddy?: Spend; kodra?: Spend }>({});
  useEffect(() => {
    setHas(!!getGeminiKey());
    fetch("/api/limits").then((r) => r.json()).then((j) => setLim(j || {})).catch(() => {});
  }, []);
  const line = (name: string, s?: Spend) => (s ? name + ": " + s.left + " of " + s.max + " left" + (s.left < s.max && s.resetAt ? " · more in " + until(s.resetAt) : "") : "");
  const lines = [line("Buddy", lim.buddy), line("Kodra", lim.kodra)].filter(Boolean);
  return (
    <div className="mbk-pick">
      <button type="button" onClick={openKeyWindow}>{has ? "🔑 Gemini key added · change" : "🔑 Add your free Gemini key"}</button>
      {lines.length > 0 && <small>{lines.join("\n") + "\nEdura: no limit"}</small>}
    </div>
  );
}

const MBK_CSS = [
  ".mbk-back{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:20px;background:rgba(10,12,6,.55);backdrop-filter:blur(6px)}",
  ".mbk{position:relative;width:min(460px,100%);padding:26px 26px 20px;border-radius:18px;background:#fbfeea;color:#1d2012;box-shadow:0 24px 60px rgba(0,0,0,.35);font-size:14px;line-height:1.5}",
  ".mbk h2{margin:0 0 4px;font-size:20px}",
  ".mbk-sub{margin:0 0 14px;opacity:.75}",
  ".mbk ol{margin:0 0 16px;padding-left:20px}",
  ".mbk li{margin:4px 0}",
  ".mbk a{color:#4c5038;font-weight:600;text-decoration:underline}",
  ".mbk-row{display:flex;gap:8px}",
  ".mbk-row input{flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid rgba(29,32,18,.25);background:#fff;color:inherit;font:inherit}",
  ".mbk-eye,.mbk-ghost{padding:9px 14px;border-radius:10px;border:1px solid rgba(29,32,18,.25);background:transparent;color:inherit;font:inherit;cursor:pointer}",
  ".mbk-err{margin:8px 0 0;color:#b42318;font-size:13px}",
  ".mbk-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}",
  ".mbk-go{padding:10px 18px;border-radius:999px;border:0;background:#1d2012;color:#c4ff2e;font:inherit;font-weight:600;cursor:pointer}",
  ".mbk-go:disabled{opacity:.5;cursor:default}",
  ".mbk-note{margin:14px 0 0;font-size:12px;opacity:.65}",
  ".mbk-x{position:absolute;top:12px;right:14px;border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:inherit;opacity:.6}",
  ".mbk-pick{padding:8px 10px;border-top:1px solid rgba(127,127,127,.18);display:grid;gap:4px}",
  ".mbk-pick button{border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:600;text-align:left;cursor:pointer;padding:4px 2px}",
  ".mbk-pick small{white-space:pre-line;font-size:11.5px;opacity:.65;padding:0 2px}",
].join("");
