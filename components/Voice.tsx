"use client";

import { useEffect, useRef, useState } from "react";

/* ---------- Speech recognition (mic) ---------- */
type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SREvent = { results: { length: number; [i: number]: SRResult } };
type SR = {
  lang: string; interimResults: boolean; continuous: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type SRCtor = new () => SR;

const getSR = (): SRCtor | undefined => {
  if (typeof window === "undefined") return;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

type MicProps = {
  getBase: () => string;
  onText: (t: string) => void;
  onFinal: (t: string) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
};

export function MicButton({ getBase, onText, onFinal, onError, disabled }: MicProps) {
  const [ok, setOk] = useState(false);
  const [on, setOn] = useState(false);
  const rec = useRef<SR | null>(null);

  useEffect(() => { setOk(!!getSR()); }, []);
  useEffect(() => () => rec.current?.abort(), []);

  if (!ok) return null;

  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const C = getSR();
    if (!C) return;
    stopSpeaking();
    const r = new C();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    const base = getBase().trim();
    let finalText = "";

    r.onresult = (e) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      onText([base, (finalText + interim).trim()].filter(Boolean).join(" "));
    };
    r.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      onError?.(e.error === "not-allowed" ? "Microphone access is blocked. Allow it in your browser settings." : `Voice error: ${e.error}`);
    };
    r.onend = () => {
      setOn(false);
      rec.current = null;
      const said = finalText.trim();
      if (said) onFinal([base, said].filter(Boolean).join(" "));
    };

    rec.current = r;
    r.start();
    setOn(true);
  };

  return (
    <button type="button" className={`tool mic ${on ? "on" : ""}`} onClick={toggle} disabled={disabled}
      title={on ? "Stop listening" : "Talk to ModeBuddy"} aria-pressed={on}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" />
      </svg>
    </button>
  );
}

/* ---------- Speech synthesis (read aloud) ---------- */
const hasTTS = () => typeof window !== "undefined" && "speechSynthesis" in window;
if (hasTTS()) window.speechSynthesis.getVoices(); // warm up voice list

export function cleanForSpeech(md: string) {
  return md
    .replace(/<followups>[\s\S]*?(<\/followups>|$)/gi, "")
    .replace(/```[\s\S]*?```/g, " I've put the code on screen. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickVoice() {
  const vs = window.speechSynthesis.getVoices();
  const lang = (navigator.language || "en").slice(0, 2);
  if (lang === "en") {
    for (const n of ["Samantha", "Ava", "Google US English", "Microsoft Aria", "Daniel", "Karen"]) {
      const v = vs.find((x) => x.name.includes(n));
      if (v) return v;
    }
  }
  return vs.find((v) => v.lang.startsWith(lang) && v.localService) ?? vs.find((v) => v.lang.startsWith(lang));
}

export function stopSpeaking() { if (hasTTS()) window.speechSynthesis.cancel(); }

export function speak(md: string, onDone?: () => void) {
  if (!hasTTS()) { onDone?.(); return; }
  window.speechSynthesis.cancel();
  const text = cleanForSpeech(md);
  if (!text) { onDone?.(); return; }

  // Chrome cuts off long utterances, so speak in chunks
  const chunks = (text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]).reduce<string[]>((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && (last + s).length < 220) acc[acc.length - 1] = last + s; else acc.push(s);
    return acc;
  }, []);

  const voice = pickVoice();
  let finished = false;
  const finish = () => { if (!finished) { finished = true; onDone?.(); } };

  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c.trim());
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.onerror = finish;
    if (i === chunks.length - 1) u.onend = finish;
    window.speechSynthesis.speak(u);
  });
}

export function SpeakButton({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  return (
    <button
      onClick={() => {
        if (on) { stopSpeaking(); setOn(false); return; }
        setOn(true);
        speak(text, () => setOn(false));
      }}
      title={on ? "Stop reading" : "Read aloud"}
      className={on ? "speaking" : ""}
    >
      {on ? (
        <span className="mb-bars" aria-hidden><i /><i /><i /></span>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a9 9 0 0 1 0 14" />
        </svg>
      )}
    </button>
  );
}
