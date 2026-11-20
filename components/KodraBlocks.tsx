"use client";
import { useState } from "react";

export type KFile = { path: string; lang: string; code: string };
type QData = { intro?: string; questions: { q: string; options?: string[]; multi?: boolean }[] };
type Seg = { type: "md"; text: string } | { type: "questions"; data: QData } | { type: "actions"; data: string[] } | { type: "wait"; text: string };

const SKIP = "You decide";

/* Splits a Kodra reply into normal text, question cards and quick replies, and collects the project's files */
export function splitKodra(md: string) {
  const lines = md.split("\n");
  const segs: Seg[] = [];
  const files = new Map<string, KFile>();
  let buf: string[] = [];
  let closed = true;
  const flush = () => { if (buf.length) { segs.push({ type: "md", text: buf.join("\n") }); buf = []; } };
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/.exec(lines[i]);
    if (!open) { buf.push(lines[i]); continue; }
    const [, indent, fence, rawLang, meta] = open;
    const lang = rawLang.toLowerCase();
    const shut = new RegExp("^\\s*" + (fence[0] === "`" ? "`" : "~") + "{" + fence.length + ",}\\s*$");
    let j = i + 1;
    while (j < lines.length && !shut.test(lines[j])) j++;
    const ended = j < lines.length;
    const body = lines.slice(i + 1, j).join("\n");
    if (lang === "questions" || lang === "actions") {
      flush();
      if (!ended) { segs.push({ type: "wait", text: lang === "questions" ? "Writing questions…" : "" }); closed = false; break; }
      let ok = false;
      try {
        const data = JSON.parse(body);
        if (lang === "questions" && data && Array.isArray(data.questions)) { segs.push({ type: "questions", data }); ok = true; }
        if (lang === "actions" && Array.isArray(data)) { segs.push({ type: "actions", data: data.map(String).slice(0, 4) }); ok = true; }
      } catch { /* not valid JSON: show it as text */ }
      if (!ok) buf.push(...lines.slice(i, j + 1));
      i = j;
      continue;
    }
    const fm = /(?:^|\s)(?:file|filename|path|title)=["']?([^"'\s]+)/.exec(meta);
    if (fm) {
      const path = fm[1].replace(/^\.?\//, "");
      files.set(path, { path, lang, code: body });
      buf.push("**`" + path + "`**", indent + fence + rawLang);
    } else buf.push(lines[i]);
    buf.push(...lines.slice(i + 1, j));
    if (ended) buf.push(lines[j]);
    else closed = false;
    i = j;
  }
  flush();
  return { segs, files: [...files.values()], closed };
}

/* Puts text in the chat box and sends it. If there's no chat box, copies it instead. */
function sendToChat(text: string) {
  const box = Array.from(document.querySelectorAll("textarea")).filter((t) => t.offsetParent !== null).pop();
  if (!box) { navigator.clipboard?.writeText(text).catch(() => {}); return false; }
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.focus();
  setTimeout(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })), 80);
  return true;
}

