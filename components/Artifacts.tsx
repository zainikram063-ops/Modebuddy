"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Icon } from "./Icons";

type Artifact = { lang: string; code: string } | null;
const Ctx = createContext<{ artifact: Artifact; open: (a: NonNullable<Artifact>) => void; close: () => void }>({
  artifact: null, open: () => {}, close: () => {},
});
export const useArtifact = () => useContext(Ctx);

export function ArtifactProvider({ children }: { children: ReactNode }) {
  const [artifact, setArtifact] = useState<Artifact>(null);
  return <Ctx.Provider value={{ artifact, open: setArtifact, close: () => setArtifact(null) }}>{children}</Ctx.Provider>;
}

export function ArtifactPanel() {
  const { artifact, close } = useArtifact();
  const [tab, setTab] = useState<"preview" | "code">("preview");
  if (!artifact) return null;

  const isSvg = artifact.lang === "svg";
  const doc = isSvg
    ? `<!doctype html><html><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fff">${artifact.code}</body></html>`
    : artifact.code;

  const download = () => {
    const blob = new Blob([artifact.code], { type: isSvg ? "image/svg+xml" : "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `modebuddy-artifact.${isSvg ? "svg" : "html"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <aside className="artifact" aria-label="Artifact">
      <div className="artifact-head">
        <b>Artifact · {artifact.lang.toUpperCase()}</b>
        <div className="seg">
          <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>Preview</button>
          <button className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}>Code</button>
        </div>
        <button className="tool" onClick={download} title="Download"><Icon name="send" /></button>
        <button className="tool" onClick={close} title="Close"><Icon name="x" /></button>
      </div>
      {tab === "preview" ? (
        <iframe title="Artifact preview" sandbox="allow-scripts allow-modals allow-forms allow-popups" srcDoc={doc} />
      ) : (
        <pre className="artifact-code">{artifact.code}</pre>
      )}
    </aside>
  );
}
