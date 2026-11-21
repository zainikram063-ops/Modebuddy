import { tool } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { BUILTIN_SKILLS, modeKind, mySkillId, type Skill, type SkillMode } from "./skills";
import { requestKey } from "./userKey";

type Row = { id: string; name: string; icon: string; mode: SkillMode; when_to_use: string; instructions: string; enabled: boolean };
const YT = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]{6,}/i;

/* Tools for one chat message: use_skill (loads a skill's instructions) and watch_youtube (Gemini watches a video) */
export async function buildSkillTools(db: SupabaseClient, userId: string, modeId: string, off: string, lastText: string) {
  const kind = modeKind(modeId);
  const offSet = new Set(off.split(",").map((s) => s.trim()).filter(Boolean));
  let mine: Skill[] = [];
  try {
    const { data } = await db.from("skills").select("id,name,icon,mode,when_to_use,instructions,enabled").eq("user_id", userId);
    mine = ((data ?? []) as Row[]).filter((r) => r.enabled !== false)
      .map((r) => ({ id: mySkillId(r), name: r.name, icon: r.icon, mode: r.mode || "any", when: r.when_to_use, instructions: r.instructions, mine: true }));
  } catch { /* skills table not set up yet */ }
  const forced = (/^\s*\/([a-z0-9-]+)/i.exec(lastText)?.[1] || "").toLowerCase();
  const list = [...BUILTIN_SKILLS.filter((s) => !offSet.has(s.id)), ...mine].filter((s) => s.mode === kind || s.mode === "any" || s.id === forced);

  const watch = {
    watch_youtube: tool({
      description: "Watch a YouTube video (public link) and get detailed notes with timestamps. Use it whenever the user shares a YouTube link and wants notes, a summary, flashcards, a quiz or answers about the video. For long videos the user can ask for a part (from and to, in minutes).",
      parameters: z.object({
        url: z.string().describe("The YouTube link"),
        from: z.number().optional().describe("Start minute, only if they want part of the video"),
        to: z.number().optional().describe("End minute, only if they want part of the video"),
        focus: z.string().optional().describe("What to focus on, if the user said"),
      }),
      execute: async ({ url, from, to, focus }) => {
        try { await db.from("usage_events").insert({ user_id: userId, bucket: "skill:youtube-video" }); } catch { /* stats only */ }
        return watchYouTube(url, from, to, focus);
      },
    }),
  };
  if (!list.length) return watch;
  return {
    ...watch,
    use_skill: tool({
      description: "Loads a ModeBuddy skill: expert instructions for a kind of task. If the user's request clearly fits one of the skills below, call this FIRST with its id, then follow the returned instructions closely (don't mention skills or this tool unless asked). If the message starts with /<id>, always load that skill first.\nSkills:\n" + list.map((s) => "- " + s.id + ": " + s.when).join("\n"),
      parameters: z.object({ id: z.string().describe("A skill id from the list") }),
      execute: async ({ id }) => {
        const want = id.replace(/^\//, "").trim().toLowerCase();
        const s = list.find((x) => x.id === want);
        if (s) { try { await db.from("usage_events").insert({ user_id: userId, bucket: "skill:" + s.id }); } catch { /* stats only */ } }
        return s ? { ok: true, skill: s.name, instructions: s.instructions } : { ok: false, error: "No skill with that id. Answer normally." };
      },
    }),
  };
}

/* Gemini watches the video itself (with the user's own key) and writes notes */
async function watchYouTube(url: string, from?: number, to?: number, focus?: string) {
  const link = url.trim();
  if (!YT.test(link)) return { ok: false, error: "That doesn't look like a YouTube link." };
  const key = await requestKey();
  if (!key) return { ok: false, error: "Add your free Gemini key first." };
  const part: Record<string, unknown> = { fileData: { fileUri: link.startsWith("http") ? link : "https://" + link } };
  if (from != null || to != null) {
    part.videoMetadata = {
      ...(from != null ? { startOffset: Math.max(0, Math.round(from * 60)) + "s" } : {}),
      ...(to != null ? { endOffset: Math.max(1, Math.round(to * 60)) + "s" } : {}),
    };
  }
  const prompt = "Watch this whole video carefully and write detailed study notes from it.\n1. Title and a 3-line summary.\n2. Key points in the order they come up, each starting with a [mm:ss] timestamp.\n3. Important terms with short definitions.\n4. Formulas, numbers, examples or steps shown.\n5. Five quiz questions with answers.\nOnly use what is actually in the video. If a part is unclear, say so." + (focus ? "\nFocus especially on: " + focus : "");
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [part, { text: prompt }] }],
    generationConfig: { mediaResolution: "MEDIA_RESOLUTION_LOW", maxOutputTokens: 8192, temperature: 0.3 },
  });
  let last = "";
  for (const model of ["gemini-flash-latest", "gemini-flash-lite-latest"]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(110_000),
      });
      const j = await r.json().catch(() => ({}));
      const parts = (j?.candidates?.[0]?.content?.parts ?? []) as { text?: string }[];
      const text = parts.map((p) => p.text || "").join("").trim();
      if (r.ok && text) return { ok: true, notes: text.slice(0, 24_000) };
      last = j?.error?.message || "status " + r.status;
      if (![404, 429, 500, 503].includes(r.status)) break;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  return { ok: false, error: "Couldn't watch that video (" + last.slice(0, 160) + "). It may be private or age-restricted, too long for a free key (ask for a part, like minutes 0 to 20), or Google is busy." };
}
