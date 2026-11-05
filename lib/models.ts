/* Gemini models. The real list loads live from Google (lib/platform.ts); this is the backup. */
export type PlatformModel = { id: string; label: string; note: string };

export const tierOf = (id: string) => (/flash-lite/.test(id) ? 0 : /flash/.test(id) ? 1 : /pro/.test(id) ? 2 : 3);
const NOTES = ["Fastest · most messages", "Fast · everyday", "Smartest · fewer messages", "Gemini"];
export const noteOf = (id: string) => NOTES[tierOf(id)];
export const versionOf = (id: string) => Number(/^gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] ?? 0);
export const isChatModel = (id: string) =>
  versionOf(id) >= 3 && !/(image|tts|audio|live|embed|robotics|computer-use)/i.test(id);

export const GEMINI_MODELS: PlatformModel[] = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", note: noteOf("gemini-3-flash-preview") },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro", note: noteOf("gemini-3-pro-preview") },
];
export const DEFAULT_MODEL = GEMINI_MODELS[0].id;

/* newest first; within a version: Flash-Lite, Flash, Pro */
export const sortModels = (list: PlatformModel[]) =>
  [...list].sort((a, b) => versionOf(b.id) - versionOf(a.id) || tierOf(a.id) - tierOf(b.id) || a.id.localeCompare(b.id));

/* default = newest Flash-Lite (most free messages) */
export const pickDefault = (list: PlatformModel[]) => (list.find((m) => tierOf(m.id) === 0) ?? list[0])?.id ?? DEFAULT_MODEL;
