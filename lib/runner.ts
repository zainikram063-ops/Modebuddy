export type RunOut = { kind: "log" | "info" | "warn" | "error" | "result" | "system"; text: string };
export type RunHandle = { stop: () => void };
type Cb = { onOut: (o: RunOut) => void; onDone: (ok: boolean, ms: number) => void };

const blobWorker = (src: string) => new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));

/* ---------- JavaScript / TypeScript sandbox ---------- */
const JS_WORKER = `
const fmt = (v) => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return (v.name || "Error") + ": " + v.message;
  if (typeof v === "function") return "[Function " + (v.name || "anonymous") + "]";
  if (v === undefined) return "undefined";
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "symbol") return v.toString();
  try {
    const seen = new WeakSet();
    return JSON.stringify(v, function (k, x) {
      if (typeof x === "bigint") return x + "n";
      if (typeof x === "function") return "[Function]";
      if (x instanceof Map) return Object.fromEntries(x);
      if (x instanceof Set) return Array.from(x);
      if (x && typeof x === "object") { if (seen.has(x)) return "[Circular]"; seen.add(x); }
      return x;
    }, 2);
  } catch (e) { return String(v); }
};
const where = (e) => {
  const m = /<anonymous>:(\\d+):(\\d+)/.exec((e && e.stack) || "");
  return m ? " (line " + (Number(m[1]) - 2) + ")" : "";
};
const send = (kind, args) => postMessage({ kind: kind, text: args.map(fmt).join(" ") });
console.log = (...a) => send("log", a);
console.debug = (...a) => send("log", a);
console.info = (...a) => send("info", a);
console.warn = (...a) => send("warn", a);
console.error = (...a) => send("error", a);
console.table = (d) => send("log", [d]);
console.dir = (d) => send("log", [d]);
self.addEventListener("unhandledrejection", (e) => send("error", ["Unhandled promise rejection: " + fmt(e.reason)]));
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  try {
    const u = new URL(typeof input === "string" ? input : input.url, self.location.origin + "/");
    if (u.origin === self.location.origin) return Promise.reject(new Error("Run can't call ModeBuddy's own server."));
  } catch (e) {}
  return realFetch(input, init);
};
self.XMLHttpRequest = function () { throw new Error("Use fetch() instead of XMLHttpRequest."); };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
self.onmessage = async (e) => {
  const t = performance.now();
  try {
    const r = await new AsyncFunction(e.data.code)();
    if (r !== undefined) send("result", [r]);
    postMessage({ done: true, ok: true, ms: performance.now() - t });
  } catch (err) {
    send("error", [fmt(err) + where(err)]);
    postMessage({ done: true, ok: false, ms: performance.now() - t });
  }
};
`;

function runJs(kind: "js" | "ts", code: string, cb: Cb): RunHandle {
  let w: Worker | null = null;
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = (ok: boolean, ms: number) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    cb.onDone(ok, ms);
    const dead = w;
    setTimeout(() => dead?.terminate(), 3000); // let late setTimeout logs arrive
  };

  (async () => {
    let src = code;
    if (kind === "ts") {
      try {
        const { transform } = await import("sucrase");
        src = transform(code, { transforms: ["typescript"], disableESTransforms: true }).code;
      } catch (e) {
        cb.onOut({ kind: "error", text: `TypeScript error: ${(e as Error).message}` });
        return end(false, 0);
      }
    }
    if (/^\s*import\s+[^(\s]/m.test(src)) {
      cb.onOut({ kind: "error", text: "Run can't load imports. Remove the import lines, or ask for a version without dependencies." });
      return end(false, 0);
    }
    src = src.replace(/^(\s*)export\s+(default\s+)?/gm, "$1");
    if (finished) return;

    w = blobWorker(JS_WORKER);
    w.onmessage = (e) => {
      const d = e.data;
      if (d?.done) end(!!d.ok, d.ms ?? 0);
      else if (d?.kind) cb.onOut({ kind: d.kind, text: String(d.text ?? "") });
    };
    w.onerror = (e) => { cb.onOut({ kind: "error", text: e.message || "Script error." }); end(false, 0); };
    timer = setTimeout(() => {
      if (finished) return;
      cb.onOut({ kind: "system", text: "Stopped after 10 s. Is there an infinite loop?" });
      w?.terminate();
      end(false, 10_000);
    }, 10_000);
    w.postMessage({ code: src });
  })();

  return { stop: () => { finished = true; clearTimeout(timer); w?.terminate(); } };
}

