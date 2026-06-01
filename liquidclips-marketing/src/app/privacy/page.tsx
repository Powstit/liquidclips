import type { Metadata } from "next";
import { PageShell } from "@/components/Chrome";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Liquid Clips handles account data, local videos, analytics, payments, social publishing, hosted AI, and support requests.",
};

export default function PrivacyPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <div className="eyebrow">Privacy</div>
          <h1 className="page-title">Privacy policy</h1>
          <p className="page-lede">
            Liquid Clips is local-first. Your source videos, generated clips, and transcripts
            stay on your device for local-tier workflows. Our analytics are built around
            internal IDs and product events, not your content.
          </p>
          <p className="updated">Last updated: 1 June 2026</p>

          <article className="prose">
            <h2>Who we are</h2>
            <p>
              This policy explains how Liquid Clips handles personal data for liquidclips.app,
              the Liquid Clips desktop app, the account app, and related backend services.
              Contact us at <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>

            <h2>Data we collect</h2>
            <ul>
              <li>Account data such as email address, name if provided, user ID, and sign-in state through Clerk.</li>
              <li>Billing and entitlement data such as plan, subscription status, renewal dates, and payment processor references through Stripe, Clerk Billing, or Whop.</li>
              <li>Affiliate attribution, including referral IDs captured from links or cookies and connected to your account if you sign up through a referral.</li>
              <li>Product analytics through PostHog, limited to internal IDs, tier, feature usage, event names, and funnel status.</li>
              <li>Support messages and operational diagnostics you choose to send us.</li>
            </ul>

            <h2>Data we do not send to analytics</h2>
            <p>
              We do not send raw emails, API keys, license JWTs, access tokens, local file paths,
              filenames, transcript text, or video content to PostHog analytics.
            </p>

            <h2>Videos, clips, and transcripts</h2>
            <p>
              Local-tier workflows process files on your device. Source videos, generated clips,
              transcripts, and project folders are stored locally unless you choose to publish,
              submit, share, or use a hosted feature.
            </p>
            <div className="note-box">
              <p>
                Hosted AI for Pro and Agency may send the minimum content needed to our backend
                and AI processor to generate the requested result. Social publishing sends media
                and post metadata to Ayrshare and the target social platforms you choose.
              </p>
            </div>

            <h2>AI provider keys</h2>
            <p>
              Free and Solo users bring their own AI provider key. The desktop app stores local
              secrets in the operating system keychain. Pro and Agency are designed to use a
              hosted Liquid Clips proxy so you do not need to provide your own key for covered
              features.
            </p>

            <h2>Cookies and local storage</h2>
            <ul>
              <li>Referral cookies remember affiliate attribution so first-touch credit works.</li>
              <li>Analytics cookies or local storage may help us understand activation, checkout, and product funnels.</li>
              <li>The desktop app may use local storage for local workflow state such as submission tracking and first-run state.</li>
            </ul>

            <h2>Subprocessors</h2>
            <ul>
              <li>Clerk for authentication and account management.</li>
              <li>Stripe and Clerk Billing for card processing and subscriptions.</li>
              <li>Whop for memberships, Content Rewards context, affiliate tracking, and certain payouts.</li>
              <li>PostHog for product analytics using internal IDs only.</li>
              <li>Ayrshare for social connection and publishing workflows.</li>
              <li>OpenAI or other configured AI providers for hosted AI features.</li>
              <li>Railway and Vercel for backend and website hosting.</li>
              <li>Resend or another email provider for transactional email.</li>
            </ul>

            <h2>Retention</h2>
            <p>
              We keep account, entitlement, billing, and security records while your account is
              active and as needed for legal, tax, security, and accounting purposes. We delete
              or anonymise data when it is no longer needed.
            </p>

            <h2>Your rights</h2>
            <p>
              Depending on where you live, you may request access, correction, deletion, export,
              or restriction of your personal data. Email{" "}
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a> and we will respond.
            </p>

            <h2>Children</h2>
            <p>
              Liquid Clips is not directed to anyone under 18. We do not knowingly collect
              personal data from children.
            </p>

            <h2>Changes</h2>
            <p>
              We may update this policy as the product changes. The date above shows the latest
              version.
            </p>
          </article>
        </div>
      </main>
    </PageShell>
  );
}
