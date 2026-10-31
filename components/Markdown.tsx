"use client";

import { Children, isValidElement, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";
import { Check, ChevronDown, Copy, Download, Eye, FileCode2, FlaskConical, Play, Square, X } from "lucide-react";
import { useArtifact } from "./Artifacts";
import { downloadZip, pathFrom } from "@/lib/files";
import { sendToChat, useCanSend } from "@/lib/chat-bus";
import type { RunHandle, RunOut } from "@/lib/runner";

/* ---------- hast helpers ---------- */
type HNode = {
  type: string; tagName?: string; value?: string;
  properties?: Record<string, unknown>; children?: HNode[]; data?: { meta?: string | null };
};
const hText = (n?: HNode): string => (!n ? "" : n.type === "text" ? n.value ?? "" : (n.children ?? []).map(hText).join(""));
const codeEl = (pre?: HNode) => pre?.children?.find((c) => c.type === "element" && c.tagName === "code");
const langOf = (code?: HNode) => {
  const cls = code?.properties?.className;
  const list = Array.isArray(cls) ? (cls as string[]) : typeof cls === "string" ? cls.split(" ") : [];
  return list.find((c) => c.startsWith("language-"))?.slice(9).toLowerCase() ?? "";
};
const rawOf = (code?: HNode) => hText(code).replace(/\n$/, "");

/* ---------- group back-to-back file blocks into tabs ---------- */
const isFilePre = (n: HNode) => {
  if (n.type !== "element" || n.tagName !== "pre") return false;
  const c = codeEl(n);
  const lang = langOf(c);
  if (lang === "diff" || lang === "patch") return false;
  return !!pathFrom(c?.data?.meta, rawOf(c));
};

function rehypeFileTabs() {
  return (tree: unknown) => {
    const walk = (n: HNode) => {
      if (!n.children) return;
      const out: HNode[] = [];
      let run: HNode[] = [];
      let gap: HNode[] = [];
      const flush = () => {
        if (run.length >= 2) out.push({ type: "element", tagName: "div", properties: { dataFiletabs: "1" }, children: run });
        else out.push(...run);
        out.push(...gap);
        run = [];
        gap = [];
      };
      for (const c of n.children) {
        if (isFilePre(c)) { gap = []; run.push(c); continue; }
        if (c.type === "text" && !(c.value ?? "").trim() && run.length) { gap.push(c); continue; }
        flush();
        walk(c);
        out.push(c);
      }
      flush();
      n.children = out;
    };
    walk(tree as HNode);
  };
}

/* ---------- math ---------- */
const KATEX_OPTS = { throwOnError: false, strict: "ignore" as const, errorColor: "inherit" };
const REMARK: Options["remarkPlugins"] = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];
const REHYPE: Options["rehypePlugins"] = [[rehypeKatex, KATEX_OPTS], rehypeHighlight, rehypeFileTabs];
const REHYPE_INLINE: Options["rehypePlugins"] = [[rehypeKatex, KATEX_OPTS]];

const MATH_HINT = /[\\^_{}=<>]|[a-zA-Z]\d|\d[a-zA-Z]|^[a-zA-Z]$/;

export function normalizeMath(src: string) {
  return src
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) => {
      if (i % 2) return part;
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `\n\n$$\n${m.trim()}\n$$\n\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$$${m.trim()}$$`)
        .replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, m: string) => `$$\n${m.trim()}\n$$`)
        .replace(/(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\w$])/g, (all, m: string) => (MATH_HINT.test(m) ? `$$${m}$$` : all));
    })
    .join("");
}

/* ---------- languages ---------- */
const LANG: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript", mjs: "JavaScript", jsx: "JSX", ts: "TypeScript", typescript: "TypeScript", tsx: "TSX",
  py: "Python", python: "Python", sh: "Shell", bash: "Bash", zsh: "Shell", shell: "Shell", console: "Terminal",
  json: "JSON", html: "HTML", css: "CSS", scss: "SCSS", sql: "SQL", md: "Markdown", markdown: "Markdown",
  yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", svg: "SVG", go: "Go", rust: "Rust", rs: "Rust",
  java: "Java", kotlin: "Kotlin", kt: "Kotlin", swift: "Swift", c: "C", cpp: "C++", cs: "C#", csharp: "C#",
  php: "PHP", rb: "Ruby", ruby: "Ruby", dockerfile: "Dockerfile", graphql: "GraphQL", prisma: "Prisma", env: ".env",
};
const RUNNABLE: Record<string, "js" | "ts" | "py"> = { js: "js", javascript: "js", mjs: "js", ts: "ts", typescript: "ts", py: "py", python: "py" };
const NO_NUMBERS = new Set(["", "text", "plaintext", "txt", "bash", "sh", "zsh", "shell", "console", "env"]);
const COLLAPSE_AT = 30;
const PEEK = 16;

