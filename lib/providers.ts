import { platformConfig, withFallback } from "./platform";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { ModelConfig } from "./providers-meta";
import { assertPublicUrl } from "./net";
import { isPublicUrl } from "@/lib/safe-url";

// Gemini 3.x needs a thought signature on every tool call. AI SDK 4 drops them,
// so this fills in Google's documented placeholder before each request.
const geminiFetch: typeof fetch = async (url, init) => {
  if (init?.body && typeof init.body === "string") {
    const body = JSON.parse(init.body);
    for (const c of body.contents ?? []) {
      for (const p of c.parts ?? []) {
        if (p.functionCall && !p.thoughtSignature) {
          p.thoughtSignature = "skip_thought_signature_validator";
        }
      }
    }
    init = { ...init, body: JSON.stringify(body) };
  }
  return fetch(url, init);
};

export function createModel(c: ModelConfig) {
  if (!c.apiKey?.trim() && c.provider !== "custom") Object.assign(c, platformConfig(c));
  if (c.provider === "custom" && process.env.NODE_ENV === "production" && !isPublicUrl((c as { baseURL?: string }).baseURL)) throw new Error("Custom model URL must be a public https:// address.");
  const apiKey = c.apiKey?.trim();
  if (!c.model) throw new Error("Pick a model in Settings → Models.");
  switch (c.provider) {
    case "google": return createGoogleGenerativeAI({ apiKey, fetch: withFallback(geminiFetch) })(c.model);
    case "openai": return createOpenAI({ apiKey }).chat(c.model);
    case "anthropic": return createAnthropic({ apiKey })(c.model);
    case "openrouter":
      return createOpenAI({
        apiKey, baseURL: "https://openrouter.ai/api/v1", compatibility: "compatible",
        headers: { "X-Title": "ModeBuddy" },
      }).chat(c.model);
    case "groq":
      return createOpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1", compatibility: "compatible" }).chat(c.model);
    case "custom": {
      if (!c.baseURL) throw new Error("Add a base URL for your custom provider.");
      assertPublicUrl(c.baseURL);
      return createOpenAI({ apiKey: apiKey || "not-needed", baseURL: c.baseURL.replace(/\/$/, ""), compatibility: "compatible" }).chat(c.model);
    }
    default: throw new Error("Unknown provider.");
  }
}