export function KodraQuestions({ data }: { data: QData }) {
  const qs = data.questions.filter((q) => q && typeof q.q === "string").slice(0, 12);
  const [picked, setPicked] = useState<string[][]>(() => qs.map(() => []));
  const [typed, setTyped] = useState<string[]>(() => qs.map(() => ""));
  const [state, setState] = useState<"" | "sent" | "copied">("");
  const has = (i: number) => (picked[i]?.length ?? 0) > 0 || !!typed[i]?.trim();
  const left = qs.filter((_, i) => !has(i)).length;
  const toggle = (i: number, opt: string, multi?: boolean) =>
    setPicked((p) => p.map((row, k) => {
      if (k !== i) return row;
      if (row.includes(opt)) return row.filter((o) => o !== opt);
      if (!multi || opt === SKIP) return [opt];
      return [...row.filter((o) => o !== SKIP), opt];
    }));
  const send = () => {
    const text = "Here are my answers:\n" + qs.map((q, i) => (i + 1) + ". " + q.q + " → " + ([...(picked[i] || []), (typed[i] || "").trim()].filter(Boolean).join(", ") || SKIP)).join("\n");
    setState(sendToChat(text) ? "sent" : "copied");
  };
  return (
    <div className="kd-q">
      <style>{KD_CSS}</style>
      {data.intro && <p className="kd-q-intro">{data.intro}</p>}
      {qs.map((q, i) => (
        <div key={i} className="kd-q-item">
          <div className="kd-q-title"><span>{i + 1}</span><div>{q.q}{q.multi && <em> · pick any</em>}</div></div>
          <div className="kd-q-opts">
            {[...(q.options || []).map(String).filter((o) => o !== SKIP).slice(0, 6), SKIP].map((o) => (
              <button key={o} type="button" className={picked[i]?.includes(o) ? "on" : ""} disabled={!!state} onClick={() => toggle(i, o, q.multi)}>{o}</button>
            ))}
          </div>
          <input className="kd-q-other" placeholder="Or type your own answer…" value={typed[i] || ""} disabled={!!state}
            onChange={(e) => { const v = e.target.value; setTyped((t) => t.map((x, k) => (k === i ? v : x))); }} />
        </div>
      ))}
      <div className="kd-q-foot">
        <span>{state === "sent" ? "Answers sent" : state === "copied" ? "Copied your answers. Paste them in the chat." : left ? "Answer all " + qs.length + " to continue (" + left + " left). Tap “You decide” to skip one." : "All set. Send them over!"}</span>
        <button type="button" className="kd-q-send" disabled={!!state || left > 0} onClick={send}>{state === "sent" ? "Sent ✓" : "Send answers"}</button>
      </div>
    </div>
  );
}

export function KodraActions({ data }: { data: string[] }) {
  const [sent, setSent] = useState("");
  return (
    <div className="kd-act">
      <style>{KD_CSS}</style>
      {data.map((a) => <button key={a} type="button" className={sent === a ? "on" : ""} disabled={!!sent} onClick={() => { if (sendToChat(a)) setSent(a); }}>{a}</button>)}
    </div>
  );
}

export function KodraProject({ files, done }: { files: KFile[]; done: boolean }) {
  const [show, setShow] = useState(false);
  const web = files.some((f) => /(^|\/)index\.html?$/i.test(f.path));
  const name = projectName(files);
  return (
    <div className="kd-proj">
      <style>{KD_CSS}</style>
      <div className="kd-proj-head"><b>{name}</b><span>{files.length} file{files.length === 1 ? "" : "s"}{done ? "" : " · still writing…"}</span></div>
      <div className="kd-proj-files">{files.map((f) => <code key={f.path}>{f.path}</code>)}</div>
      <div className="kd-proj-btns">
        <button type="button" disabled={!done} onClick={() => download(name + ".zip", zip(files))}>Download .zip</button>
        {web && <button type="button" disabled={!done} onClick={() => setShow((v) => !v)}>{show ? "Hide preview" : "Preview"}</button>}
      </div>
      {show && web && <iframe className="kd-proj-view" title="Preview" sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={previewHtml(files)} />}
    </div>
  );
}

