export type LivePerms = { mic: string; screen: string; access: boolean };
export type LiveState = { enabled: boolean; hookOn: boolean; perms: LivePerms };
export type LiveEvent = { type: "start" | "stop" | "cancel" | "hide" | "spoke" | "context"; image?: string | null; app?: string };

type DesktopBridge = {
  desktop: true;
  platform: string;
  version?: number;
  live?: {
    get: () => Promise<LiveState>;
    set: (on: boolean) => Promise<LiveState>;
    request: (kind: "mic" | "screen" | "access") => Promise<LiveState>;
    hide: () => Promise<void>;
    interactive: (on: boolean) => Promise<void>;
    insert: (text: string) => Promise<void>;
    copy: (text: string) => Promise<void>;
    speak: (text: string) => Promise<void>;
    stopSpeaking: () => Promise<void>;
    open: () => Promise<void>;
    restart: () => Promise<void>;
    onEvent: (cb: (e: LiveEvent) => void) => () => void;
  };
};

declare global {
  interface Window {
    modebuddy?: DesktopBridge;
  }
}

export const desktop = () => (typeof window !== "undefined" ? window.modebuddy : undefined);
