"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg(error.message);
    router.replace("/");
  };

  return (
    <div className="login">
      <div className="login-card">
        <div className="lc-brand"><span className="brand-key">⌥</span>modebuddy</div>
        <h1>New password</h1>
        <p className="lc-sub">Make it a good one.</p>
        <form className="lc-form" onSubmit={submit} style={{ marginTop: 20 }}>
          <label>Password<input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
          {msg && <div className="lc-msg err">{msg}</div>}
          <button className="lc-primary" disabled={busy}>{busy ? <span className="spin" /> : "Save password"}</button>
        </form>
      </div>
    </div>
  );
}
