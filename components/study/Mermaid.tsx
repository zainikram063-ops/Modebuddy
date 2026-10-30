"use client";

import { useEffect, useId, useState } from "react";
import { Check, Copy, Download } from "lucide-react";

type MermaidApi = typeof import("mermaid").default;
let loader: Promise<MermaidApi> | null = null;
const loadMermaid = () =>
  (loader ??= import("mermaid").then(({ default: m }) => {
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "inherit",
      themeVariables: {
        primaryColor: "#f6f1ea", primaryBorderColor: "#b8a898", primaryTextColor: "#1a1714",
        secondaryColor: "#eef4fb", tertiaryColor: "#f7f5f2", lineColor: "#8a7f76", fontSize: "14px",
      },
    });
    return m;
  }));

export default function Mermaid({ code }: { code: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const rid = `mmd${uid}${Math.random().toString(36).slice(2, 8)}`;
    loadMermaid().then(async (m) => {
      try {
        const { svg: out } = await m.render(rid, code);
        if (alive) { setSvg(out); setErr(false); }
      } catch {
        document.getElementById(rid)?.remove();
        document.getElementById(`d${rid}`)?.remove();
        if (alive) setErr(true);
      }
    });
    return () => { alive = false; };
  }, [code, uid]);

  const copy = async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url; a.download = "diagram.svg"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <figure className="diagram">
      {svg ? (
        <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : err ? (
        <>
          <p className="diagram-err">Couldn&apos;t draw this diagram. Here&apos;s the code:</p>
          <pre>{code}</pre>
        </>
      ) : (
        <div className="diagram-loading">Drawing diagram…</div>
      )}
      <figcaption>
        <button type="button" onClick={copy}>{copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}{copied ? "Copied" : "Code"}</button>
        {svg && <button type="button" onClick={download}><Download size={13} strokeWidth={2} />SVG</button>}
      </figcaption>
    </figure>
  );
}
