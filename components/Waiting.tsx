"use client";
import Thinking from "./Thinking";

/* Shown while waiting for the first words of a reply */
export default function Waiting({ code = false }: { code?: boolean } & Record<string, unknown>) {
  return <Thinking code={code} />;
}
export { Waiting };
