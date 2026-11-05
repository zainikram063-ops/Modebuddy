/* Files shown in the side panel (web pages, documents, images) */
import { useSyncExternalStore } from "react";

export type Art = { id: string; lang: string; title: string; code: string };
type S = { arts: Art[]; open: boolean; active: string | null; streaming: string | null; dismissed: boolean; edits: Record<string, string> };

let s: S = { arts: [], open: false, active: null, streaming: null, dismissed: false, edits: {} };
const subs = new Set<() => void>();
const set = (p: Partial<S>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
const get = () => s;

export const useArts = () => useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, get, get);
export function putArt(a: Art, live: boolean) {
  const old = s.arts.find((x) => x.id === a.id);
  if (old && old.code === a.code && old.title === a.title && !live) return;
  const arts = old ? s.arts.map((x) => (x.id === a.id ? a : x)) : [...s.arts, a];
  set(live ? { arts, streaming: a.id, ...(s.dismissed ? {} : { open: true, active: a.id }) } : { arts });
}
export const dropArt = (id: string) =>
  set({ arts: s.arts.filter((x) => x.id !== id), ...(s.active === id ? { active: null, open: false } : {}) });
export const openArt = (id: string) => set({ open: true, active: id, dismissed: false });
export const closeArts = () => set({ open: false, dismissed: true });
export const editArt = (id: string, code: string) => set({ edits: { ...s.edits, [id]: code } });
export const newResponse = () => set({ dismissed: false, streaming: null });
