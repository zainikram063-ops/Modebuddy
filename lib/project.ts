/* Projects live in this browser (IndexedDB). Only the files you pin are sent to the AI. */

export type ProjectFile = { path: string; size: number; text?: string; secret?: boolean; big?: boolean };
export type Project = {
  id: string;
  name: string;
  source: "folder" | "github";
  repo?: { owner: string; name: string; branch: string };
  stack: string[];
  files: ProjectFile[];
  updatedAt: number;
  truncated?: boolean;
};
export type ProjectPayload = { name: string; stack: string[]; tree: string; files: { path: string; text: string }[] };
type Progress = (n: number) => void;
type Entry = { path: string; size: number; read: () => Promise<string> };
type Skip = (path: string, isDir: boolean) => boolean;

/* ---------- limits & rules ---------- */
const MAX_ENTRIES = 5000;
const MAX_FILE = 200_000;
const MAX_TOTAL = 20_000_000;
export const PIN_BUDGET = 120_000;

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", ".vercel", ".turbo", ".cache", ".parcel-cache", ".svelte-kit", ".nuxt", ".output", ".expo",
  "dist", "build", "out", "coverage", "target", "vendor", "Pods", ".gradle", ".dart_tool",
  "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", ".idea", ".vscode",
]);
const TEXT_EXT = new Set(
  ("js jsx ts tsx mjs cjs mts cts json jsonc md mdx txt css scss sass less html htm xml svg yml yaml toml ini cfg conf " +
    "py rb go rs java kt kts swift c h cc cpp hpp cs php sql sh bash zsh fish vue svelte astro graphql gql prisma proto " +
    "lua dart r ex exs scala gradle properties csv tsv").split(" ")
);
const TEXT_NAMES = new Set([
  "dockerfile", "makefile", "procfile", "gemfile", "rakefile", "license", ".gitignore", ".prettierrc", ".eslintrc",
  ".babelrc", ".nvmrc", ".editorconfig", ".dockerignore", ".env.example", ".env.sample",
]);
const SECRET_RE = /(^|\/)(\.env(\.[\w.-]+)?|[^/]*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa)[^/]*|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|[^/]*service[-_]?account[^/]*\.json|secrets?\.(json|ya?ml|toml))$/i;
const SAFE_ENV = /(^|\/)\.env\.(example|sample|template)$/i;
const LOCK_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/;

const baseOf = (p: string) => p.split("/").pop() ?? p;
const isSecret = (p: string) => SECRET_RE.test(p) && !SAFE_ENV.test(p);
export function isTextPath(p: string) {
  const b = baseOf(p).toLowerCase();
  const dot = b.lastIndexOf(".");
  return TEXT_NAMES.has(b) || /^readme/.test(b) || (dot > 0 && TEXT_EXT.has(b.slice(dot + 1)));
}

function makeSkip(gitignoreText: string): Skip {
  const rules = gitignoreText.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
  const tests = rules.map((rule) => {
    const dirOnly = rule.endsWith("/");
    const clean = rule.replace(/^\//, "").replace(/\/$/, "");
    const anchored = rule.startsWith("/") || clean.includes("/");
    const rx = new RegExp(
      "^" + clean.split("**").map((part) => part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")).join(".*") + "$"
    );
    return (path: string, isDir: boolean) => (!dirOnly || isDir) && rx.test(anchored ? path : baseOf(path));
  });
  return (path, isDir) => {
    const name = baseOf(path);
    if (isDir && IGNORE_DIRS.has(name)) return true;
    if (!isDir && (name === ".DS_Store" || name === "Thumbs.db")) return true;
    return tests.some((t) => t(path, isDir));
  };
}

function hiddenPath(path: string, skip: Skip) {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) if (skip(parts.slice(0, i).join("/"), true)) return true;
  return skip(path, false);
}

/* ---------- storage (IndexedDB) ---------- */
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("modebuddy-projects", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
        if (!d.objectStoreNames.contains("handles")) d.createObjectStore("handles");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
  }
  return dbp;
}
async function run<T>(store: "projects" | "handles", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise<T>((res, rej) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  });
}
export const listProjects = () => run<Project[]>("projects", "readonly", (s) => s.getAll());
export const saveProject = (p: Project) => run<IDBValidKey>("projects", "readwrite", (s) => s.put(p));
export async function deleteProject(id: string) {
  await run("projects", "readwrite", (s) => s.delete(id));
  await run("handles", "readwrite", (s) => s.delete(id)).catch(() => undefined);
}