/* ---------- Python (Pyodide, loads once then stays warm) ---------- */
const PY_WORKER = `
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
let py = null;
let cur = 0;
const boot = loadPyodide().then((p) => {
  py = p;
  p.setStdout({ batched: (s) => postMessage({ id: cur, kind: "log", text: s }) });
  p.setStderr({ batched: (s) => postMessage({ id: cur, kind: "warn", text: s }) });
  postMessage({ ready: true });
});
const tidy = (msg) => {
  const lines = String(msg).split("\\n");
  const i = lines.findIndex((l) => l.includes('File "<exec>"'));
  return (i > 0 ? ["Traceback (most recent call last):"].concat(lines.slice(i)) : lines).join("\\n").trim();
};
async function run(data) {
  cur = data.id;
  try { await boot; } catch (err) {
    postMessage({ id: data.id, kind: "error", text: "Couldn't load Python: " + err });
    postMessage({ id: data.id, done: true, ok: false, ms: 0 });
    return;
  }
  const t = performance.now();
  let ns = null;
  try {
    await py.loadPackagesFromImports(data.code, {
      messageCallback: (m) => postMessage({ id: data.id, kind: "system", text: m }),
      errorCallback: (m) => postMessage({ id: data.id, kind: "warn", text: m }),
    });
    ns = py.globals.get("dict")();
    const r = await py.runPythonAsync(data.code, { globals: ns });
    if (r !== undefined && r !== null) {
      postMessage({ id: data.id, kind: "result", text: String(r) });
      if (r.destroy) r.destroy();
    }
    postMessage({ id: data.id, done: true, ok: true, ms: performance.now() - t });
  } catch (err) {
    postMessage({ id: data.id, kind: "error", text: tidy((err && err.message) || err) });
    postMessage({ id: data.id, done: true, ok: false, ms: performance.now() - t });
  } finally {
    if (ns && ns.destroy) ns.destroy();
  }
}
let chain = Promise.resolve();
self.onmessage = (e) => { chain = chain.then(() => run(e.data)); };
`;

let py: { w: Worker; ready: boolean } | null = null;
let seq = 0;

function runPython(code: string, cb: Cb): RunHandle {
  if (!py) {
    const p = { w: blobWorker(PY_WORKER), ready: false };
    p.w.addEventListener("message", (e) => { if (e.data?.ready) p.ready = true; });
    py = p;
  }
  const p = py;
  const id = ++seq;
  let finished = false;
  if (!p.ready) cb.onOut({ kind: "system", text: "Loading Python… first run only (about 10 MB), then it's instant." });

  const kill = () => { p.w.terminate(); if (py === p) py = null; };
  const finish = (ok: boolean, ms: number) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    p.w.removeEventListener("message", onMsg);
    p.w.removeEventListener("error", onErr);
    cb.onDone(ok, ms);
  };
  const onMsg = (e: MessageEvent) => {
    const d = e.data;
    if (d?.id !== id) return;
    if (d.done) finish(!!d.ok, d.ms ?? 0);
    else cb.onOut({ kind: d.kind, text: String(d.text ?? "") });
  };
  const onErr = (e: ErrorEvent) => { cb.onOut({ kind: "error", text: e.message || "Python crashed." }); kill(); finish(false, 0); };
  p.w.addEventListener("message", onMsg);
  p.w.addEventListener("error", onErr);
  const timer = setTimeout(() => {
    cb.onOut({ kind: "system", text: "Stopped after 60 s. Is there an infinite loop?" });
    kill();
    finish(false, 60_000);
  }, 60_000);
  p.w.postMessage({ id, code });

  return { stop: () => { if (finished) return; finished = true; clearTimeout(timer); kill(); } };
}

export function runCode(kind: "js" | "ts" | "py", code: string, cb: Cb): RunHandle {
  return kind === "py" ? runPython(code, cb) : runJs(kind, code, cb);
}
