import { buildSkillTools } from "@/lib/skillTools";
import { bucketFor, freeModelFor, limitMessage, spendLimit } from "@/lib/limits";
import { streamText, appendResponseMessages, createIdGenerator, tool, type Message } from "ai";
import { z } from "zod";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createModel } from "@/lib/providers";
import { modelLabel, type ModelConfig } from "@/lib/providers-meta";
import { BUILTIN_MODES, type Mode } from "@/lib/modes";
import { buildSystemPrompt } from "@/lib/persona";
import { parseStudy } from "@/lib/study";
import { makeStudyTools } from "@/lib/study-tools"; // ← NEW
import { weakSpots, weakNote, type Attempt } from "@/lib/progress";
import { loadConnectorTools } from "@/lib/mcp";
import type { Connector } from "@/lib/types"
import { CODE_NOTE } from "@/lib/code";
import { buddyNote } from "@/lib/buddy";
import { ARTIFACT_NOTE } from "@/lib/artifact-note";
import { chatGuard } from "@/lib/guard";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  id: string;
  messages: Message[];
  model: ModelConfig;
  modeId?: string;
  connectors?: Connector[];
  memoryEnabled?: boolean;
  webSearch?: boolean;
  autoMode?: boolean;
  ephemeral?: boolean;
  study?: unknown;
};

type TavilyResult = { title: string; url: string; content?: string; published_date?: string };
type ModeLite = { id: string; name: string; tagline: string };

const WEB_NOTE = `WEB SEARCH
- You have a web_search tool. Use it for anything time-sensitive or that you might not know: news, prices, scores, releases, versions, docs, people, events, "latest", "today", recent years.
- Use focused queries. Run 2-3 searches for comparisons or deep questions. Use topic "news" for current events.
- Cite facts from search inline like [[1]](url), numbering sources in the order you first cite them. Only cite URLs the tool returned.
- If results conflict or are thin, say so. Never paste raw results.`;

const modeNote = (current: string, modes: ModeLite[]) => `MODES
You are in "${current}" mode. Available modes:
${modes.map((m) => `- ${m.id}: ${m.name}${m.tagline ? ` (${m.tagline})` : ""}`).join("\n")}
- If the user's request clearly belongs to a different mode (e.g. debugging code while in a writing mode), call suggest_mode once, then still answer the request fully. The app switches modes for the next messages.
- Don't call it for small tangents, greetings, or when the current mode fits. Never mention the tool by name.`;

const fail = (status: number, error: string) => Response.json({ error }, { status });

function friendlyError(e: unknown, provider: string) {
  const err = e as { statusCode?: number; message?: string };
  const code = err?.statusCode;
  const msg = err?.message ?? String(e);
  if (code === 401 || code === 403 || /api key|unauthori[sz]ed|permission|invalid.*key/i.test(msg))
    return provider === "google" ? "Google didn't accept your Gemini key. Open the model menu and tap “Gemini key” to fix it." : `${provider} rejected your API key. Check Settings → Models.`;
  if (code === 429 || /quota|rate limit|resource.?exhausted/i.test(msg))
    return `${provider} rate limit hit. Wait a moment${provider === "google" ? " (Gemini's free tier resets every minute)" : ""} and retry.`;
  if (code === 404 || /model.*not found|does not exist/i.test(msg))
    return `That model isn't available on ${provider}. Pick another in Settings → Models.`;
  return msg.slice(0, 300);
}

