/* Custom model URLs must be public https addresses (blocks requests into private networks) */
export function isPublicUrl(u?: string) {
  try {
    const { protocol, hostname } = new URL(u ?? "");
    if (protocol !== "https:") return false;
    return !/^(localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)|\.(local|internal)$/i.test(hostname);
  } catch {
    return false;
  }
}
