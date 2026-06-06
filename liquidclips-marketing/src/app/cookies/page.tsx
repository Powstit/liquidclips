import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Cookies &amp; tracking · Liquid Clips",
  description:
    "What cookies and tracking technologies Liquid Clips uses on the website and the desktop app.",
};

const cookies = [
  {
    name: "__session, __clerk_*",
    purpose: "Sign-in session (Clerk).",
    duration: "Session / up to 30 days",
    type: "Essential",
  },
  {
    name: "ph_*",
    purpose: "PostHog product analytics.",
    duration: "Up to 1 year",
    type: "Analytics",
  },
  {
    name: "ll_aff",
    purpose: "First-touch affiliate attribution.",
    duration: "90 days",
    type: "Functional",
  },
  {
    name: "stripe_*",
    purpose: "Stripe checkout / fraud prevention on payment pages.",
    duration: "Session / up to 1 year",
    type: "Essential",
  },
];

export default function CookiesPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <h1 className="page-title">Cookies &amp; tracking</h1>
          <p className="page-lede">
            We use cookies for sign-in, billing, affiliate attribution, and product analytics. No
            ad-network cookies, no third-party retargeting, no surveillance pixels.
          </p>
          <p className="updated">Last updated: 6 June 2026</p>

          <div className="prose">
            <h2>What we set</h2>
            <p>
              The table below covers the cookies and similar storage that our marketing site and
              account app may set in your browser.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 13 }}>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Cookie</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Purpose</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Duration</th>
                  <th style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {cookies.map((c) => (
                  <tr key={c.name}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)", fontFamily: "var(--font-mono)", fontSize: 13 }}>{c.name}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)", fontSize: 14 }}>{c.purpose}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)", fontSize: 13, color: "var(--text-tertiary)" }}>{c.duration}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)", fontSize: 13 }}>{c.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2>Desktop app</h2>
            <p>
              The desktop app does not use browser cookies. It stores a signed licence JWT in
              your operating system keychain to keep you signed in, plus local SQLite cache files
              under the Liquid Clips folder.
            </p>

            <h2>Opting out</h2>
            <p>
              Essential cookies are required for sign-in and billing. You can block analytics
              cookies in your browser settings without breaking core functionality. Opting out of
              affiliate attribution removes your ability to credit a referring creator.
            </p>

            <h2>Related</h2>
            <p>
              See our <Link href="/privacy">privacy policy</Link> for processors, retention, and
              data subject rights. Questions: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
