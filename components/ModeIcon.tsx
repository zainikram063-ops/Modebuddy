import type { ReactNode } from "react";

const LOGOS: Record<string, string> = { "⌥": "/logos/buddy.png", "</>": "/logos/code.png", "✎": "/logos/study.png" };

/* Built-in modes show their logo; custom modes show their own symbol */
export default function ModeIcon({ icon }: { icon: unknown }) {
  const src = typeof icon === "string" ? LOGOS[icon] ?? (/^\/.+\.(png|svg|jpe?g|webp)$/i.test(icon) ? icon : null) : null;
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" className="mode-logo" />;
  return <>{icon as ReactNode}</>;
}
