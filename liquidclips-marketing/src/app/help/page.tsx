import Link from "next/link";
import type { Metadata } from "next";
import { PageShell } from "@/components/Chrome";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Help Center",
  description: "Liquid Clips help center for getting started, publishing, billing, and troubleshooting.",
};

const articles = [
  {
    href: "/help/getting-started",
    label: "Getting started",
    body: "Install the Mac app, sign in, add your OpenAI key if needed, and make your first clip.",
  },
  {
    href: "/help/publishing",
    label: "Publishing",
    body: "Connect Ayrshare, choose platforms, schedule posts, and understand what stays local.",
  },
  {
    href: "/help/billing-and-plans",
    label: "Billing and plans",
    body: "Free exports, Solo, Pro hosted AI, Agency limits, refunds, and account changes.",
  },
  {
    href: "/help/troubleshooting",
    label: "Troubleshooting",
    body: "Fix download, transcription, keychain, update, and Gatekeeper issues before contacting support.",
  },
];

export default function HelpHome() {
  return (
    <PageShell>
      <main className="help-page">
        <section className="help-hero">
          <div className="container">
            <div className="eyebrow">Help center</div>
            <h1 className="page-title">Get unstuck and keep clipping.</h1>
            <p className="page-lede">
              Practical setup and recovery guides for the Liquid Clips desktop app.
              For account-specific help, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>
          </div>
        </section>

        <section className="section">
          <div className="container help-grid">
            {articles.map((article) => (
              <Link className="help-card" href={article.href} key={article.href}>
                <span>{article.label}</span>
                <p>{article.body}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </PageShell>
  );
}