function projectName(files: KFile[]) {
  const roots = new Set(files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")));
  const r = roots.size === 1 ? [...roots][0] : "";
  return (r || "kodra-project").replace(/[^\w.-]+/g, "-");
}

/* Builds one page for the preview: index.html with its own CSS and JS files put inside it */
function previewHtml(files: KFile[]) {
  const by = new Map(files.map((f) => [f.path, f.code] as [string, string]));
  const index = files.find((f) => /(^|\/)index\.html?$/i.test(f.path));
  if (!index) return "";
  const base = index.path.includes("/") ? index.path.slice(0, index.path.lastIndexOf("/") + 1) : "";
  const get = (ref: string) => {
    const r = ref.split(/[?#]/)[0].replace(/^\.\//, "");
    return by.get(base + r) ?? by.get(r) ?? null;
  };
  const late: string[] = [];
  let html = index.code
    .replace(/<link\b[^>]*?href=["']([^"']+?\.css)["'][^>]*>/gi, (m, href: string) => { const css = get(href); return css == null ? m : "<style>\n" + css + "\n</style>"; })
    .replace(/<script\b([^>]*?)\bsrc=["']([^"']+?\.m?js)["']([^>]*)>\s*<\/script>/gi, (m, a: string, src: string, b: string) => {
      const js = get(src);
      if (js == null) return m;
      const attrs = (a + " " + b).replace(/\s+/g, " ").trim();
      const clean = attrs.replace(/\bdefer\b/i, "").trim();
      const tag = "<script" + (clean ? " " + clean : "") + ">\n" + js.replace(/<\/script/gi, "<\\/script") + "\n</script>";
      if (/\bdefer\b/i.test(attrs)) { late.push(tag); return ""; }
      return tag;
    });
  if (late.length) html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, late.join("\n") + "\n</body>") : html + late.join("\n");
  return html;
}

/* A small zip maker (no compression), so projects download in one file */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files: KFile[]) {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path), data = enc.encode(f.code), crc = crc32(data);
    const head = new Uint8Array(30 + name.length), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true); head.set(name, 30);
    const cen = new Uint8Array(46 + name.length), c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true); cen.set(name, 46);
    parts.push(head, data); central.push(cen); offset += head.length + data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as unknown as BlobPart[], { type: "application/zip" });
}
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const KD_CSS = [
  ".kd-q,.kd-proj{margin:12px 0;padding:14px 16px;border:1px solid rgba(127,127,127,.25);border-radius:14px;background:rgba(127,127,127,.06)}",
  ".kd-q-intro{margin:0 0 6px;font-weight:500}",
  ".kd-q-item{padding:12px 0;border-top:1px solid rgba(127,127,127,.15)}",
  ".kd-q-intro+.kd-q-item,.kd-q>style+.kd-q-item{border-top:0}",
  ".kd-q-title{display:flex;gap:10px;align-items:flex-start;font-weight:600;margin-bottom:9px}",
  ".kd-q-title span{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11.5px;background:rgba(196,255,46,.2)}",
  ".kd-q-title em{font-style:normal;font-weight:400;font-size:12.5px;opacity:.6}",
  ".kd-q-opts{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px 32px}",
  ".kd-q-opts button,.kd-act button,.kd-proj-btns button{padding:6px 13px;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;transition:background .15s,border-color .15s}",
  ".kd-q-opts button:hover:not(:disabled),.kd-act button:hover:not(:disabled),.kd-proj-btns button:hover:not(:disabled){border-color:#c4ff2e}",
  ".kd-q-opts button.on,.kd-act button.on{background:#c4ff2e;border-color:#c4ff2e;color:#11130a}",
  ".kd-q-other{display:block;width:calc(100% - 32px);margin-left:32px;box-sizing:border-box;padding:7px 11px;border-radius:9px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:13px}",
  ".kd-q-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px;font-size:12.5px}",
  ".kd-q-foot span{opacity:.75}",
  ".kd-q-send{flex:none;padding:8px 18px;border-radius:999px;border:0;background:#c4ff2e;color:#11130a;font:inherit;font-weight:600;cursor:pointer}",
  ".kd-q-send:disabled,.kd-proj-btns button:disabled,.kd-act button:disabled:not(.on){opacity:.45;cursor:default}",
  ".kd-act{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}",
  ".kd-proj-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}",
  ".kd-proj-head span{font-size:12.5px;opacity:.65}",
  ".kd-proj-files{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 12px}",
  ".kd-proj-files code{font-size:12px;padding:2px 8px;border-radius:6px;background:rgba(127,127,127,.14)}",
  ".kd-proj-btns{display:flex;gap:8px}",
  ".kd-proj-view{display:block;width:100%;height:520px;margin-top:12px;border:1px solid rgba(127,127,127,.25);border-radius:10px;background:#fff}",
  ".kd-wait{opacity:.6;font-size:13px;margin:8px 0}",
].join("");