/* ---------- reading files ---------- */
async function build(name: string, entries: Entry[], base: Project | undefined, onProgress?: Progress): Promise<Project> {
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const files: ProjectFile[] = entries.map((e) => ({ path: e.path, size: e.size }));
  const jobs = entries
    .map((e, i) => ({ e, f: files[i] }))
    .filter(({ e, f }) => {
      if (isSecret(e.path)) { f.secret = true; return false; }
      if (LOCK_RE.test(e.path) || !isTextPath(e.path)) return false;
      if (e.size > MAX_FILE) { f.big = true; return false; }
      return true;
    });
  let total = 0;
  let count = 0;
  for (let i = 0; i < jobs.length; i += 24) {
    await Promise.all(
      jobs.slice(i, i + 24).map(async ({ e, f }) => {
        if (total > MAX_TOTAL) { f.big = true; return; }
        const t = await e.read().catch(() => "");
        if (t && !t.includes("\u0000")) { f.text = t; total += t.length; }
        count++;
      })
    );
    onProgress?.(count);
  }
  return {
    id: base?.id ?? crypto.randomUUID(),
    name: base?.name ?? name,
    source: "folder",
    stack: detectStack(files),
    files,
    updatedAt: Date.now(),
    truncated: entries.length >= MAX_ENTRIES,
  };
}

/* Chrome / Edge / Arc / Brave: a real folder picker that can re-sync later */
type FileH = { kind: "file"; name: string; getFile(): Promise<File> };
type DirH = {
  kind: "directory";
  name: string;
  values(): AsyncIterable<FileH | DirH>;
  getFileHandle(name: string): Promise<FileH>;
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
};
const saveHandle = (id: string, h: DirH) => run("handles", "readwrite", (s) => s.put(h, id));
const getHandle = (id: string) => run<DirH | undefined>("handles", "readonly", (s) => s.get(id));

export const canPickDir = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

async function walkHandle(dir: DirH, prefix: string, out: Entry[], skip: Skip): Promise<void> {
  for await (const h of dir.values()) {
    if (out.length >= MAX_ENTRIES) return;
    const path = prefix ? `${prefix}/${h.name}` : h.name;
    if (h.kind === "directory") {
      if (!skip(path, true)) await walkHandle(h, path, out, skip);
    } else if (!skip(path, false)) {
      const f = await h.getFile();
      out.push({ path, size: f.size, read: () => f.text() });
    }
  }
}

async function scanHandle(dir: DirH, base: Project | undefined, onProgress?: Progress) {
  const gi = await dir.getFileHandle(".gitignore").then((h) => h.getFile()).then((f) => f.text()).catch(() => "");
  const entries: Entry[] = [];
  await walkHandle(dir, "", entries, makeSkip(gi));
  return build(dir.name, entries, base, onProgress);
}

export async function pickFolder(onProgress?: Progress): Promise<Project | null> {
  const picker = window as unknown as { showDirectoryPicker(o: { mode: "read" }): Promise<DirH> };
  const dir = await picker.showDirectoryPicker({ mode: "read" }).catch(() => null);
  if (!dir) return null;
  const p = await scanHandle(dir, undefined, onProgress);
  await saveProject(p);
  await saveHandle(p.id, dir).catch(() => undefined);
  return p;
}

/* Safari / Firefox: the folder "upload" dialog (nothing leaves the browser) */
export async function projectFromFiles(list: FileList, base?: Project, onProgress?: Progress): Promise<Project | null> {
  const all = Array.from(list);
  if (!all.length) return null;
  const root = all[0].webkitRelativePath.split("/")[0] || "project";
  const rel = (f: File) => f.webkitRelativePath.split("/").slice(1).join("/") || f.name;
  const gi = (await all.find((f) => rel(f) === ".gitignore")?.text().catch(() => "")) ?? "";
  const skip = makeSkip(gi);
  const entries: Entry[] = [];
  for (const f of all) {
    if (entries.length >= MAX_ENTRIES) break;
    const path = rel(f);
    if (!hiddenPath(path, skip)) entries.push({ path, size: f.size, read: () => f.text() });
  }
  const p = await build(root, entries, base, onProgress);
  await saveProject(p);
  return p;
}

/* Drag & drop a folder */
export function droppedFolder(items: DataTransferItemList): FileSystemDirectoryEntry | null {
  for (const item of Array.from(items)) {
    const e = item.webkitGetAsEntry?.();
    if (e?.isDirectory) return e as FileSystemDirectoryEntry;
  }
  return null;
}
function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((res, rej) => {
    const next = () => reader.readEntries((batch) => { if (!batch.length) res(all); else { all.push(...batch); next(); } }, rej);
    next();
  });
}
const fileOf = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));
async function walkEntry(dir: FileSystemDirectoryEntry, prefix: string, out: Entry[], skip: Skip): Promise<void> {
  for (const e of await readAll(dir)) {
    if (out.length >= MAX_ENTRIES) return;
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory) {
      if (!skip(path, true)) await walkEntry(e as FileSystemDirectoryEntry, path, out, skip);
    } else if (!skip(path, false)) {
      const f = await fileOf(e as FileSystemFileEntry);
      out.push({ path, size: f.size, read: () => f.text() });
    }
  }
}
export async function projectFromEntry(dir: FileSystemDirectoryEntry, base?: Project, onProgress?: Progress): Promise<Project> {
  const top = await readAll(dir);
  const giEntry = top.find((e) => e.isFile && e.name === ".gitignore") as FileSystemFileEntry | undefined;
  const gi = giEntry ? await fileOf(giEntry).then((f) => f.text()).catch(() => "") : "";
  const entries: Entry[] = [];
  await walkEntry(dir, "", entries, makeSkip(gi));
  const p = await build(dir.name, entries, base, onProgress);
  await saveProject(p);
  return p;
}

