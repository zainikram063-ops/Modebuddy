"use client";

import { useEffect, useState } from "react";

export default function DesktopAuth() {
  const [link, setLink] = useState("");

  useEffect(() => {
    const l = "modebuddy://auth" + window.location.search;
    setLink(l);
    window.location.href = l;
  }, []);

  return (
    <div className="legal-wrap">
      <main className="legal" style={{ textAlign: "center", paddingTop: 120 }}>
        <h1>Opening ModeBuddy…</h1>
        <p>You are signed in. Click Open if your browser asks, then you can close this tab.</p>
        {link && (
          <p className="legal-back">
            <a href={link}>Open ModeBuddy</a>
          </p>
        )}
      </main>
    </div>
  );
}
