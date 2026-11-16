// Live reflexes on your Mac: simple commands are answered right here, with no internet round trip.
// It steps in when the Live panel is about to ask the server, and only for commands it is sure about.
import { reflex } from "./reflex";

type Routine = { name: string; triggers?: string[] };
let routines: Routine[] = [];
let loaded = 0;
// Your routines, so "start everything up" also works instantly (refreshed every 5 minutes)
function loadRoutines() {
  if (Date.now() - loaded < 300000) return;
  loaded = Date.now();
  fetch("/api/live/learn", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((m: { routines?: Routine[] } | null) => { if (m && Array.isArray(m.routines)) routines = m.routines; }).catch(() => {});
}

const w = typeof window !== "undefined" ? (window as unknown as { mbLocal?: boolean }) : null;
if (w && !w.mbLocal) {
  w.mbLocal = true;
  loadRoutines();
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (String(init?.method || "").toUpperCase() === "POST" && /\/api\/live$/.test(url.split("?")[0]) && typeof init?.body === "string") {
      try {
        const b = JSON.parse(init.body) as { text?: string; installed?: string[]; log?: boolean };
        const words = String(b.text || "").trim();
        const hit = !b.log && words ? reflex(words, Array.isArray(b.installed) ? b.installed : [], routines) : null;
        loadRoutines();
        if (hit) {
          const full = (hit.use ? `SAY: ${hit.say}\nUSE: ${hit.use}\n` : `SAY: ${hit.say}\nDO: ${JSON.stringify(hit.steps || [])}\n`) + `---\n${hit.say}`;
          // Saved to Live history in the background
          real("/api/live", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ log: true, text: words, answer: full }) }).catch(() => {});
          return new Response(full, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Live-Model": "reflex" } });
        }
      } catch { /* not a simple command: ask the server as normal */ }
    }
    return real(input, init);
  };
}
