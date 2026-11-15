// Speaks answers with your ElevenLabs / Fish Audio voice, or the Mac voice if no cloud voice is set up
import { desktop } from "../desktop";

let cloud: boolean | null = null;
let current: HTMLAudioElement | null = null;

// Checks whether a cloud voice is set up, and wakes that part of the server up
export function warmVoice() {
  fetch("/api/live/speak", { cache: "no-store" }).then((r) => { cloud = r.status === 204; }).catch(() => {});
}

// Says the text out loud. onStart runs when the sound starts; onEnd when a cloud voice finishes
// (the Mac voice reports its end with a "spoke" event instead).
export function talk(text: string, onStart?: () => void, onEnd?: () => void) {
  hush();
  const t = sayNames(text).trim().slice(0, 600);
  if (!t) return;
  const mac = () => { void desktop()?.live?.speak(t); onStart?.(); };
  if (cloud === false) { mac(); return; }
  const a = new Audio("/api/live/speak?t=" + encodeURIComponent(t));
  current = a;
  const fallback = () => { if (current !== a) return; current = null; cloud = false; mac(); };
  a.onplaying = () => onStart?.();
  a.onended = () => { if (current === a) { current = null; onEnd?.(); } };
  a.onerror = fallback;
  a.play().catch(fallback);
}

// Say the mode names the way they're meant to sound
function sayNames(s: string) {
  return s.replace(/\bKodra\b/gi, "Koh-dra").replace(/\bEdura\b/gi, "Edu-ra");
}

export function hush() {
  const a = current;
  current = null;
  if (a) { a.onplaying = null; a.onended = null; a.onerror = null; a.pause(); a.removeAttribute("src"); a.load(); }
  void desktop()?.live?.stopSpeaking();
}