/* ---------- GitHub (public, or private with a token) ---------- */
const GH_KEY = "mb-gh-token";
export const setGithubToken = (t: string) => { if (t.trim()) localStorage.setItem(GH_KEY, t.trim()); else localStorage.removeItem(GH_KEY); };
const ghHeaders = (): Record<string, string> => {
  const t = localStorage.getItem(GH_KEY);
  return t ? { Accept: "application/vnd.github+json", Authorization: `Bearer ${t}` } : { Accept: "application/vnd.github+json" };
};

export function parseRepo(input: string) {
  const s = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+)(?:\/tree\/(.+))?/i.exec(s) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  return m ? { owner: m[1], name: m[2], branch: m[3] as string | undefined } : null;
}

async function ghText(p: Project, path: string) {
  if (!p.repo) throw new Error("Not a GitHub project.");
  const { owner, name, branch } = p.repo;
  const token = localStorage.getItem(GH_KEY);
  const enc = path.split("/").map(encodeURIComponent).join("/");
  const r = token
    ? await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${enc}?ref=${encodeURIComponent(branch)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw" },
      })
    : await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/${enc}`);
  if (!r.ok) throw new Error(`Couldn't load ${path} (${r.status}).`);
  return r.text();
}

export async function importGithub(input: string, base?: Project, branchOverride?: string): Promise<Project> {
  const r = parseRepo(input);
  if (!r) throw new Error("Use owner/repo or a github.com link.");
  const api = `https://api.github.com/repos/${r.owner}/${r.name}`;
  const info = await fetch(api, { headers: ghHeaders() });
  if (info.status === 404) throw new Error("Repo not found. If it's private, add a GitHub token.");
  if (info.status === 401) throw new Error("That GitHub token didn't work.");
  if (info.status === 403) throw new Error("GitHub's rate limit was hit. Add a token or try again later.");
  if (!info.ok) throw new Error(`GitHub error ${info.status}.`);
  const meta = (await info.json()) as { full_name?: string; default_branch?: string };
  const branch = branchOverride ?? r.branch ?? meta.default_branch ?? "main";

  const tr = await fetch(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: ghHeaders() });
  if (!tr.ok) throw new Error(`Couldn't read the file list (${tr.status}).`);
  const tree = (await tr.json()) as { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean };
  const skip = makeSkip("");
  const files: ProjectFile[] = (tree.tree ?? [])
    .filter((t) => t.type === "blob" && !hiddenPath(t.path, skip))
    .slice(0, MAX_ENTRIES)
    .map((t) => ({ path: t.path, size: t.size ?? 0, ...(isSecret(t.path) ? { secret: true } : {}) }));

  const p: Project = {
    id: base?.id ?? crypto.randomUUID(),
    name: meta.full_name ?? `${r.owner}/${r.name}`,
    source: "github",
    repo: { owner: r.owner, name: r.name, branch },
    stack: [],
    files,
    updatedAt: Date.now(),
    truncated: !!tree.truncated,
  };
  for (const path of ["package.json", "requirements.txt", "pyproject.toml"]) {
    const f = files.find((x) => x.path === path);
    if (f) f.text = await ghText(p, path).catch(() => undefined);
  }
  p.stack = detectStack(files);
  await saveProject(p);
  return p;
}

/** GitHub files load when you pin them */
export async function ensureText(p: Project, path: string): Promise<Project> {
  const f = p.files.find((x) => x.path === path);
  if (!f || f.text !== undefined || f.secret || p.source !== "github" || !isTextPath(path) || f.size > MAX_FILE) return p;
  const text = await ghText(p, path);
  const next = { ...p, files: p.files.map((x) => (x.path === path ? { ...x, text } : x)) };
  await saveProject(next);
  return next;
}

