/* crypto.randomUUID only exists on https (and newer devices). Fill it in everywhere else. */
if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID !== "function") {
  const uuid = () => {
    const b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  Object.defineProperty(window.crypto, "randomUUID", { value: uuid, configurable: true, writable: true });
}
export {};
