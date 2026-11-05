"use client";

import { useEffect, useState } from "react";
import { pickGreeting } from "@/lib/greetings";

/* A new greeting for every new chat; the name keeps its green style */
export default function Greeting({ name, fallback = "Hey" }: { name?: string; fallback?: string }) {
  const [g, setG] = useState<[string, string, string] | null>(null);
  useEffect(() => { setG(pickGreeting(name ?? "", new Date())); }, [name]);
  if (!g) return <span style={{ visibility: "hidden" }}>{fallback}, {name}.</span>;
  const end = /[.?!]$/.test((g[1] ? g[2] : g[0]).trim()) ? "" : ".";
  return <>{g[0]}{g[1] && <span>{g[1]}</span>}{g[2]}{end}</>;
}
