/** Basic SSRF guard for user-supplied URLs (custom providers, MCP connectors). */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("That URL isn't valid."); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("URL must start with http:// or https://");
  if (process.env.NODE_ENV === "production") {
    if (u.protocol !== "https:") throw new Error("Use an https:// URL.");
    const h = u.hostname.toLowerCase();
    const priv =
      h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h === "[::1]" ||
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.startsWith("[fc") || h.startsWith("[fd");
    if (priv) throw new Error("Private network addresses aren't allowed.");
  }
  return u;
}
