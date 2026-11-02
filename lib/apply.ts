/* Apply AI changes to files in your project folder, with undo (Chrome/Edge/Arc/Brave). */
import { useSyncExternalStore } from "react";
import { saveProject, type Project } from "@/lib/project";

type Writable = { write(d: string): Promise<void>; close(): Promise<void> };
type FileH = { getFile(): Promise<File>; createWritable(): Promise<Writable> };
type DirH = {
  getDirectoryHandle(n: string, o?: { create?: boolean }): Promise<DirH>;
  getFileHandle(n: string, o?: { create?: boolean }): Promise<FileH>;
  removeEntry(n: string): Promise<void>;
  queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
};
export type Applied = { path: string; before: string | null };
type Hunk = { old: string[]; next: string[] };

const NO_WRITE = "To apply changes, add the project with “Choose folder” in Chrome (dropped or GitHub projects are read-only).";

/* ---------- which project is open ---------- */
let active: Project | null = null;
const subs = new Set<() => void>();
export function setApplyProject(p: Project | null) { active = p; subs.forEach((f) => f()); }
export const useApplyProject = () =>
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => active, () => null);

export function resolvePath(p: Project, raw: string): string | null {
  const have = new Set(p.files.map((f) => f.path));
  const s = raw.trim().replace(/^\.?\//, "");
  const prefix = p.name + "/";
  for (const c of [s, s.replace(/^[ab]\//, ""), s.startsWith(prefix) ? s.slice(prefix.length) : s])
    if (have.has(c)) return c;
  const hits = p.files.filter((f) => f.path.endsWith("/" + s));
  return hits.length === 1 ? hits[0].path : null;
}

/* ---------- patching ---------- */
export function parsePatch(diff: string): { path: string; hunks: Hunk[] }[] {
  const out: { path: string; hunks: Hunk[] }[] = [];
  const lines = diff.replace(/\r/g, "").replace(/\s+$/, "").split("\n");
  let cur: { path: string; hunks: Hunk[] } | null = null;
  let h: Hunk | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const plus = lines[i + 1].slice(4).trim().replace(/^b\//, "");
      cur = { path: plus === "/dev/null" ? l.slice(4).trim().replace(/^a\//, "") : plus, hunks: [] };
      out.push(cur); h = null; i++; continue;
    }
    if (/^(diff --git |index [0-9a-f]|new file mode|deleted file mode)/.test(l)) { h = null; continue; }
    if (l.startsWith("@@")) {
      if (!cur) { cur = { path: "", hunks: [] }; out.push(cur); }
      h = { old: [], next: [] }; cur.hunks.push(h); continue;
    }
    if (!h || l.startsWith("\\")) continue;
    if (l.startsWith("+")) h.next.push(l.slice(1));
    else if (l.startsWith("-")) h.old.push(l.slice(1));
    else { const t = l.startsWith(" ") ? l.slice(1) : l; h.old.push(t); h.next.push(t); }
  }
  return out.filter((f) => f.hunks.length);
}

function find(lines: string[], block: string[], from: number) {
  const eqs = [(a: string, b: string) => a.trimEnd() === b.trimEnd(), (a: string, b: string) => a.trim() === b.trim()];
  for (const eq of eqs) {
    for (const start of [from, 0]) {
      for (let i = start; i + block.length <= lines.length; i++) {
        let ok = true;
        for (let j = 0; j < block.length && ok; j++) ok = eq(lines[i + j], block[j]);
        if (ok) return i;
      }
    }
  }
  return -1;
}

export function applyHunks(text: string, hunks: Hunk[]): string | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.replace(/\r\n/g, "\n").split("\n");
  let from = 0;
  for (const h of hunks) {
    if (!h.old.length) { lines = [...lines, ...h.next]; continue; }
    const at = find(lines, h.old, from);
    if (at < 0) return null;
    lines = [...lines.slice(0, at), ...h.next, ...lines.slice(at + h.old.length)];
    from = at + h.next.length;
  }
  return lines.join(eol);
}

/* ---------- disk ---------- */
function loadHandle(id: string): Promise<DirH | undefined> {
  return new Promise((res) => {
    const r = indexedDB.open("modebuddy-projects", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects", { keyPath: "id" });
      if (!d.objectStoreNames.contains("handles")) d.createObjectStore("handles");
    };
    r.onsuccess = () => {
      try {
        const q = r.result.transaction("handles", "readonly").objectStore("handles").get(id);
        q.onsuccess = () => res(q.result as DirH | undefined);
        q.onerror = () => res(undefined);
      } catch { res(undefined); }
    };
    r.onerror = () => res(undefined);
  });
}

async function rootFor(p: Project): Promise<DirH> {
  const h = await loadHandle(p.id);
  if (!h) throw new Error(NO_WRITE);
  const ok =
    (await h.queryPermission?.({ mode: "readwrite" })) === "granted" ||
    (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
  if (!ok) throw new Error("ModeBuddy needs permission to edit files. Click Apply again and choose Allow.");
  return h;
}

async function dirOf(root: DirH, path: string, create: boolean) {
  const parts = path.split("/");
  let d = root;
  for (const seg of parts.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create });
  return { d, name: parts[parts.length - 1] };
}
async function readDisk(root: DirH, path: string): Promise<string | null> {
  try { const { d, name } = await dirOf(root, path, false); return await (await (await d.getFileHandle(name)).getFile()).text(); }
  catch { return null; }
}
async function writeDisk(root: DirH, path: string, text: string) {
  const { d, name } = await dirOf(root, path, true);
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}
async function removeDisk(root: DirH, path: string) {
  const { d, name } = await dirOf(root, path, false);
  await d.removeEntry(name);
}

/* keep the browser copy in sync so pins use the new version */
async function remember(p: Project, path: string, text: string | null) {
  const has = p.files.some((f) => f.path === path);
  const files =
    text === null ? p.files.filter((f) => f.path !== path)
    : has ? p.files.map((f) => (f.path === path ? { ...f, text, size: text.length } : f))
    : [...p.files, { path, size: text.length, text }].sort((a, b) => a.path.localeCompare(b.path));
  const next = { ...p, files, updatedAt: Date.now() };
  await saveProject(next);
  active = next;
  window.dispatchEvent(new CustomEvent("mb-project-updated", { detail: next }));
  return next;
}

/* ---------- apply / undo ---------- */
export async function applyChange(input: { path?: string; code?: string; diff?: string }): Promise<Applied[]> {
  const p = active;
  if (!p) throw new Error("Add your project first (📁 Project).");
  if (p.source !== "folder") throw new Error(NO_WRITE);
  const root = await rootFor(p);
  const plan: { path: string; text: string; before: string | null }[] = [];

  if (input.diff) {
    const files = parsePatch(input.diff);
    if (!files.length) throw new Error("This diff has no changes to apply.");
    for (const f of files) {
      const path = f.path ? resolvePath(p, f.path) ?? f.path.replace(/^\.?\//, "") : "";
      if (!path) throw new Error("This diff doesn't say which file it's for.");
      const before = await readDisk(root, path);
      const text = before === null
        ? (f.hunks.every((h) => !h.old.length) ? f.hunks.flatMap((h) => h.next).join("\n") + "\n" : null)
        : applyHunks(before, f.hunks);
      if (text === null) throw new Error(`Couldn't match the change to ${path}. Ask for the full file instead.`);
      plan.push({ path, text, before });
    }
  } else if (input.path && input.code !== undefined) {
    const path = resolvePath(p, input.path) ?? input.path.replace(/^\.?\//, "");
    plan.push({ path, text: input.code.endsWith("\n") ? input.code : input.code + "\n", before: await readDisk(root, path) });
  }

  let cur = p;
  for (const c of plan) { await writeDisk(root, c.path, c.text); cur = await remember(cur, c.path, c.text); }
  return plan.map(({ path, before }) => ({ path, before }));
}

export async function undoChange(done: Applied[]) {
  const p = active;
  if (!p) return;
  const root = await rootFor(p);
  let cur = p;
  for (const c of [...done].reverse()) {
    if (c.before === null) { await removeDisk(root, c.path); cur = await remember(cur, c.path, null); }
    else { await writeDisk(root, c.path, c.before); cur = await remember(cur, c.path, c.before); }
  }
}
