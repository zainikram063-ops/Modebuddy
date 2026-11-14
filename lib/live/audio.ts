// Live: microphone, sound and screenshot helpers
export const RATE = 16000;

// The whole recording as a WAV file, made a bit louder if you spoke quietly
export function wav(chunks: Float32Array[]) {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  let peak = 0;
  for (const c of chunks) for (let i = 0; i < c.length; i += 4) peak = Math.max(peak, Math.abs(c[i]));
  const g = peak > 0.01 ? Math.min(6, 0.9 / peak) : 1;
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++) { const s = Math.max(-1, Math.min(1, c[i] * g)); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(v.buffer);
}

export function b64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return btoa(s);
}

// One small piece of sound as 16-bit audio, for the live ears
export function pcm16(f: Float32Array) {
  const b = new Uint8Array(f.length * 2);
  const v = new DataView(b.buffer);
  for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); v.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  let bin = "";
  for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(bin);
}

// Makes the screenshot smaller so it uploads fast
export function shrink(img64: string, max = 1024, q = 0.55): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      const g = c.getContext("2d");
      if (!g) { reject(new Error("no canvas")); return; }
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", q).split(",")[1] || img64);
    };
    img.onerror = () => reject(new Error("bad image"));
    img.src = "data:image/jpeg;base64," + img64;
  });
}

export type Mic = { stop: () => { secs: number; chunks: Float32Array[] } };

// Starts the mic. About every 64 ms it hands the new sound to onSound, and the 7 bar heights to onLevels.
export async function startMic(onSound: (d: Float32Array, rate: number) => void, onLevels: (bars: number[], level: number) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: RATE });
  await ctx.resume().catch(() => {});
  const node = ctx.createScriptProcessor(1024, 1, 1);
  const chunks: Float32Array[] = [];
  const t0 = performance.now();
  node.onaudioprocess = (ev) => {
    const d = new Float32Array(ev.inputBuffer.getChannelData(0));
    chunks.push(d);
    onSound(d, ev.inputBuffer.sampleRate);
    const w = Math.floor(d.length / 7), bars: number[] = [];
    for (let k = 0; k < 7; k++) { let s = 0; for (let j = k * w; j < (k + 1) * w; j += 4) s += d[j] * d[j]; bars.push(Math.min(1, Math.sqrt(s / (w / 4)) * 7)); }
    let s = 0;
    for (let i = 0; i < d.length; i += 8) s += d[i] * d[i];
    onLevels(bars, Math.min(1, Math.sqrt(s / (d.length / 8)) * 6));
  };
  ctx.createMediaStreamSource(stream).connect(node);
  node.connect(ctx.destination);
  return {
    stop: () => {
      node.onaudioprocess = null;
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      return { secs: (performance.now() - t0) / 1000, chunks };
    },
  };
}
