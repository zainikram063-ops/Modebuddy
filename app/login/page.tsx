"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VERSION } from "@/lib/version";
import Starfield, { type StarfieldHandle } from "@/components/Starfield";
import { Icon } from "@/components/Icons";

const WORDS = ["Say less.", "Get more.", "Your models.", "Your modes.", "Your memory."];
const KEYS = [
  { c: "⌥", x: "10%", y: "16%", d: 34, cls: "lime", delay: "0s", rot: "8deg" },
  { c: "2", x: "82%", y: "12%", d: -22, cls: "", delay: "-2s", rot: "-6deg" },
  { c: "↵", x: "7%", y: "70%", d: -38, cls: "dark", delay: "-4s", rot: "5deg" },
  { c: "K", x: "88%", y: "56%", d: 26, cls: "lime", delay: "-1s", rot: "-9deg" },
  { c: "⌘", x: "24%", y: "88%", d: 16, cls: "", delay: "-3s", rot: "7deg" },
];

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const stars = useRef<StarfieldHandle>(null);
  const root = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "google" | "email">(null);
  const [msg, setMsg] = useState<{ t: "err" | "ok"; s: string } | null>(params.get("error") ? { t: "err", s: "Sign-in failed. Please try again." } : null);
  const [word, setWord] = useState(0);
  const [warping, setWarping] = useState(false);

  useEffect(() => { const t = setInterval(() => setWord((w) => (w + 1) % WORDS.length), 2200); return () => clearInterval(t); }, []);
  useEffect(() => {
    const el = root.current; if (!el) return;
    const h = (e: PointerEvent) => {
      el.style.setProperty("--mx", String(e.clientX / innerWidth - 0.5));
      el.style.setProperty("--my", String(e.clientY / innerHeight - 0.5));
    };
    addEventListener("pointermove", h);
    return () => removeEventListener("pointermove", h);
  }, []);

  const warpThen = (fn: () => void) => { setWarping(true); stars.current?.warp(); setTimeout(fn, 900); };
  const abortWarp = () => { setWarping(false); stars.current?.calm(); };
  const switchView = (v: typeof view) => { setView(v); setMsg(null); };

  const google = () => {
    setBusy("google"); setMsg(null);
    warpThen(async () => {
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });
      if (error) { abortWarp(); setBusy(null); setMsg({ t: "err", s: error.message }); }
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null); setBusy("email");
    try {
      if (view === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?next=/reset` });
        if (error) throw error;
        setMsg({ t: "ok", s: "Check your inbox for a reset link." });
        return;
      }
      if (view === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name.trim() || undefined }, emailRedirectTo: `${location.origin}/auth/callback` },
        });
        if (error) throw error;
        if (!data.session) { setMsg({ t: "ok", s: "Almost there. Confirm your email, then sign in." }); return; }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      warpThen(() => { router.replace("/"); router.refresh(); });
    } catch (err) {
      setMsg({ t: "err", s: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={root} className={`login ${warping ? "warping" : ""}`}>
      <Starfield ref={stars} />
      <div className="nebula" aria-hidden />
      <div className="planet-wrap" aria-hidden><div className="ring r2" /><div className="planet" /><div className="ring" /></div>
      {KEYS.map((k) => (
        <div key={k.c} className="fk-wrap" aria-hidden style={{ left: k.x, top: k.y, "--d": k.d } as CSSProperties}>
          <div className={`fk ${k.cls}`} style={{ "--delay": k.delay, "--rot": k.rot } as CSSProperties}>{k.c}</div>
        </div>
      ))}

      <div className="login-card">
        <div className="lc-brand"><span className="brand-key"><img src="/logos/buddy.png" alt="ModeBuddy" className="brand-logo" /></span>modebuddy<span className="lc-ver">{VERSION.family} {VERSION.number}</span></div>
        <h1>{view === "signup" ? "Create your account" : view === "reset" ? "Reset password" : "Welcome back"}</h1>
        <p className="lc-sub"><span key={word} className="word">{WORDS[word]}</span></p>

        {view !== "reset" && (
          <>
            <button className="g-btn" onClick={google} disabled={!!busy}><GoogleLogo />{busy === "google" ? "Opening Google…" : "Continue with Google"}</button>
            <div className="or"><span>or</span></div>
          </>
        )}

        <form onSubmit={submit} className="lc-form">
          {view === "signup" && (
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Ada Lovelace" /></label>
          )}
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@domain.com" /></label>
          {view !== "reset" && (
            <label>
              <span className="lab-row">Password{view === "signin" && <button type="button" className="link" onClick={() => switchView("reset")}>Forgot?</button>}</span>
              <input type="password" required minLength={view === "signup" ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={view === "signup" ? "new-password" : "current-password"} placeholder={view === "signup" ? "8+ characters" : "••••••••"} />
            </label>
          )}
          {msg && <div className={`lc-msg ${msg.t}`} role={msg.t === "err" ? "alert" : "status"}>{msg.s}</div>}
          <button className="lc-primary" disabled={!!busy}>
            {busy === "email" ? <span className="spin" /> : <>{view === "signup" ? "Create account" : view === "reset" ? "Send reset link" : "Sign in"}<Icon name="send" size={16} /></>}
          </button>
        </form>

        <p className="lc-switch">
          {view === "signin"
            ? <>New here? <button className="link" onClick={() => switchView("signup")}>Create an account</button></>
            : <>Have an account? <button className="link" onClick={() => switchView("signin")}>Sign in</button></>}
        </p>
      </div>
      <p className="lc-foot">By continuing you agree to the Terms and Privacy Policy.</p>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className="login" />}><LoginInner /></Suspense>;
}
