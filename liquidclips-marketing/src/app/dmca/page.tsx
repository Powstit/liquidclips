import type { Metadata } from "next";
import Link from "next/link";
import { supportEmail } from "@/lib/site";
import { PageShell } from "@/components/Chrome";

export const metadata: Metadata = {
  title: "DMCA copyright policy · Liquid Clips",
  description:
    "How to report copyright infringement on Liquid Clips, our takedown process, counter-notification rights, and repeat-infringer policy.",
};

// 2026-08-30 · DMCA takedown page. Required because Liquid Clips is a
// tool for clipping + reposting long-form video — copyright complaints
// will land. Without a public DMCA contact + published SLA, Whop can
// suspend our merchant status when complaints go unanswered, and we
// lose safe-harbour protection under 17 U.S.C. § 512(c). This is
// template-quality prose informed by common creator-platform DMCA
// pages (YouTube · Patreon · Substack). It stops being "template" the
// moment a lawyer reviews it — until then, keep the "pending review"
// note out of prod copy but flag it in commit messages / SOP docs.

export default function DMCAPage() {
  return (
    <PageShell>
      <main className="legal-page">
        <div className="container">
          <div className="eyebrow">Copyright</div>
          <h1 className="page-title">DMCA copyright policy</h1>
          <p className="page-lede">
            Liquid Clips respects the intellectual property rights of others and
            expects our users to do the same. This page tells you how to send a
            takedown notice under the Digital Millennium Copyright Act ("DMCA")
            and what happens next.
          </p>
          <p className="updated">Last updated: 30 August 2026</p>

          <article className="prose">
            <h2>1. Our designated agent</h2>
            <p>
              Send DMCA notices to our designated agent by email. We do not
              accept notices by physical mail or phone at this time.
            </p>
            <ul>
              <li>
                <strong>Email:</strong>{" "}
                <Link href={`mailto:${supportEmail}?subject=DMCA%20takedown%20notice`}>
                  {supportEmail}
                </Link>{" "}
                (subject: <em>DMCA takedown notice</em>)
              </li>
              <li>
                <strong>Response SLA:</strong> we acknowledge every properly-formed
                notice within 72 hours and act (remove, disable, or reply with
                cause) within 7 business days.
              </li>
            </ul>

            <h2>2. What to include in your takedown notice</h2>
            <p>
              To be actionable under 17 U.S.C. § 512(c)(3), your notice must include
              all of the following. Missing any of these means we cannot process
              your request.
            </p>
            <ol>
              <li>
                A physical or electronic signature of the owner (or a person
                authorised to act on the owner's behalf) of the exclusive right
                that is allegedly infringed.
              </li>
              <li>
                Identification of the copyrighted work claimed to have been
                infringed. If multiple works, a representative list is fine.
              </li>
              <li>
                Identification of the material that is claimed to be infringing,
                with enough detail for us to locate it — for a clip published via
                Liquid Clips, include the destination URL (TikTok, YouTube,
                Reels, X post link, etc.) and, if you have it, the Liquid Clips
                submission id or campaign slug.
              </li>
              <li>
                Contact information for the complaining party — email address at
                minimum, plus a physical address and phone number if available.
              </li>
              <li>
                A statement that you have a good-faith belief that use of the
                material in the manner complained of is not authorised by the
                copyright owner, its agent, or the law.
              </li>
              <li>
                A statement, under penalty of perjury, that the information in
                your notice is accurate and that you are the owner (or authorised
                to act on behalf of the owner) of an exclusive right that is
                allegedly infringed.
              </li>
            </ol>

            <h2>3. What happens after we receive a valid notice</h2>
            <ol>
              <li>
                We acknowledge receipt within 72 hours to the email you provided.
              </li>
              <li>
                We contact the user who published the material through Liquid
                Clips, forward your notice (with your name + email; not your
                physical address unless you require it), and give them a chance
                to respond or file a counter-notice.
              </li>
              <li>
                We remove or disable access to the Liquid Clips workflow that
                produced the infringing material — that means removing the
                submission record from the campaign queue, unpublishing scheduled
                posts routed through our tool, and revoking access to any
                Liquid-Clips-hosted preview.
              </li>
              <li>
                We do <em>not</em> control the destination platforms (TikTok,
                YouTube, Meta, X). To remove the infringing post itself, you must
                also file a takedown with the platform where it lives.
              </li>
              <li>
                We keep a private record of the notice + our response for our
                own compliance history.
              </li>
            </ol>

            <h2>4. Counter-notification (for users who received a takedown)</h2>
            <p>
              If you believe your material was removed by mistake or
              misidentification, you may send us a counter-notification. It must
              include, per 17 U.S.C. § 512(g)(3):
            </p>
            <ol>
              <li>Your physical or electronic signature.</li>
              <li>
                Identification of the material that was removed and the location
                at which it appeared before removal (Liquid Clips submission id
                or campaign slug).
              </li>
              <li>
                A statement under penalty of perjury that you have a good-faith
                belief the material was removed as a result of mistake or
                misidentification.
              </li>
              <li>
                Your name, address, and phone number, and a statement that you
                consent to the jurisdiction of the federal district court for
                the judicial district in which your address is located (or, if
                your address is outside the United States, any judicial district
                in which Liquid Clips may be found), and that you will accept
                service of process from the person who provided the original
                notification or an agent of that person.
              </li>
            </ol>
            <p>
              After we receive a valid counter-notification, we will forward it
              to the original complainant. If they don't file a court action
              seeking to restrain the activity within 10 business days, we may
              restore the removed material.
            </p>

            <h2>5. Repeat-infringer policy</h2>
            <p>
              We terminate Liquid Clips accounts and revoke access for users we
              determine to be repeat infringers, in accordance with our{" "}
              <Link href="/terms">Terms of Service</Link>. What counts as "repeat"
              depends on the pattern and severity — a single obvious bad-faith
              submission can trigger termination; multiple ambiguous complaints
              are reviewed together.
            </p>

            <h2>6. Misuse of the DMCA process</h2>
            <p>
              Filing a false takedown notice — or a false counter-notification —
              may result in liability under 17 U.S.C. § 512(f). We will preserve
              records and cooperate with lawful requests from parties injured
              by fraudulent notices.
            </p>

            <h2>7. Questions</h2>
            <p>
              Not sure whether your situation is a DMCA matter? Email{" "}
              <Link href={`mailto:${supportEmail}`}>{supportEmail}</Link> with the
              subject <em>DMCA question</em> and we'll route it to the right
              place.
            </p>

            <p className="footnote">
              This page is a policy statement, not legal advice. Consult a lawyer
              if you need one. Related pages:{" "}
              <Link href="/terms">Terms of Service</Link>,{" "}
              <Link href="/privacy">Privacy Policy</Link>,{" "}
              <Link href="/account-deletion">Account deletion</Link>.
            </p>
          </article>
        </div>
      </main>
    </PageShell>
  );
}
