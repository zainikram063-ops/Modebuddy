"use client";

import { Children, isValidElement, memo, useRef, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useArtifact } from "./Artifacts";

function Pre({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const { open } = useArtifact();

  const child = Children.toArray(children)[0];
  const cls = isValidElement(child) ? ((child as ReactElement<{ className?: string }>).props.className ?? "") : "";
  const lang = /language-([\w-]+)/.exec(cls)?.[1] ?? "";
  const previewable = ["html", "svg"].includes(lang);
  const text = () => ref.current?.innerText ?? "";

  return (
    <div className="code">
      <div className="code-bar">
        <span>{lang || "code"}</span>
        <div>
          {previewable && <button onClick={() => open({ lang, code: text() })}>Preview</button>}
          <button onClick={async () => { await navigator.clipboard.writeText(text()); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: Pre,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          a: ({ node, ...p }) => <a {...p} target="_blank" rel="noreferrer" />,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars, @next/next/no-img-element
          img: ({ node, ...p }) => <img {...p} alt={p.alt ?? ""} loading="lazy" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
