// Client-safe provider metadata
export type ProviderId = "google" | "openai" | "anthropic" | "openrouter" | "groq" | "custom";
export type ModelConfig = { provider: ProviderId; model: string; apiKey: string; baseURL?: string };

type Meta = {
  name: string; recommended?: boolean; keyUrl?: string; note?: string; needsBaseURL?: boolean;
  models: { id: string; label: string }[];
};

export const PROVIDERS: Record<ProviderId, Meta> = {
  google: {
    name: "Google Gemini", recommended: true, keyUrl: "https://aistudio.google.com/apikey",
    note: "Recommended: the most generous free usage limits. Create a key in Google AI Studio in about a minute.",
    models: [
        { id: "gemini-flash-latest", label: "Gemini Flash (Latest)" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
            { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },

    ]
  },
  openai: {
    name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" }, { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1", label: "GPT-4.1" }, { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  },
  anthropic: {
    name: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
    ],
  },
  openrouter: {
    name: "OpenRouter", keyUrl: "https://openrouter.ai/keys",
    note: "One key, hundreds of models. Type any OpenRouter model id.",
    models: [
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "deepseek/deepseek-chat-v3-0324", label: "DeepSeek V3" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    ],
  },
  groq: {
    name: "Groq", keyUrl: "https://console.groq.com/keys", note: "Extremely fast open models.",
    models: [{ id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" }],
  },
  custom: {
    name: "Custom", needsBaseURL: true,
    note: "Any OpenAI-compatible API: Together, DeepSeek, Mistral, Fireworks, a hosted Ollama… Paste the base URL ending in /v1.",
    models: [],
  },
};

export const modelLabel = (c: ModelConfig) =>
  PROVIDERS[c.provider]?.models.find((m) => m.id === c.model)?.label ?? (c.model || "No model");
