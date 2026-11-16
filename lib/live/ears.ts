// Live "ears": while you talk, your voice streams to Google and comes back as text,
// so the smart model can start answering the moment you let go.
import { pcm16 } from "./audio";

type Pass = { token?: string; models?: string[]; system?: string } | null;
type Session = { sendRealtimeInput: (x: object) => void; close: () => void };
type Msg = { setupComplete?: unknown; serverContent?: { inputTranscription?: { text?: string; finished?: boolean }; modelTurn?: unknown; turnComplete?: boolean; generationComplete?: boolean } };

export type Ears = {
  hear: (sound: Float32Array, rate: number) => void;
  /** Your words, or "" if the ears missed them (then ModeBuddy sends the recording instead) */
  finish: () => Promise<string>;
  close: () => void;
};

function openGoogleEars(pass: Promise<Pass>): Ears {
  let s: Session | null = null;
  let ready = false, dead = false, final = false, replied = false;
  let words = "", lastWord = 0;
  let poke: (() => void) | null = null;
  const queue: object[] = [];
  const send = (x: object) => {
    if (dead) return;
    if (!ready || !s) { queue.push(x); return; }
    try { s.sendRealtimeInput(x); } catch { dead = true; }
  };
  const close = () => {
    dead = true;
    ready = false;
    queue.length = 0;
    try { s?.close(); } catch { /* already closed */ }
    s = null;
  };

  send({ activityStart: {} });
  async function connect() {
    const p = await pass;
    if (!p?.token || dead) throw new Error("no pass");
    const { GoogleGenAI, Modality } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: p.token, httpOptions: { apiVersion: "v1alpha" } });
    for (const model of p.models || []) {
      if (dead) return;
      const ok = await new Promise<boolean>((done) => {
        let opened = false;
        const timer = window.setTimeout(() => done(false), 4000);
        const fail = () => { if (!opened) { window.clearTimeout(timer); done(false); } else { dead = true; poke?.(); } };
        ai.live.connect({
          model,
          config: { responseModalities: [/native-audio/.test(model) ? Modality.AUDIO : Modality.TEXT], systemInstruction: p.system || "", inputAudioTranscription: {}, realtimeInputConfig: { automaticActivityDetection: { disabled: true } } },
          callbacks: {
            onmessage: (raw: unknown) => {
              const m = raw as Msg, c = m.serverContent;
              if (m.setupComplete && !opened) { opened = true; window.clearTimeout(timer); done(true); }
              if (c?.inputTranscription?.text) { words += c.inputTranscription.text; lastWord = Date.now(); }
              if (c?.inputTranscription?.finished) final = true;
              if (c?.modelTurn || c?.turnComplete || c?.generationComplete) replied = true;
              poke?.();
            },
            onerror: fail,
            onclose: fail,
          },
        }).then((x) => { s = x as unknown as Session; }).catch(() => { window.clearTimeout(timer); done(false); });
      });
      for (let i = 0; ok && i < 20 && !s; i++) await new Promise((r) => setTimeout(r, 50));
      if (ok && s) break;
      try { s?.close(); } catch { /* ignore */ }
      s = null;
    }
    if (!s || dead) throw new Error("no connection");
    ready = true;
    for (const x of queue.splice(0)) s.sendRealtimeInput(x);
  }
  connect().catch(() => { close(); poke?.(); });

  return {
    hear: (sound, rate) => send({ audio: { data: pcm16(sound), mimeType: "audio/pcm;rate=" + rate } }),
    finish: () => new Promise<string>((resolve) => {
      // Not connected yet: don't wait, ModeBuddy sends the recording instead
      if (!ready || dead) { close(); resolve(""); return; }
      send({ activityEnd: {} });
      const t0 = Date.now();
      let iv = 0, over = false;
      const end = () => {
        if (over) return;
        over = true;
        window.clearInterval(iv);
        poke = null;
        close();
        resolve(words.replace(/\s+/g, " ").trim());
      };
      // Done when Google says the words are final, or starts replying (that means it heard everything)
      poke = () => { if (dead || final) end(); else if (replied) window.setTimeout(end, 60); };
      iv = window.setInterval(() => {
        const t = Date.now() - t0;
        if (t > 1500 || (words && t > 300 && Date.now() - Math.max(lastWord, t0) > 350)) end();
      }, 40);
    }),
    close,
  };
}

// Phase 3: Apple speech-to-text from the Mac app. Whichever has your words first wins: Apple's (usually
// about 0.2s after you let go) or Google's. Without the Mac helper, Google's ears work as before.
const local = { words: "", final: false, poke: null as (() => void) | null };
if (typeof window !== "undefined") {
  (window as unknown as { __mbWords?: (line: string) => void }).__mbWords = (line: string) => {
    try {
      const m = JSON.parse(line) as { partial?: string; final?: string };
      if (typeof m.partial === "string") local.words = m.partial;
      if (typeof m.final === "string") { if (m.final) local.words = m.final; local.final = true; }
      local.poke?.();
    } catch { /* not for us */ }
  };
}

export function openEars(pass: Promise<Pass>): Ears {
  local.words = "";
  local.final = false;
  const g = openGoogleEars(pass);
  return {
    hear: (...a: Parameters<Ears["hear"]>) => g.hear(...a),
    close: () => g.close(),
    finish: () => new Promise<string>((resolve) => {
      const t0 = Date.now();
      let done = false, gw = "", gDone = false;
      const end = (w: string) => { if (done) return; done = true; local.poke = null; clearInterval(iv); resolve(w.trim()); };
      const check = () => {
        const t = Date.now() - t0;
        if (local.final && local.words.trim()) return end(local.words);
        if (gDone && gw.trim()) return end(gw);
        if ((gDone && (local.final || t > 900)) || t > 1600) end(local.words || gw);
      };
      g.finish().then((w) => { gw = w; gDone = true; check(); }, () => { gDone = true; check(); });
      local.poke = check;
      const iv = setInterval(check, 40);
      check();
    }),
  };
}
