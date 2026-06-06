import type { Metadata } from "next";
import { PageShell } from "@/components/Chrome";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refund Policy · Liquid Clips",
  description: "How refunds work for Liquid Clips subscriptions and one-off purchases.",
};

export default function RefundsPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <h1 className="page-title">Refund policy</h1>
          <p className="page-lede">
            We want you to use Liquid Clips because it helps. If it doesn&apos;t, we&apos;ll refund
            you on a case-by-case basis under the rules below.
          </p>
          <p className="updated">Last updated: 6 June 2026</p>

          <div className="prose">
            <h2>14-day money-back guarantee</h2>
            <p>
              First-time paid subscribers can request a full refund within 14 days of the first
              charge. Reach out from the email tied to your account.
            </p>

            <h2>Statutory rights (EU / UK)</h2>
            <p>
              Where applicable, consumers in the EU and UK retain their statutory right to
              withdraw within 14 days. Where the digital service has been fully delivered with
              your express consent (e.g. you triggered hosted-AI processing that consumed
              resources on our side), the right may not apply.
            </p>

            <h2>Annual subscriptions</h2>
            <p>
              Annual plans are refundable pro-rata for the unused portion within the first 30
              days. After 30 days, cancellations stop future charges but do not refund the
              already-paid term.
            </p>

            <h2>Whop &amp; Stripe billing</h2>
            <p>
              If you subscribed through Whop, refund eligibility is also subject to Whop&apos;s
              own policies. We&apos;ll co-ordinate the refund where possible.
            </p>

            <h2>Chargebacks</h2>
            <p>
              Filing a chargeback without contacting us first may result in your account being
              suspended pending resolution. Most refund situations are resolved faster by email.
            </p>

            <h2>How to request a refund</h2>
            <p>
              Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> from the address on your
              account. Include the order ID (in your Stripe / Whop receipt) and a sentence on
              why. We respond within two business days.
            </p>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
