import type { Metadata } from "next";
import Link from "next/link";
import { supportEmail } from "@/lib/site";
import { PageShell } from "@/components/Chrome";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms for using Liquid Clips, including accounts, billing, content rights, acceptable use, Whop Content Rewards, and affiliate terms.",
};

export default function TermsPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <div className="eyebrow">Terms</div>
          <h1 className="page-title">Terms of service</h1>
          <p className="page-lede">
            These terms govern your use of Liquid Clips. The headings are plain-language,
            but the terms below are the agreement.
          </p>
          <p className="updated">Last updated: 1 June 2026</p>

          <article className="prose">
            <h2>1. Acceptance</h2>
            <p>
              By downloading, accessing, or using Liquid Clips, you agree to these Terms.
              If you do not agree, do not use Liquid Clips.
            </p>

            <h2>2. The service</h2>
            <p>
              Liquid Clips is a desktop application and related web service for turning
              long-form recordings into short clips, preparing metadata, publishing or
              scheduling content, and working with Whop Content Rewards. Features vary by plan.
            </p>

            <h2>3. Eligibility and accounts</h2>
            <p>
              You must be at least 18 to use Liquid Clips. You are responsible for your
              account, credentials, connected services, local files, and activity under your account.
            </p>

            <h2>4. Plans and billing</h2>
            <ul>
              <li>Liquid Clips has Free, Solo, Pro, and Agency plans in the public checkout.</li>
              <li>Paid plans renew monthly unless cancelled. Access continues until the end of the paid period unless we are required to terminate access sooner.</li>
              <li>Card processing and subscription management are handled by Stripe, Clerk Billing, or Whop. We do not store card numbers.</li>
              <li>Prices may change, but changes do not affect the current paid period you already purchased.</li>
            </ul>

            <h2>5. AI keys and hosted AI</h2>
            <p>
              Free and Solo users may need to provide their own AI provider key. You are
              responsible for your usage and any provider charges. Pro and Agency are designed
              to use Liquid Clips hosted AI for covered features, subject to fair-use and abuse
              limits.
            </p>

            <h2>6. Content rights</h2>
            <p>
              You keep ownership of the videos, clips, captions, metadata, and other content
              you create. You grant us only the rights needed to provide the service you request.
              You must have the rights needed to upload, clip, publish, or submit any content you use.
            </p>

            <h2>7. Whop Content Rewards</h2>
            <p>
              Liquid Clips is an independent tool. We are not Whop, and we do not control Whop
              reward campaigns, approval decisions, view counts, or payouts. Liquid Clips can
              help prepare clips and track your local workflow, but Whop and the campaign brand
              decide whether a submission is accepted or paid.
            </p>

            <h2 id="affiliate">8. Affiliate and partner terms</h2>
            <ul>
              <li>You must have an active paid Liquid Clips subscription, Solo or higher, to earn affiliate commission.</li>
              <li>Commission applies only to qualifying referred paid customers, not free accounts, trials, refunds, chargebacks, test payments, self-referrals, or invalid traffic.</li>
              <li>Attribution is first-touch where technically possible and may be rejected for fraud, abuse, duplicate accounts, or policy violations.</li>
              <li>Payout setup, thresholds, and timing may be handled by Whop or Stripe Connect depending on the partner flow available to your account.</li>
            </ul>

            <h2>9. Social publishing</h2>
            <p>
              If you connect social accounts through Ayrshare or another processor, you are
              responsible for the posts, captions, schedules, account permissions, and platform
              compliance. You can disconnect supported integrations from the app or relevant provider.
            </p>

            <h2>10. Acceptable use</h2>
            <ul>
              <li>Do not use Liquid Clips to break the law, infringe rights, or impersonate others.</li>
              <li>Do not submit content you do not have permission to use.</li>
              <li>Do not abuse the hosted AI proxy, publishing infrastructure, affiliate program, or reward workflows.</li>
              <li>Do not reverse engineer, disrupt, scrape, overload, or bypass limits in the service.</li>
            </ul>

            <h2>11. Disclaimers</h2>
            <p>
              Liquid Clips is provided as is and as available. We do not guarantee earnings,
              views, approval, platform reach, uninterrupted service, or error-free output.
            </p>

            <h2>12. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, Liquid Clips is not liable for indirect,
              incidental, special, consequential, or lost-profit damages. Our total liability is
              limited to the amount you paid Liquid Clips in the 12 months before the claim.
            </p>

            <h2>13. Termination</h2>
            <p>
              You may stop using Liquid Clips at any time. We may suspend or terminate access
              if you breach these Terms, create risk, fail to pay, or abuse the service.
            </p>

            <h2>14. Governing law</h2>
            <p>
              These Terms are governed by the laws of England and Wales, except where mandatory
              consumer law gives you other rights.
            </p>

            <h2>15. Contact</h2>
            <p>
              Questions about these Terms can be sent to{" "}
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. You can also review the{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </article>
        </div>
      </main>
    </PageShell>
  );
}
