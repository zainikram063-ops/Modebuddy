"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildPayload, deleteProject, ensureText, listProjects, type Project, type ProjectPayload } from "@/lib/project";
import { setApplyProject } from "@/lib/apply";

const ACTIVE_KEY = "mb-active-project";
const pinsKey = (chatId: string) => `mb-pins:${chatId}`;

export type ProjectState = {
  ready: boolean;
  projects: Project[];
  project: Project | null;
  pins: string[];
  pinnedChars: number;
  payload: ProjectPayload | undefined;
  select: (id: string | null) => void;
  add: (p: Project) => void;
  remove: (id: string) => Promise<void>;
  togglePin: (path: string) => void;
  unpin: (path: string) => void;
};

export function useProject(chatId: string, enabled: boolean): ProjectState {
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pins, setPins] = useState<string[]>([]);

  /* load saved projects + this chat's pins */
  useEffect(() => {
    if (!enabled || typeof indexedDB === "undefined") return;
    let alive = true;
    listProjects()
      .then((all) => {
        if (!alive) return;
        let saved: { projectId?: string; paths?: string[] } | null = null;
        try { saved = JSON.parse(localStorage.getItem(pinsKey(chatId)) ?? "null"); } catch { saved = null; }
        const active = localStorage.getItem(ACTIVE_KEY);
        const pick = all.find((x) => x.id === saved?.projectId) ?? all.find((x) => x.id === active) ?? null;
        const savedPaths = pick && saved && saved.projectId === pick.id ? saved.paths ?? [] : [];
        setProjects(all);
        setProjectId(pick?.id ?? null);
        setPins(pick ? savedPaths.filter((path) => pick.files.some((f) => f.path === path)) : []);
      })
      .catch(() => {})
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [chatId, enabled]);

  const project = useMemo(() => projects.find((x) => x.id === projectId) ?? null, [projects, projectId]);
  useEffect(() => { setApplyProject(enabled ? project : null); }, [enabled, project]);
  useEffect(() => {
    const h = (e: Event) => {
      const next = (e as CustomEvent<Project>).detail;
      setProjects((all) => all.map((x) => (x.id === next.id ? next : x)));
    };
    addEventListener("mb-project-updated", h);
    return () => removeEventListener("mb-project-updated", h);
  }, []);

  const persist = useCallback((pid: string | null, paths: string[]) => {
    try {
      if (pid) localStorage.setItem(pinsKey(chatId), JSON.stringify({ projectId: pid, paths }));
      else localStorage.removeItem(pinsKey(chatId));
    } catch { /* storage full or blocked */ }
  }, [chatId]);

  const select = useCallback((id: string | null) => {
    setProjectId(id);
    setPins([]);
    persist(id, []);
    try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  }, [persist]);

  const add = useCallback((p: Project) => {
    setProjects((all) => [...all.filter((x) => x.id !== p.id), p]);
    if (p.id !== projectId) select(p.id);
    else setPins((cur) => cur.filter((path) => p.files.some((f) => f.path === path)));
  }, [projectId, select]);

  const remove = useCallback(async (id: string) => {
    await deleteProject(id);
    setProjects((all) => all.filter((x) => x.id !== id));
    if (id === projectId) select(null);
  }, [projectId, select]);

  const unpin = useCallback((path: string) => {
    setPins((cur) => {
      const next = cur.filter((x) => x !== path);
      persist(projectId, next);
      return next;
    });
  }, [persist, projectId]);

  const togglePin = useCallback((path: string) => {
    if (!project) return;
    if (pins.includes(path)) { unpin(path); return; }
    const next = [...pins, path].slice(-20);
    setPins(next);
    persist(project.id, next);
  }, [project, pins, unpin, persist]);

  /* GitHub projects: fetch pinned files that haven't been downloaded yet */
  useEffect(() => {
    if (!project || project.source !== "github") return;
    const missing = pins.filter((path) => project.files.some((f) => f.path === path && f.text === undefined && !f.secret));
    if (!missing.length) return;
    let alive = true;
    (async () => {
      let p = project;
      for (const path of missing) p = await ensureText(p, path).catch(() => p);
      const done = p;
      if (alive) setProjects((all) => all.map((x) => (x.id === done.id ? done : x)));
    })();
    return () => { alive = false; };
  }, [project, pins]);

  const payload = useMemo(() => (enabled && project ? buildPayload(project, pins) : undefined), [enabled, project, pins]);
  const pinnedChars = useMemo(
    () => pins.reduce((n, path) => n + (project?.files.find((f) => f.path === path)?.text?.length ?? 0), 0),
    [pins, project]
  );

  return { ready, projects, project, pins, pinnedChars, payload, select, add, remove, togglePin, unpin };
}
