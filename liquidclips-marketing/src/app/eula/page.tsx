import type { Metadata } from "next";
import { PageShell } from "@/components/Chrome";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "End User License Agreement · Liquid Clips",
  description:
    "End User License Agreement for the Liquid Clips desktop application.",
};

export default function EulaPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <h1 className="page-title">End User License Agreement</h1>
          <p className="page-lede">
            This EULA governs your use of the Liquid Clips desktop application (the &quot;Software&quot;).
            By installing or using the Software you agree to these terms.
          </p>
          <p className="updated">Last updated: 6 June 2026</p>

          <div className="prose">
            <h2>1. Licence grant</h2>
            <p>
              Liquid Clips grants you a personal, non-exclusive, non-transferable, revocable
              licence to install and run the Software on devices you own or control, subject to
              your subscription tier and the limits listed at <a href="/#pricing">liquidclips.app/#pricing</a>.
            </p>

            <h2>2. What you may not do</h2>
            <ul>
              <li>Reverse engineer, decompile, or disassemble the Software, except to the extent applicable law expressly permits.</li>
              <li>Remove or alter trademarks, copyright notices, or licence keys.</li>
              <li>Sublicense, rent, lease, or distribute the Software to third parties.</li>
              <li>Use the Software to violate any law or any third party&apos;s rights.</li>
            </ul>

            <h2>3. Third-party services</h2>
            <p>
              The Software integrates with third-party services (Clerk for sign-in, Stripe and Whop
              for billing, Ayrshare for social publishing, OpenAI / hosted AI for clip generation,
              PostHog for analytics, Railway and Vercel for hosting). Your use of those services
              is subject to their own terms. Liquid Clips is not responsible for third-party
              outages, suspensions, or policy changes.
            </p>

            <h2>4. Updates</h2>
            <p>
              The Software checks for updates and may install signed releases automatically. You
              may turn auto-updates off in Settings, but doing so may prevent you from receiving
              security and compliance fixes.
            </p>

            <h2>5. Data &amp; privacy</h2>
            <p>
              Local source files, transcripts, and exports stay on your device for local-tier
              workflows. See the <a href="/privacy">Privacy Policy</a> for what data leaves your
              device, what is processed by sub-processors, and how to request deletion.
            </p>

            <h2>6. Subscription, billing, refunds</h2>
            <p>
              Subscriptions are billed via Stripe or Whop and renew automatically until cancelled.
              See the <a href="/refunds">refund policy</a> for the conditions under which we will
              refund payments. EU and UK consumers retain statutory withdrawal rights where they
              apply.
            </p>

            <h2>7. Termination</h2>
            <p>
              We may suspend or terminate this licence if you breach this EULA or use the
              Software to harm others. On termination you must stop using the Software and delete
              all installed copies. You may terminate your subscription and licence at any time
              from your account dashboard or by writing to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>

            <h2>8. Disclaimer of warranties</h2>
            <p>
              The Software is provided &quot;as is&quot; without warranty of any kind, express or
              implied, including but not limited to warranties of merchantability, fitness for a
              particular purpose, and non-infringement, to the maximum extent permitted by law.
              Statutory rights in your jurisdiction are not affected.
            </p>

            <h2>9. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, Liquid Clips will not be liable for
              indirect, incidental, special, consequential, or punitive damages, or any loss of
              profits, revenues, data, or goodwill arising out of or related to your use of the
              Software. Our total cumulative liability for any claim will not exceed the amount
              you paid us in the twelve months before the claim arose.
            </p>

            <h2>10. Governing law</h2>
            <p>
              This EULA is governed by the laws of England &amp; Wales, without regard to
              conflict-of-laws principles. Disputes will be resolved in the courts of England &amp;
              Wales, save where mandatory consumer law gives you the right to a local forum.
            </p>

            <h2>11. Contact</h2>
            <p>
              Questions about this EULA: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
            </p>

            <div className="note-box">
              <strong>Note:</strong> This document is a plain-English summary written for product
              use. It is not legal advice. Review with counsel before relying on it for compliance
              in any jurisdiction.
            </div>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
