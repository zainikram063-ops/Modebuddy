"use client";

import { useState } from "react";
import { Check, FileDiff, FilePlus, Undo2 } from "lucide-react";
import { applyChange, resolvePath, undoChange, useApplyProject, type Applied } from "@/lib/apply";

export default function ApplyButton({ path, code, diff }: { path?: string; code?: string; diff?: string }) {
  const p = useApplyProject();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<Applied[]>([]);
  if (!p || p.source !== "folder" || !("showDirectoryPicker" in window)) return null;

  const exists = diff ? true : !!(path && resolvePath(p, path));
  const run = async () => {
    setState("busy"); setMsg("");
    try { setDone(await applyChange({ path, code, diff })); setState("done"); }
    catch (e) { setMsg((e as Error).message); setState("error"); }
  };
  const undo = async () => {
    setState("busy");
    try { await undoChange(done); setDone([]); setState("idle"); }
    catch (e) { setMsg((e as Error).message); setState("error"); }
  };

  if (state === "done")
    return (
      <>
        <span className="apply-ok"><Check size={13} strokeWidth={2.5} /> Applied</span>
        <button type="button" onClick={undo}><Undo2 size={13} strokeWidth={2} /> Undo</button>
      </>
    );

  return (
    <>
      {state === "error" && <span className="apply-err" title={msg}>{msg}</span>}
      <button type="button" className="apply" onClick={run} disabled={state === "busy"}
              title={`Write this ${diff ? "change" : "file"} into ${p.name}`}>
        {exists ? <FileDiff size={13} strokeWidth={2} /> : <FilePlus size={13} strokeWidth={2} />}
        {state === "busy" ? "Applying…" : exists ? "Apply" : "Create file"}
      </button>
    </>
  );
}
