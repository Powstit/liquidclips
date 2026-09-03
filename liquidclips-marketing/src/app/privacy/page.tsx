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
          <p className="updated">Last updated: 3 September 2026</p>

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

            <h2>Google account data (Outreach feature)</h2>
            <p>
              If you choose to connect your Google account through the Outreach feature
              (&ldquo;Link My Email&rdquo;), Liquid Clips requests the <code>contacts.readonly</code>{" "}
              and <code>gmail.metadata</code> scopes solely to help you identify people you have
              already corresponded with as potential outreach targets for your own clipping
              business. This is opt-in: it only happens if you explicitly click &ldquo;Link My
              Email&rdquo; and complete Google&rsquo;s consent screen.
            </p>
            <p>
              For Gmail specifically, Liquid Clips reads only message <strong>metadata</strong> —
              the <code>To:</code> header of your recently sent mail, used to tell which addresses
              you email. Liquid Clips does not request, read, or have technical access to email
              message bodies, attachments, or subject lines under this scope.
            </p>
            <ul>
              <li>We do not read, store, or transmit the body content, attachments, or subject lines of your emails.</li>
              <li>We do not use Gmail or contacts data for advertising or resell it to any third party.</li>
              <li>Access is limited to what the Outreach feature needs to surface outreach suggestions to you.</li>
              <li>
                Google Contacts and Gmail data (recipient addresses and derived outreach
                suggestions) are held only in the app&rsquo;s memory for the duration of your
                Outreach session and are discarded when you close the app or leave the Outreach
                screen. This data is never written to Liquid Clips&rsquo; backend or servers, and
                Google access/refresh tokens are never stored beyond that same session.
              </li>
              <li>You can revoke access at any time from your Google Account&rsquo;s{" "}
                <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
                  third-party app permissions
                </a>{" "}
                page, which immediately stops Liquid Clips from accessing your Google data.
              </li>
            </ul>
            <p>
              Liquid Clips&rsquo; use and transfer of information received from Google APIs to any
              other app will adhere to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noreferrer"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
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

            <h2>Security</h2>
            <ul>
              <li>All traffic between your device, liquidclips.app, the account app, and our backend is encrypted in transit over HTTPS/TLS — including every Google OAuth request and API call the Outreach feature makes.</li>
              <li>Our infrastructure providers (Railway for the backend and database, Vercel for the website and account app) encrypt stored data at rest as a standard part of their managed platforms.</li>
              <li>Access to production systems and admin tooling is restricted to authenticated staff accounts and gated behind server-side authorization checks — no admin action is reachable by an unauthenticated request.</li>
              <li>Google account data handled by the Outreach feature receives an additional layer of protection beyond encryption: as described above, it is held in memory only for the session and is never written to disk, a database, or our backend at all — there is nothing at rest to protect for that data because it is never stored.</li>
              <li>Payment details are handled directly by our processors (Stripe, Clerk Billing, Whop) — Liquid Clips never receives or stores raw card numbers.</li>
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

            <h2>Data controller</h2>
            <p>
              The data controller for this policy is <strong>Liquidclips Ltd</strong>, a company
              registered in England &amp; Wales. Written correspondence and data-protection
              requests can be sent to the address above or by email.
            </p>

            <p style={{ marginTop: 40, opacity: 0.6, fontSize: 12 }}>
              © 2026 Liquidclips Ltd · all rights reserved
            </p>
          </article>
        </div>
      </main>
    </PageShell>
  );
}
