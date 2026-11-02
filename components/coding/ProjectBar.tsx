"use client";

import { FolderGit2, FolderOpen, GitCompare, Pin, Plus, X } from "lucide-react";
import type { ProjectState } from "./useProject";

type Props = { proj: ProjectState; onOpen: (tab: "files" | "review") => void };

export default function ProjectBar({ proj, onOpen }: Props) {
  if (!proj.ready) return null;

  if (!proj.project) {
    return (
      <div className="proj-bar">
        <button type="button" className="proj-add" onClick={() => onOpen("files")}>
          <FolderOpen size={13} strokeWidth={2} /> Add your project
        </button>
        <button type="button" className="pin-add" onClick={() => onOpen("review")}>
          <GitCompare size={12} strokeWidth={2} /> Review changes
        </button>
      </div>
    );
  }

  const tokens = Math.round(proj.pinnedChars / 4);
  const p = proj.project;

  return (
    <div className="proj-bar">
      <button type="button" className="proj-name" onClick={() => onOpen("files")} title={p.stack.join(" · ") || p.name}>
        {p.source === "github" ? <FolderGit2 size={13} strokeWidth={2} /> : <FolderOpen size={13} strokeWidth={2} />}
        <b>{p.name}</b>
        {p.stack.length > 0 && <span>{p.stack.slice(0, 2).join(" · ")}</span>}
      </button>
      {proj.pins.map((path) => (
        <span key={path} className="pin-chip" title={path}>
          <Pin size={11} strokeWidth={2} />
          {path.split("/").pop()}
          <button type="button" onClick={() => proj.unpin(path)} aria-label={`Unpin ${path}`}>
            <X size={11} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <button type="button" className="pin-add" onClick={() => onOpen("files")}>
        <Plus size={12} strokeWidth={2.5} /> {proj.pins.length ? "Pin" : "Pin files"}
      </button>
      <button type="button" className="pin-add" onClick={() => onOpen("review")}>
        <GitCompare size={12} strokeWidth={2} /> Review changes
      </button>
      {tokens > 0 && (
        <small className={`pin-size ${tokens > 20_000 ? "warn" : ""}`} title="Pinned files are sent with every message">
          ≈{tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens
        </small>
      )}
    </div>
  );
}
