"use client";

import Thinking from "./Thinking";

/* Shown while waiting for the first words of a reply: orb + your original thinking words */
export default function Waiting({ code = false }: { code?: boolean }) {
  return (
    <div className="wait" role="status" aria-live="polite">
      <span className="wait-orb" aria-hidden><i /><i /><i /></span>
      <Thinking code={code} />
    </div>
  );
}
