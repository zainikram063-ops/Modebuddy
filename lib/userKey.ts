import { headers } from "next/headers";

/* The user's own Gemini key. The browser sends it with each request; ModeBuddy never saves it. */
export async function requestKey(): Promise<string> {
  try {
    return ((await headers()).get("x-gemini-key") || "").trim();
  } catch {
    return "";
  }
}