async function handlePOST(req: Request) {
  // ---- auth ----
  const auth = await createServerSupabase();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return fail(401, "Please sign in again.");
  const { data: { session } } = await auth.auth.getSession();

  // RLS-scoped client that keeps working after the response starts streaming
  const db = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${session?.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- input ----
  let body: Body;
  try { body = await req.json(); } catch { return fail(400, "Bad request."); }
  const {
    id: conversationId, model: cfg, modeId = "default", connectors = [],
    memoryEnabled = true, webSearch = false, autoMode = true, ephemeral = false,
  } = body;
  const messages = (body.messages ?? []).slice(-60);
  if (!conversationId || !messages.length) return fail(400, "Nothing to send.");
  if (!cfg?.provider) return fail(400, "Pick a model in Settings → Models.");
  // Everyone uses their own free Gemini key, and the mode picks the model: Kodra gets the best free one, Buddy and Edura use Flash Lite
  if (cfg.provider === "google" && !cfg.apiKey?.trim()) {
    cfg.apiKey = (req.headers.get("x-gemini-key") || "").trim();
    cfg.model = freeModelFor(String(modeId));
    if (!cfg.apiKey) return fail(400, "Add your free Gemini key to start chatting. Open the model menu and tap “Add your free Gemini key”. It takes about a minute.");
  }
  if (!cfg.apiKey?.trim() && cfg.provider !== "custom")
    return fail(400, `Add your ${cfg.provider} API key in Settings → Models.`);

  let model;
  try { model = createModel(cfg); } catch (e) { return fail(400, (e as Error).message); }
  // Fast lane: simple questions on a Pro model are answered by its Flash version (much quicker, same quality for easy stuff)
  const mbEffort = req.headers.get("x-mb-effort") || "medium";
  const mbDeep = /^(high|max|ultra)$/.test(mbEffort) || req.headers.get("x-mb-ultra-code") === "1";
  if (cfg.provider === "google" && /pro/i.test(String(cfg.model || "")) && !mbDeep && (mbEffort === "low" || quickThinking(body))) {
    try { model = createModel({ ...cfg, model: String(cfg.model).replace(/pro/i, "flash") }); } catch { /* keep the chosen model */ }
  }

  // ---- mode ----
  let mode: Mode | undefined = BUILTIN_MODES.find((m) => m.id === modeId);
  if (!mode) {
    const { data } = await db.from("modes").select("*").eq("id", modeId).maybeSingle();
    if (data) mode = { ...(data as Mode), builtin: false };
  }
  mode ??= BUILTIN_MODES[0];
  const currentModeId = mode.id;
  // ---- free plan limits: Buddy and Kodra, counted per account over the last 5 hours (Edura has none) ----
  const limitBucket = bucketFor(mode.id);
  if (limitBucket) {
    const lim = await spendLimit(db, user.id, limitBucket);
    if (!lim.ok) return fail(429, limitMessage(limitBucket, lim.resetAt));
  }

  // ---- persist conversation + latest user message (skipped for compare) ----
  if (!ephemeral) {
    const firstUser = messages.find((m) => m.role === "user");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const now = new Date().toISOString();

    await db.from("conversations").upsert(
      { id: conversationId, user_id: user.id, title: (firstUser?.content || "New chat").replace(/<file[\s\S]*?<\/file>/g, "").trim().slice(0, 60) || "New chat", mode_id: mode.id },
      { onConflict: "id", ignoreDuplicates: true }
    );
    await db.from("conversations").update({ mode_id: mode.id, updated_at: now }).eq("id", conversationId);
    if (lastUser) {
      await db.from("messages").upsert({
        id: lastUser.id, conversation_id: conversationId, user_id: user.id, role: "user",
        content: lastUser.content ?? "", parts: lastUser.parts ?? null, attachments: lastUser.experimental_attachments ?? null,
      });
    }
  }

  // ---- knowledge + memory + modes ----
  const knowledgeQ = db.from("knowledge").select("title,content").eq("mode_id", mode.id).order("created_at");
  const memoryQ = memoryEnabled
    ? db.from("memories").select("id,content").order("created_at")
    : Promise.resolve({ data: [] as { id: string; content: string }[] });
  const modesQ = autoMode
    ? db.from("modes").select("*")
    : Promise.resolve({ data: [] as Mode[] });
  const [{ data: knowledge }, { data: memories }, { data: customModes }] = await Promise.all([knowledgeQ, memoryQ, modesQ]);

  const allModes: ModeLite[] = [...BUILTIN_MODES, ...((customModes ?? []) as Mode[])]
    .filter((m, i, a) => a.findIndex((x) => x.id === m.id) === i)
    .map((m) => ({ id: m.id, name: m.name, tagline: m.tagline ?? "" }));

  // ---- tools ----
  const mcp = await loadConnectorTools(connectors);
  req.signal.addEventListener("abort", () => { mcp.close(); });

  const memoryTools = memoryEnabled
    ? {
        save_memory: tool({
          description: "Save one durable fact or preference about the user for future chats.",
          parameters: z.object({ content: z.string().min(3).max(500).describe("One short sentence") }),
          execute: async ({ content }) => {
            const { data, error } = await db.from("memories").insert({ content, user_id: user.id }).select("id").single();
            return error ? { ok: false, error: error.message } : { ok: true, id: data.id };
          },
        }),
        forget_memory: tool({
          description: "Delete a saved memory by its id when the user asks you to forget something.",
          parameters: z.object({ id: z.string() }),
          execute: async ({ id }) => {
            const { error } = await db.from("memories").delete().eq("id", id);
            return { ok: !error };
          },
        }),
      }
    : {};

  const tavilyKey = process.env.TAVILY_API_KEY;
  const webTools = tavilyKey
    ? {
        web_search: tool({
          description: "Search the web for current or factual information. Returns numbered results with title, url, snippet and date.",
          parameters: z.object({
            query: z.string().min(2).max(300).describe("A focused search query"),
            topic: z.enum(["general", "news"]).optional().describe("Use 'news' for current events"),
            depth: z.enum(["basic", "advanced"]).optional().describe("'advanced' for hard or detailed questions"),
          }),
          execute: async ({ query, topic = "general", depth = "basic" }) => {
            try {
              const r = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${tavilyKey}` },
                body: JSON.stringify({ api_key: tavilyKey, query, topic, search_depth: depth, max_results: 6 }),
                signal: req.signal,
              });
              if (!r.ok) return { ok: false, error: `Search failed (${r.status}).` };
              const j = (await r.json()) as { results?: TavilyResult[] };
              return {
                ok: true,
                query,
                results: (j.results ?? []).map((x, i) => ({
                  n: i + 1, title: x.title, url: x.url, snippet: (x.content ?? "").slice(0, 700), date: x.published_date ?? null,
                })),
              };
            } catch (e) {
              return { ok: false, error: (e as Error).message };
            }
          },
        }),
      }
    : {};

  const modeTools = autoMode && allModes.length > 1
    ? {
        suggest_mode: tool({
          description: "Switch the chat to a better-fitting mode. Call at most once, and only when another mode clearly fits better.",
          parameters: z.object({
            modeId: z.string().describe("id of the better mode"),
            reason: z.string().max(120).describe("Very short reason, e.g. 'debugging a React error'"),
          }),
          execute: async ({ modeId: target, reason }) => {
            const m = allModes.find((x) => x.id === target);
            if (!m || m.id === currentModeId) return { ok: false };
            return { ok: true, modeId: m.id, name: m.name, reason };
          },
        }),
      }
    : {};

  const studyTools = mode.id === "study" ? makeStudyTools(db, user.id, !ephemeral) : {}; // ← NEW

  let system = buildSystemPrompt({
    mode,
    userName: (user.user_metadata?.full_name as string) ?? null,
    memories: memories ?? [],
    knowledge: knowledge ?? [],
    memoryEnabled,
    modelLabel: modelLabel(cfg),
    connectorNames: mcp.names,
    study: parseStudy(body.study),
  });
  if (tavilyKey) {
    system += `\n\n${WEB_NOTE}`;
    if (webSearch) system += `\n- The user turned web search ON: call web_search before answering this message.`;
  }
  if (Object.keys(modeTools).length) system += `\n\n${modeNote(mode.name, allModes)}`;
      if (mode.id === "study") {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [{ data: atts }, { count: due }] = await Promise.all([
      db.from("study_attempts").select("topic,correct,created_at").gte("created_at", since).limit(1000),
      db.from("flashcards").select("id", { count: "exact", head: true }).lte("due_at", new Date().toISOString()),
    ]);
    const weak = weakSpots((atts ?? []) as Attempt[]);
    if (weak.length) system += `\n\n${weakNote(weak)}`;
    if (due) system += `\n\nFLASHCARDS: ${due} card${due > 1 ? "s are" : " is"} due for review. Include short daily review tasks in study plans. If they ask what to do right now, suggest clearing their due cards (the app has a Review button).`;
  }


if (/code/i.test(`${mode.id} ${mode.name}`)) system += `\n\n${CODE_NOTE}`;
if (mode.id === "default") system += `\n\n${buddyNote()}`;
system += `\n\n${ARTIFACT_NOTE}`;

  // ---- skills: expert instructions ModeBuddy loads when a task fits, or when the message starts with /skill-id ----
  const skillTools = await buildSkillTools(db, user.id, mode.id, req.headers.get("x-mb-skills-off") || "", String([...messages].reverse().find((m) => m.role === "user")?.content ?? ""));
  const result = streamText({
    model,
    headers: quickThinking(body) ? { "x-mb-think": "low" } : undefined,
    system,
    messages,
    tools: { ...memoryTools, ...webTools, ...modeTools, ...studyTools, ...skillTools, ...mcp.tools } as Parameters<typeof streamText>[0]["tools"], // ← NEW (...studyTools)
    maxSteps: 8,
    toolCallStreaming: true,
    abortSignal: req.signal,
    experimental_generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
    onFinish: async ({ response }) => {
      await mcp.close();
      if (ephemeral) return;
      const all = appendResponseMessages({ messages, responseMessages: response.messages });
      const fresh = all.slice(messages.length);
      if (fresh.length) {
        await db.from("messages").upsert(
          fresh.map((m) => ({
            id: m.id, conversation_id: conversationId, user_id: user.id, role: m.role,
            content: m.content ?? "", parts: m.parts ?? null, attachments: m.experimental_attachments ?? null,
          }))
        );
      }
      await db.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
    },
    onError: async () => { await mcp.close(); },
  });

  const headers: Record<string, string> = {};
  if (mcp.errors.length) headers["x-connector-errors"] = encodeURIComponent(mcp.errors.join(" | "));
  if (webSearch && !tavilyKey) headers["x-connector-errors"] = encodeURIComponent("Web search needs TAVILY_API_KEY in .env.local");

  return result.toDataStreamResponse({
    headers: Object.keys(headers).length ? headers : undefined,
    getErrorMessage: (e) => friendlyError(e, cfg.provider),
  });
}

/* signed-in users only, with a daily free limit */
export async function POST(req: Request) {
  return (await chatGuard(req)) ?? handlePOST(req as Parameters<typeof handlePOST>[0]);
}

// Simple questions get a fast answer with little thinking; harder ones keep full thinking
function quickThinking(body: unknown) {
  const msgs = ((body as { messages?: { role?: string; content?: unknown }[] } | null)?.messages || []).filter((m) => m.role === "user");
  const t = String(msgs[msgs.length - 1]?.content ?? "");
  return t.length < 280 && !/```|<file|\b(explain|why|how (does|do|can|would)|compare|analy[sz]e|step[- ]by[- ]step|prove|debug|fix|code|script|write|essay|plan|design|calculate|solve|research|detailed?|in depth)\b/i.test(t);
}

// Wakes the server up while you type, so your message is answered sooner
export async function GET() {
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}
