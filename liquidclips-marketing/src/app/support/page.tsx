import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Support · Liquid Clips",
  description: "How to get help with Liquid Clips — install, billing, AI keys, publishing.",
};

const channels = [
  {
    label: "Email",
    value: supportEmail,
    href: `mailto:${supportEmail}`,
    note: "Two business days, faster on weekdays.",
  },
  {
    label: "Help center",
    value: "/help",
    href: "/help",
    note: "Self-serve answers for install, AI keys, publishing.",
  },
  {
    label: "Status",
    value: "/status",
    href: "/status",
    note: "Live service health and recent incidents.",
  },
];

const topics = [
  {
    title: "Install &amp; first launch",
    body: "Gatekeeper warnings, sidecar install timing, Apple Silicon vs Intel.",
  },
  {
    title: "Billing &amp; refunds",
    body: "Subscription changes, switching tiers, Stripe vs Whop, refund requests.",
  },
  {
    title: "AI keys &amp; hosted AI",
    body: "OpenAI key setup for Free/Solo, hosted AI rollout for Pro/Agency.",
  },
  {
    title: "Publishing &amp; channels",
    body: "Connecting Ayrshare, channel errors, scheduling and drip workflows.",
  },
];

export default function SupportPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <h1 className="page-title">Support</h1>
          <p className="page-lede">
            One inbox, one help center, one status page. We answer everything from
            install warnings to refund requests at the same address.
          </p>

          <div className="prose">
            <h2>Contact</h2>
            <div className="feature-grid">
              {channels.map((c) => (
                <article className="tile" key={c.label}>
                  <h3>{c.label}</h3>
                  <p>
                    {c.href.startsWith("mailto:") ? (
                      <a href={c.href}>{c.value}</a>
                    ) : (
                      <Link href={c.href}>{c.value}</Link>
                    )}
                  </p>
                  <p>{c.note}</p>
                </article>
              ))}
            </div>

            <h2>Common topics</h2>
            <div className="feature-grid">
              {topics.map((t) => (
                <article className="tile" key={t.title}>
                  <h3 dangerouslySetInnerHTML={{ __html: t.title }} />
                  <p dangerouslySetInnerHTML={{ __html: t.body }} />
                </article>
              ))}
            </div>

            <h2>Security &amp; data</h2>
            <p>
              For data deletion or subject access requests, see{" "}
              <Link href="/account-deletion">account deletion</Link> and our{" "}
              <Link href="/privacy">privacy policy</Link>. For security disclosures, email{" "}
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with &quot;SECURITY&quot; in
              the subject line.
            </p>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
