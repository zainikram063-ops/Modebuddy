// Live's little sounds: a bright chime when a task is done, a soft low one if it didn't work
let ctx: AudioContext | null = null;
export function chime(kind: "done" | "fail") {
  try {
    const c = (ctx = ctx || new AudioContext());
    (kind === "done" ? [784, 1175] : [392, 311]).forEach((freq, i) => {
      const t = c.currentTime + i * 0.11;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch { /* no sound, that's fine */ }
}
