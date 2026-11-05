import Link from "next/link";

export const metadata = { title: "Privacy Policy · ModeBuddy" };

const EMAIL = "modebuddy5@email.com";

export default function Privacy() {
  return (
    <div className="legal-wrap">
      <main className="legal">
        <h1>Privacy Policy</h1>
        <p className="legal-date">Last updated: November  5, 2026</p>
        <p>ModeBuddy is an AI chat and study assistant. This page explains what we collect, why, and the choices you have.</p>

        <h2>What we collect</h2>
        <ul>
          <li><b>Account details:</b> your email address, plus your name and profile picture if you sign in with Google.</li>
          <li><b>Your chats:</b> the messages you send and the replies you get, so you can see your history.</li>
          <li><b>Settings and usage:</b> your preferences and how many messages you send each day, for fair-use limits.</li>
        </ul>

        <h2>How we use it</h2>
        <p>Only to run ModeBuddy: to sign you in, save your chats, create AI replies and keep the service fair for everyone. We never sell your data or use it for advertising.</p>

        <h2>Services we use</h2>
        <ul>
          <li><b>Supabase</b> stores your account and chats.</li>
          <li><b>Google Gemini</b> creates the AI replies, so your messages are sent to it.</li>
          <li><b>A web search service</b> receives your search terms when a reply uses web search.</li>
          <li><b>Vercel</b> hosts the website.</li>
          <li><b>Google Sign-In</b> is used if you choose to log in with Google.</li>
        </ul>

        <h2>Cookies</h2>
        <p>We only use cookies to keep you signed in. We do not use tracking or advertising cookies.</p>

        <h2>Shared chats</h2>
        <p>If you share a chat, anyone with the link can read it, so only share what you are happy for others to see.</p>

        <h2>Your choices</h2>
        <p>You can delete your chats at any time. To delete your account and all of your data, email <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>

        <h2>Children</h2>
        <p>ModeBuddy is not meant for children under 13.</p>

        <h2>Changes</h2>
        <p>If this policy changes, we will update this page and the date above.</p>

        <h2>Contact</h2>
        <p>Questions? Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>

        <p className="legal-back"><Link href="/">← Back to ModeBuddy</Link></p>
      </main>
    </div>
  );
}
