import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { accountUrl, supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Delete your account · Liquid Clips",
  description:
    "How to permanently delete your Liquid Clips account, subscription, and all associated data.",
};

export default function AccountDeletionPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <h1 className="page-title">Delete your account</h1>
          <p className="page-lede">
            You can permanently delete your Liquid Clips account, cancel any active subscription,
            and request removal of all server-side data tied to your email.
          </p>
          <p className="updated">Last updated: 6 June 2026</p>

          <div className="prose">
            <h2>Self-serve from the dashboard</h2>
            <p>
              Sign in at{" "}
              <a href={`${accountUrl}/dashboard`}>{accountUrl.replace(/^https?:\/\//, "")}/dashboard</a>{" "}
              and open Settings → Account → Delete account. Deletion confirms by email, cancels
              any active subscription, and removes your account record within 30 days.
            </p>

            <h2>By email</h2>
            <p>
              If you can&apos;t reach the dashboard, email{" "}
              <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Account deletion request")}`}>{supportEmail}</a>{" "}
              from the address tied to your account with the subject{" "}
              <strong>Account deletion request</strong>. We&apos;ll confirm the request and
              complete it within 30 days.
            </p>

            <h2>What gets deleted</h2>
            <ul>
              <li>Your account record (email, Clerk identity, tier metadata).</li>
              <li>Your subscription record on our side. Stripe and Whop receipts remain in those processors as legally required.</li>
              <li>Server-stored notification history, alerts, and admin inbox entries tied to you.</li>
              <li>Any Ayrshare connection metadata cached server-side.</li>
            </ul>

            <h2>What we may retain</h2>
            <ul>
              <li>Aggregated, non-identifying analytics counts.</li>
              <li>Billing records required by tax and accounting law (invoices, payment receipts).</li>
              <li>Security and abuse logs needed to investigate prior incidents (purged on schedule).</li>
              <li>Anything you exported to your own machine — those files live on your device and we never had a copy.</li>
            </ul>

            <h2>Cancelling vs. deleting</h2>
            <p>
              Cancelling your subscription stops future charges but keeps your account so you can
              resume later with the same email. Deleting your account is permanent and removes
              the account record entirely.
            </p>

            <h2>Other rights</h2>
            <p>
              For data access (subject access) or data export requests, see the{" "}
              <Link href="/privacy">privacy policy</Link> or email{" "}
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
