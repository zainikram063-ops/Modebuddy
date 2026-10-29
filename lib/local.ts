"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProviderId } from "./providers-meta";
import type { Connector } from "./types";

export type LocalSettings = {
  provider: ProviderId;
  models: Partial<Record<ProviderId, string>>;
  keys: Partial<Record<ProviderId, string>>;
  baseURL: string;
  memoryEnabled: boolean;
  connectors: Connector[];
};

const KEY = "modebuddy.settings.v1";

export const DEFAULT_SETTINGS: LocalSettings = {
  provider: "google",
  models: { google: "gemini-2.5-flash" },
  keys: {},
  baseURL: "",
  memoryEnabled: true,
  connectors: [],
};

/** BYOK settings live only in this browser (localStorage). */
export function useLocalSettings() {
  const [settings, setSettings] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
    } catch {}
    setReady(true);
  }, []);

  const update = useCallback(
    (patch: Partial<LocalSettings> | ((s: LocalSettings) => Partial<LocalSettings>)) =>
      setSettings((prev) => {
        const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {}
        return next;
      }),
    []
  );

  return { settings, update, ready };
}
