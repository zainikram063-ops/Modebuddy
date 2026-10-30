"use client";

import { Children, isValidElement, memo, useRef, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem";
import { useArtifact } from "./Artifacts";

/* ---------- math ---------- */
const KATEX_OPTS = { throwOnError: false, strict: "ignore" as const, errorColor: "inherit" };
const REMARK: Options["remarkPlugins"] = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];
const REHYPE: Options["rehypePlugins"] = [[rehypeKatex, KATEX_OPTS], rehypeHighlight];
const REHYPE_INLINE: Options["rehypePlugins"] = [[rehypeKatex, KATEX_OPTS]];

/* Things that make $…$ look like math rather than money */
const MATH_HINT = /[\\^_{}=<>]|[a-zA-Z]\d|\d[a-zA-Z]|^[a-zA-Z]$/;

/**
 * Normalises the math styles models use into what remark-math understands,
 * without touching code blocks, inline code or prices like "$5 and $10".
 *   \( x \)  → inline     \[ x \]  → display
 *   $$x$$ alone on a line → display     $x^2$ → inline (only if it looks like math)
 */
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

/* ---------- code blocks ---------- */
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

const components: Components = {
  pre: Pre,
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