export async function syncProject(p: Project, onProgress?: Progress): Promise<Project | "repick"> {
  if (p.source === "github" && p.repo) return importGithub(`${p.repo.owner}/${p.repo.name}`, p, p.repo.branch);
  const dir = await getHandle(p.id).catch(() => undefined);
  if (!dir) return "repick";
  const ok =
    (await dir.queryPermission?.({ mode: "read" })) === "granted" ||
    (await dir.requestPermission?.({ mode: "read" })) === "granted";
  if (!ok) return "repick";
  const fresh = await scanHandle(dir, p, onProgress);
  await saveProject(fresh);
  return fresh;
}

/* ---------- stack detection ---------- */
export function detectStack(files: ProjectFile[]): string[] {
  const has = (p: string) => files.some((f) => f.path === p);
  const text = (p: string) => files.find((f) => f.path === p)?.text ?? "";
  const out: string[] = [];
  const pkgText = text("package.json");
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
      const ver = (n: string) => { const m = /(\d+)/.exec(deps[n] ?? ""); return m ? ` ${m[1]}` : ""; };
      const add = (dep: string, label: string, withVersion = false) => { if (deps[dep]) out.push(label + (withVersion ? ver(dep) : "")); };
      add("next", "Next.js", true); add("react", "React", true); add("vue", "Vue", true); add("nuxt", "Nuxt", true);
      add("svelte", "Svelte", true); add("@sveltejs/kit", "SvelteKit"); add("astro", "Astro"); add("@remix-run/react", "Remix");
      add("express", "Express"); add("fastify", "Fastify"); add("@nestjs/core", "NestJS"); add("hono", "Hono");
      add("react-native", "React Native"); add("expo", "Expo"); add("electron", "Electron"); add("vite", "Vite");
      if (deps.typescript || has("tsconfig.json")) out.push("TypeScript");
      add("tailwindcss", "Tailwind"); add("@supabase/supabase-js", "Supabase"); add("@supabase/ssr", "Supabase");
      add("@prisma/client", "Prisma"); add("drizzle-orm", "Drizzle"); add("mongoose", "MongoDB"); add("firebase", "Firebase");
      add("ai", "AI SDK"); add("openai", "OpenAI SDK"); add("@anthropic-ai/sdk", "Anthropic SDK"); add("stripe", "Stripe");
      add("zod", "Zod"); add("vitest", "Vitest"); add("jest", "Jest"); add("@playwright/test", "Playwright");
    } catch {
      /* not valid JSON */
    }
  }
  if (has("requirements.txt") || has("pyproject.toml")) {
    out.push("Python");
    const py = text("requirements.txt") + text("pyproject.toml");
    for (const [k, label] of [["django", "Django"], ["flask", "Flask"], ["fastapi", "FastAPI"], ["pandas", "pandas"], ["torch", "PyTorch"]])
      if (new RegExp(`\\b${k}\\b`, "i").test(py)) out.push(label);
  }
  if (has("go.mod")) out.push("Go");
  if (has("Cargo.toml")) out.push("Rust");
  if (has("Gemfile")) out.push("Ruby");
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts")) out.push("Java/Kotlin");
  if (has("pubspec.yaml")) out.push("Flutter");
  return [...new Set(out)];
}

/* ---------- what gets sent to the AI ---------- */
export function treeText(files: ProjectFile[], max = 400) {
  type Node = { dirs: Map<string, Node>; files: string[] };
  const root: Node = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let n = root;
    for (const d of parts.slice(0, -1)) {
      if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), files: [] });
      n = n.dirs.get(d) as Node;
    }
    n.files.push(parts[parts.length - 1] + (f.secret ? " (secret, not shared)" : ""));
  }
  const lines: string[] = [];
  const walk = (n: Node, depth: number) => {
    const pad = "  ".repeat(depth);
    for (const [name, child] of [...n.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (lines.length >= max) return;
      lines.push(`${pad}${name}/`);
      walk(child, depth + 1);
    }
    const names = [...n.files].sort();
    for (const f of names.slice(0, 40)) {
      if (lines.length >= max) return;
      lines.push(pad + f);
    }
    if (names.length > 40) lines.push(`${pad}… ${names.length - 40} more files`);
  };
  walk(root, 0);
  if (lines.length >= max) lines.push(`… (${files.length} files in total)`);
  return lines.join("\n");
}

export function buildPayload(p: Project, pins: string[]): ProjectPayload {
  let left = PIN_BUDGET;
  const files: { path: string; text: string }[] = [];
  const pkg = p.files.find((f) => f.path === "package.json");
  if (pkg?.text && !pins.includes("package.json") && pkg.text.length < 5000) files.push({ path: "package.json", text: pkg.text });
  for (const path of pins) {
    const f = p.files.find((x) => x.path === path);
    if (!f?.text || left <= 0) continue;
    const text = f.text.length > left ? `${f.text.slice(0, left)}\n… (cut off: too many pinned files)` : f.text;
    left -= text.length;
    files.push({ path, text });
  }
  return { name: p.name, stack: p.stack, tree: treeText(p.files), files };
}
