export type RunOut = { kind: "log" | "info" | "warn" | "error" | "result" | "system" | "pass" | "fail"; text: string };
export type RunHandle = { stop: () => void };
type Cb = { onOut: (o: RunOut) => void; onDone: (ok: boolean, ms: number) => void };

const blobWorker = (src: string) => new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));

/* ---------- JavaScript / TypeScript sandbox (with a small Jest-style test runner) ---------- */
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
const show = (v) => (typeof v === "string" ? JSON.stringify(v) : fmt(v));
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

/* ---- tests ---- */
const msgOf = (e) => (e && e.message !== undefined ? String(e.message) : String(e));
const errMatches = (e, m) =>
  m === undefined || (m instanceof RegExp ? m.test(msgOf(e)) : typeof m === "function" ? e instanceof m : msgOf(e).includes(String(m)));
const assertFail = (msg) => { const e = new Error(msg); e.name = "AssertionError"; throw e; };
const deepEq = (a, b, seen = new Map()) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (seen.get(a) === b) return true;
  seen.set(a, b);
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (a instanceof RegExp || b instanceof RegExp) return String(a) === String(b);
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEq(v, b.get(k), seen)) return false;
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq(a[k], b[k], seen));
};
function matchers(actual, neg) {
  const check = (pass, msg) => { if (!!pass === neg) assertFail((neg ? "expected NOT: " : "") + msg); };
  const a = show(actual);
  const m = {
    toBe: (x) => check(Object.is(actual, x), "expected " + a + " to be " + show(x)),
    toEqual: (x) => check(deepEq(actual, x), "expected " + a + " to equal " + show(x)),
    toStrictEqual: (x) => check(deepEq(actual, x), "expected " + a + " to equal " + show(x)),
    toBeTruthy: () => check(!!actual, "expected " + a + " to be truthy"),
    toBeFalsy: () => check(!actual, "expected " + a + " to be falsy"),
    toBeNull: () => check(actual === null, "expected " + a + " to be null"),
    toBeUndefined: () => check(actual === undefined, "expected " + a + " to be undefined"),
    toBeDefined: () => check(actual !== undefined, "expected a defined value"),
    toBeNaN: () => check(Number.isNaN(actual), "expected " + a + " to be NaN"),
    toContain: (x) => check(actual != null && (typeof actual === "string" ? actual.includes(x) : Array.from(actual).some((v) => Object.is(v, x))), "expected " + a + " to contain " + show(x)),
    toContainEqual: (x) => check(actual != null && Array.from(actual).some((v) => deepEq(v, x)), "expected " + a + " to contain " + show(x)),
    toHaveLength: (n) => check(actual != null && actual.length === n, "expected length " + n + ", got " + (actual == null ? actual : actual.length)),
    toBeGreaterThan: (n) => check(actual > n, "expected " + a + " > " + show(n)),
    toBeGreaterThanOrEqual: (n) => check(actual >= n, "expected " + a + " >= " + show(n)),
    toBeLessThan: (n) => check(actual < n, "expected " + a + " < " + show(n)),
    toBeLessThanOrEqual: (n) => check(actual <= n, "expected " + a + " <= " + show(n)),
    toBeCloseTo: (n, d = 2) => check(Math.abs(actual - n) < Math.pow(10, -d) / 2, "expected " + a + " to be close to " + show(n)),
    toMatch: (re) => check(typeof actual === "string" && (re instanceof RegExp ? re.test(actual) : actual.includes(re)), "expected " + a + " to match " + String(re)),
    toBeInstanceOf: (C) => check(actual instanceof C, "expected " + a + " to be an instance of " + (C && C.name)),
    toHaveProperty: (p, ...v) => {
      const path = Array.isArray(p) ? p : String(p).split(".");
      let o = actual, ok = true;
      for (const k of path) { if (o == null || !(k in Object(o))) { ok = false; break; } o = o[k]; }
      check(ok && (!v.length || deepEq(o, v[0])), "expected " + a + " to have property " + String(p) + (v.length ? " = " + show(v[0]) : ""));
    },
    toThrow: (x) => {
      if (typeof actual !== "function") assertFail("toThrow needs a function, e.g. expect(() => fn()).toThrow()");
      let err = null, threw = false;
      try { actual(); } catch (e) { threw = true; err = e; }
      check(threw && errMatches(err, x), threw ? "expected an error matching " + show(x) + ", got " + show(msgOf(err)) : "expected the function to throw");
    },
  };
  m.toThrowError = m.toThrow;
  return m;
}
const expect = (actual) => {
  const m = matchers(actual, false);
  m.not = matchers(actual, true);
  m.resolves = new Proxy({}, { get: (_, k) => async (...args) => matchers(await actual, false)[k](...args) });
  m.rejects = new Proxy({}, {
    get: (_, k) => async (...args) => {
      let err, threw = false;
      try { await actual; } catch (e) { threw = true; err = e; }
      if (!threw) assertFail("expected the promise to reject");
      if (k === "toThrow" || k === "toThrowError") {
        if (!errMatches(err, args[0])) assertFail("expected a rejection matching " + show(args[0]) + ", got " + show(msgOf(err)));
        return;
      }
      return matchers(err, false)[k](...args);
    },
  });
  return m;
};
const __tests = [], __before = [], __after = [], __path = [];
const test = (name, fn) => { __tests.push({ name: __path.concat(String(name)).join(" › "), fn: fn }); };
test.skip = () => {};
test.todo = () => {};
test.only = test;
const describe = (name, fn) => { __path.push(String(name)); try { fn(); } finally { __path.pop(); } };
describe.skip = () => {};
describe.only = describe;
self.test = test;
self.it = test;
self.describe = describe;
self.expect = expect;
self.beforeEach = (f) => { __before.push(f); };
self.afterEach = (f) => { __after.push(f); };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
self.onmessage = async (e) => {
  const t = performance.now();
  try {
    const r = await new AsyncFunction(e.data.code)();
    if (r !== undefined) send("result", [r]);
    if (__tests.length) {
      let failed = 0;
      for (const tc of __tests) {
        try {
          for (const f of __before) await f();
          await tc.fn();
          for (const f of __after) await f();
          postMessage({ kind: "pass", text: tc.name });
        } catch (err) {
          failed++;
          postMessage({ kind: "fail", text: tc.name + " — " + msgOf(err) });
        }
      }
      postMessage({ done: true, ok: failed === 0, ms: performance.now() - t });
      return;
    }
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

/* ---------- Python (Pyodide, loads once then stays warm; runs test_ functions automatically) ---------- */
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
const PY_TESTS = [
  "def __mb_tests():",
  "    out = []",
  "    for name, fn in list(globals().items()):",
  "        if name.startswith('test_') and callable(fn):",
  "            try:",
  "                fn()",
  "                out.append([name, True, ''])",
  "            except AssertionError as e:",
  "                tb = e.__traceback__",
  "                while tb.tb_next:",
  "                    tb = tb.tb_next",
  "                out.append([name, False, (str(e) or 'assertion failed') + ' (line ' + str(tb.tb_lineno) + ')'])",
  "            except Exception as e:",
  "                out.append([name, False, type(e).__name__ + ': ' + str(e)])",
  "    return out",
  "__mb_tests()",
].join("\\n");
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
    if (/^\\s*def\\s+test_/m.test(data.code)) {
      const res = await py.runPythonAsync(PY_TESTS, { globals: ns });
      const rows = res.toJs();
      res.destroy();
      let failed = 0;
      for (const [name, ok, msg] of rows) {
        if (!ok) failed++;
        postMessage({ id: data.id, kind: ok ? "pass" : "fail", text: ok ? name : name + " — " + msg });
      }
      postMessage({ id: data.id, done: true, ok: failed === 0, ms: performance.now() - t });
      return;
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
