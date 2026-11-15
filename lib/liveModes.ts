// Made from your BUILTIN_MODES in lib/modes.ts so Live uses ModeBuddy's real mode colors.
export type LiveMode = { id: string; name: string; color: string; bg: string; icon: string };

export const LIVE_MODES: Record<LiveMode["id"], LiveMode> = {
  "buddy": {
    "id": "buddy",
    "name": "Buddy",
    "color": "#c4ff2e",
    "bg": "#0b0b0a",
    "icon": ""
  },
  "code": {
    "id": "code",
    "name": "Kodra",
    "color": "#58a6ff",
    "bg": "#0d1117",
    "icon": ""
  },
  "study": {
    "id": "study",
    "name": "Edura",
    "color": "#e07a2f",
    "bg": "#14110e",
    "icon": ""
  }
};

export const liveMode = (m: string): LiveMode =>
  /code|dev|kodra/.test(m) ? LIVE_MODES.code : /study|learn|edura/.test(m) ? LIVE_MODES.study : LIVE_MODES.buddy;
