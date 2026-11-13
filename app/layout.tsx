import Warmup from "@/components/Warmup";
import SideFlip from "../components/SideFlip";
import { Analytics } from "@vercel/analytics/react";
import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono, Fraunces } from "next/font/google";
import "highlight.js/styles/github-dark.css";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], variable: "--font-display", axes: ["wdth"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "ModeBuddy",
  description: "Say less. Get more. ModeBuddy Lura 1.0",
};
export const viewport: Viewport = { themeColor: "#0a0a0a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <body><Warmup />{children}
        <SideFlip />
        <Analytics />
      </body>
    </html>
  );
}