/* ---------- tests ---------- */
const TEST_RE: Record<"js" | "ts" | "py", RegExp> = {
  js: /\b(?:test|it)\s*\(\s*["'`]/,
  ts: /\b(?:test|it)\s*\(\s*["'`]/,
  py: /^\s*def\s+test_\w*\s*\(/m,
};
const FENCE = "```";
const testsPrompt = (lang: string, raw: string) =>
  `Write tests for this code. Put the code and the tests together in one runnable ${lang} block with no imports, so I can press Run. ` +
  (RUNNABLE[lang] === "py" ? "Use plain test_ functions with assert. " : "Use test() and expect() (Jest style). ") +
  `Cover normal cases, edge cases and errors.\n\n${FENCE}${lang}\n${raw}\n${FENCE}`;

/* ---------- run output ---------- */
type RunState = { out: RunOut[]; running: boolean; ok?: boolean; ms?: number };

function RunPanel({ run, onClose }: { run: RunState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [run.out.length]);

  const passed = run.out.filter((o) => o.kind === "pass").length;
  const failed = run.out.filter((o) => o.kind === "fail").length;
  const tests = passed + failed > 0;
  const title = run.running
    ? tests ? `Testing… ${passed + failed} done` : "Running…"
    : tests ? (failed ? `${failed} failed · ${passed} passed` : `All ${passed} test${passed > 1 ? "s" : ""} passed`)
    : run.ok ? "Output" : "Finished with errors";
  const dot = run.running ? "live" : tests ? (failed ? "bad" : "ok") : run.ok ? "ok" : "bad";

  return (
    <div className="run-out">
      <div className="run-head">
        <span className={`run-dot ${dot}`} />
        <b>{title}</b>
        {!run.running && run.ms !== undefined && <small>{run.ms < 1000 ? `${Math.max(1, Math.round(run.ms))} ms` : `${(run.ms / 1000).toFixed(1)} s`}</small>}
        <button type="button" onClick={onClose} aria-label="Close output"><X size={13} strokeWidth={2} /></button>
      </div>
      <div className="run-lines" ref={ref}>
        {run.out.length ? (
          run.out.map((o, i) => <div key={i} className={`run-line ${o.kind}`}>{o.text}</div>)
        ) : (
          <div className="run-line system">{run.running ? "…" : "No output. Use console.log() or print() to show results."}</div>
        )}
      </div>
    </div>
  );
}

/* ---------- code block ---------- */
function CodeBlock({ lang, raw, path, children }: { lang: string; raw: string; path: string; children?: ReactNode }) {
  const { open } = useArtifact();
  const canSend = useCanSend();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const handle = useRef<RunHandle | null>(null);
  useEffect(() => () => handle.current?.stop(), []);

  const lines = raw ? raw.split("\n").length : 0;
  const long = lines > COLLAPSE_AT;
  const collapsed = long && !expanded;
  const numbered = lines >= 4 && !NO_NUMBERS.has(lang);
  const runKind = RUNNABLE[lang];
  const hasTests = !!runKind && TEST_RE[runKind].test(raw);
  const canAddTests = canSend && !!runKind && !hasTests && lines >= 4;
  const previewable = lang === "html" || lang === "svg";

  const copy = async () => { await navigator.clipboard.writeText(raw); setCopied(true); setTimeout(() => setCopied(false), 1200); };

  const start = async () => {
    if (!runKind) return;
    handle.current?.stop();
    setRun({ out: [], running: true });
    const { runCode } = await import("@/lib/runner");
    handle.current = runCode(runKind, raw, {
      onOut: (o) => setRun((r) => (r ? { ...r, out: [...r.out, o].slice(-500) } : r)),
      onDone: (ok, ms) => setRun((r) => (r ? { ...r, running: false, ok, ms } : r)),
    });
  };
  const stop = () => {
    handle.current?.stop();
    handle.current = null;
    setRun((r) => (r ? { ...r, running: false, ok: false, out: [...r.out, { kind: "system", text: "Stopped." }] } : r));
  };

  return (
    <div className={`code ${collapsed ? "collapsed" : ""}`} data-lang={lang}>
      <div className="code-bar">
        <span className="code-lang">
          <i className={`lang-dot l-${lang || "txt"}`} />
          {path && <b className="code-path" title={path}>{path}</b>}
          <span className="code-name">{LANG[lang] ?? (lang || "code")}</span>
        </span>
        <div>
          {canAddTests && (
            <button type="button" onClick={() => sendToChat(testsPrompt(lang, raw))} title="Write tests for this code">
              <FlaskConical size={13} strokeWidth={2} /> Tests
            </button>
          )}
          {runKind && (run?.running
            ? <button type="button" onClick={stop}><Square size={11} strokeWidth={2.5} /> Stop</button>
            : <button type="button" className="run" onClick={start}><Play size={12} strokeWidth={2.5} /> {hasTests ? "Run tests" : "Run"}</button>)}
          {previewable && <button type="button" onClick={() => open({ lang, code: raw })}><Eye size={13} strokeWidth={2} /> Preview</button>}
          <button type="button" onClick={copy}>
            {copied ? <><Check size={13} strokeWidth={2} /> Copied</> : <><Copy size={13} strokeWidth={2} /> Copy</>}
          </button>
        </div>
      </div>
      <div className="code-body" style={collapsed ? { maxHeight: `${PEEK * 1.6 + 1.9}em` } : undefined}>
        {numbered && (
          <div className="code-gutter" aria-hidden>
            {Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}
          </div>
        )}
        <pre>{children}</pre>
      </div>
      {long && (
        <button type="button" className="code-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : `Show all ${lines} lines`} <ChevronDown size={13} strokeWidth={2} className={expanded ? "up" : ""} />
        </button>
      )}
      {run && <RunPanel run={run} onClose={() => { handle.current?.stop(); handle.current = null; setRun(null); }} />}
    </div>
  );
}

/* ---------- diff ---------- */
type DLine = { t: "add" | "del" | "ctx" | "hunk" | "file"; text: string; a?: number; b?: number };

function parseDiff(raw: string) {
  const src = raw.split("\n");
  const lines: DLine[] = [];
  const files: string[] = [];
  let a = 1, b = 1, adds = 0, dels = 0, hunks = 0, numberedHunks = 0, oldName = "";
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    if (/^(diff --git |index [0-9a-f]+\.\.[0-9a-f]+|new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l)) continue;
    if (l.startsWith("--- ") && src[i + 1]?.startsWith("+++ ")) { oldName = l.slice(4).replace(/^a\//, "").trim(); continue; }
    if (l.startsWith("+++ ") && src[i - 1]?.startsWith("--- ")) {
      let f = l.slice(4).replace(/^b\//, "").trim();
      if (f === "/dev/null") f = oldName;
      if (f && !files.includes(f)) { files.push(f); lines.push({ t: "file", text: f }); }
      continue;
    }
    const h = l.match(/^@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@\s?(.*)$/);
    if (h) { a = +h[1]; b = +h[2]; hunks++; numberedHunks++; lines.push({ t: "hunk", text: h[3], b }); continue; }
    if (l.startsWith("@@")) { hunks++; lines.push({ t: "hunk", text: l.replace(/^@@[^@]*@@?\s?/, "") }); continue; }
    if (l.startsWith("\\")) continue;
    if (l.startsWith("+")) { lines.push({ t: "add", text: l.slice(1), b: b++ }); adds++; }
    else if (l.startsWith("-")) { lines.push({ t: "del", text: l.slice(1), a: a++ }); dels++; }
    else lines.push({ t: "ctx", text: l.startsWith(" ") ? l.slice(1) : l, a: a++, b: b++ });
  }
  return { lines, files, adds, dels, numbered: hunks > 0 && hunks === numberedHunks };
}

function newCode(lines: DLine[]) {
  const parts: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (l.t === "hunk" || l.t === "file") { if (cur.length) parts.push(cur.join("\n")); cur = []; }
    else if (l.t !== "del") cur.push(l.text);
  }
  if (cur.length) parts.push(cur.join("\n"));
  return parts.join("\n\n");
}

function Diff({ raw }: { raw: string }) {
  const { lines, files, adds, dels, numbered } = useMemo(() => parseDiff(raw), [raw]);
  const [copied, setCopied] = useState<"" | "diff" | "new">("");
  const [expanded, setExpanded] = useState(false);
  const long = lines.length > 60;
  const collapsed = long && !expanded;

  const copy = async (what: "diff" | "new") => {
    await navigator.clipboard.writeText(what === "diff" ? raw : newCode(lines));
    setCopied(what);
    setTimeout(() => setCopied(""), 1200);
  };

  return (
    <div className={`code diff ${collapsed ? "collapsed" : ""}`} data-lang="diff">
      <div className="code-bar">
        <span className="code-lang">
          <i className="lang-dot l-diff" />
          {files.length ? <b className="code-path" title={files.join(", ")}>{files.join(", ")}</b> : <span className="code-name">Changes</span>}
          <span className="diff-stat"><em className="add">+{adds}</em><em className="del">−{dels}</em></span>
        </span>
        <div>
          <button type="button" onClick={() => copy("new")}>
            {copied === "new" ? <><Check size={13} strokeWidth={2} /> Copied</> : <><Copy size={13} strokeWidth={2} /> Copy new code</>}
          </button>
          <button type="button" onClick={() => copy("diff")}>{copied === "diff" ? "Copied" : "Copy diff"}</button>
        </div>
      </div>
      <div className={`diff-body ${numbered ? "" : "nonum"}`} style={collapsed ? { maxHeight: "28em" } : undefined}>
        {lines.map((l, i) =>
          l.t === "file" ? (
            files.length > 1 ? <div key={i} className="dl file">{l.text}</div> : null
          ) : l.t === "hunk" ? (
            <div key={i} className="dl hunk">
              <span className="dn" /><span className="dn" /><span className="ds">⋯</span>
              <span className="dt">{l.b ? `Line ${l.b}` : ""}{l.text ? `${l.b ? " · " : ""}${l.text}` : ""}</span>
            </div>
          ) : (
            <div key={i} className={`dl ${l.t}`}>
              <span className="dn">{l.t !== "add" ? l.a : ""}</span>
              <span className="dn">{l.t !== "del" ? l.b : ""}</span>
              <span className="ds">{l.t === "add" ? "+" : l.t === "del" ? "−" : ""}</span>
              <span className="dt">{l.text || " "}</span>
            </div>
          )
        )}
      </div>
      {long && (
        <button type="button" className="code-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : `Show all ${lines.length} lines`} <ChevronDown size={13} strokeWidth={2} className={expanded ? "up" : ""} />
        </button>
      )}
    </div>
  );
}

/* ---------- file tabs ---------- */
function FileTabs({ node, children }: { node: HNode; children?: ReactNode }) {
  const files = (node.children ?? []).map((pre) => {
    const c = codeEl(pre);
    const raw = rawOf(c);
    return { path: pathFrom(c?.data?.meta, raw), raw };
  });
  const panes = Children.toArray(children).filter(isValidElement);
  const [i, setI] = useState(0);
  const active = Math.min(i, panes.length - 1);

  return (
    <div className="file-tabs">
      <div className="ft-bar" role="tablist">
        <FileCode2 size={14} strokeWidth={1.75} />
        {files.map((f, k) => (
          <button key={k} type="button" role="tab" aria-selected={k === active} className={k === active ? "on" : ""} onClick={() => setI(k)} title={f.path}>
            {f.path.split("/").pop()}
          </button>
        ))}
        <span className="ft-space" />
        <button type="button" className="ft-zip" onClick={() => downloadZip(files)} title={`Download ${files.length} files`}>
          <Download size={13} strokeWidth={2} /> .zip
        </button>
      </div>
      {panes.map((p, k) => <div key={k} className="ft-pane" hidden={k !== active}>{p}</div>)}
    </div>
  );
}

/* ---------- renderers ---------- */
function Pre({ node, children }: { node?: unknown; children?: ReactNode }) {
  const code = codeEl(node as HNode | undefined);
  const lang = langOf(code);
  const raw = rawOf(code);
  if (lang === "diff" || lang === "patch") return <Diff raw={raw} />;
  return <CodeBlock lang={lang} raw={raw} path={pathFrom(code?.data?.meta, raw)}>{children}</CodeBlock>;
}

const components: Components = {
  pre: Pre,
  div: ({ node, children, ...props }) => {
    const n = node as unknown as HNode | undefined;
    return n?.properties?.dataFiletabs ? <FileTabs node={n}>{children}</FileTabs> : <div {...props}>{children}</div>;
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @next/next/no-img-element
  img: ({ node, ...p }) => <img {...p} alt={p.alt ?? ""} loading="lazy" />,
};

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);

/* ---------- inline version for quiz options, flashcards, exam questions ---------- */
const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
};

export const InlineMd = memo(function InlineMd({ text }: { text: string }) {
  if (!/[\\$*_`]/.test(text)) return <>{text}</>;
  return (
    <span className="md-inline">
      <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE_INLINE} components={inlineComponents}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </span>
  );
});
