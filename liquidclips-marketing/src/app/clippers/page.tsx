import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { DownloadCTA, DownloadMeta } from "@/components/DownloadCTA";
import { getLatestRelease } from "@/lib/latest-release";
import { supportEmail } from "@/lib/site";
import { SITE_URL } from "@/lib/env";

// Clippers persona landing. Mirrors /agencies in structure but inverts the
// flow — clipper-side onboarding (download → connect Whop → cut → submit).
// Reuses the canonical globals.css token set so Agent B's sweep merges
// cleanly with no new tokens introduced here.
//
// Earnings example below is conservative — based on the carrot doc default
// of $10 CPM minus the 5% platform fee. Concrete campaign rates vary per
// brief, so we frame this as an example, not a guarantee.

export const metadata: Metadata = {
  title: "Turn streams into clips. Get paid by brands — Liquid Clips for clippers",
  description:
    "Browse live Whop content-reward campaigns inside the Liquid Clips desktop app. Generate captioned clips, publish in one tap, submit to brands, get paid in USDC when approved.",
  alternates: { canonical: "/clippers" },
  keywords: [
    "make money clipping",
    "Whop clipper rewards",
    "clip rewards platform",
    "creator clipping tool",
    "TikTok clip rewards",
    "Shorts content rewards",
    "USDC clipping payouts",
    "Liquid Clips clippers",
  ],
  openGraph: {
    title: "Turn streams into clips. Get paid by brands — Liquid Clips",
    description:
      "Browse live Whop campaigns in-app. Cut, caption, submit. Paid in USDC when approved.",
    url: `${SITE_URL}/clippers`,
    type: "article",
  },
};

const valueProps = [
  {
    title: "Browse live Whop campaigns inside the app.",
    body:
      "Open the Earn tab in the Liquid Clips desktop app. Every active content-reward campaign is listed — the brief, the CPM rate, the qualifying threshold, the funding pool. Pick one and start cutting.",
  },
  {
    title: "Generate and edit clips locally. Publish in one tap.",
    body:
      "Drop a stream URL, podcast episode, or local file. The app picks the strong moments, burns hard captions, reframes vertical. Tighten the hook on the timeline, hit publish to TikTok, Shorts, or Reels.",
  },
  {
    title: "Submit to brands. Get paid in USDC when approved.",
    body:
      "Each export has a Submit button. Pick the campaign, send the clip. The brand or agency approves in their queue, view counts pull daily from the platform APIs, and Whop settles the payout on the declared cycle.",
  },
];

const steps = [
  {
    num: "01",
    title: "Download Liquid Clips for Mac.",
    body:
      "Get the signed, notarised .dmg from the download page. Drag the app into Applications. Open it once. You're at the cockpit.",
  },
  {
    num: "02",
    title: "Connect your Whop account.",
    body:
      "Sign in with Whop on first launch. The desktop activates against your Whop subscription and unlocks every content-reward campaign you're eligible for. No separate signup, no second password.",
  },
  {
    num: "03",
    title: "Generate a clip.",
    body:
      "Paste a YouTube link, a Twitch VOD, a TikTok live, or drag in a local file. The app downloads the source, picks the strong moments, captions and reframes them. First clip ready in 60-90 seconds on a recent Mac.",
  },
  {
    num: "04",
    title: "Submit and earn.",
    body:
      "Open the Earn tab. Pick the live campaign. Hit Submit on the export you want to send. View counts populate daily, and Whop settles the payout on whatever cycle the campaign declared.",
  },
] as const;

const earningsRows = [
  { label: "Views on TikTok", value: "5,000" },
  { label: "Campaign CPM", value: "$10.00" },
  { label: "Gross reward", value: "$50.00" },
  { label: "Platform fee (5%)", value: "−$2.50" },
  { label: "Net payout (USDC via Whop)", value: "$47.50" },
];

const faqs = [
  {
    q: "Do I need a Whop subscription to use Liquid Clips?",
    a: "You can use the desktop app to cut clips without Whop — Free, Pro, and Growth tiers all work on direct sign-in. But Whop is the layer that connects you to content-reward campaigns, so to earn from brand briefs you need a Whop account linked to the desktop app.",
  },
  {
    q: "Which platforms do payouts go to?",
    a: "Whop. KYC happens once on whop.com, then payouts go to your linked bank account or a crypto wallet (USDC is the default for instant-settle campaigns). One Whop KYC covers every campaign you join.",
  },
  {
    q: "How long until I get paid after submitting?",
    a: "Two stages. First the brand approves the submission — usually same day, sometimes inside a few hours on active campaigns. Then the payout cycle runs on whatever schedule the campaign declared (weekly or fortnightly is most common). View counts pull daily, so earnings update in the Earn tab between cycles.",
  },
  {
    q: "Can I clip videos from any source?",
    a: "Anything with audio. YouTube long-form, Twitch VODs, TikTok lives, podcast episodes, Zoom recordings, conference talks, your own .mp4 files. If yt-dlp can pull it or your Mac can read it, Liquid Clips can clip it.",
  },
  {
    q: "What does it cost to start?",
    a: "Free. The desktop download is free, the Whop account is free to create, and content-reward campaigns are paid by the brand — clippers never pay to submit. If you want unlimited exports per month or hosted AI scoring, the Pro and Growth tiers are on the pricing page.",
  },
  {
    q: "Mac only?",
    a: "Yes, Apple Silicon on macOS 13+ is the only build that ships today. Windows and Linux do not ship until each platform feels native.",
  },
];

export default async function ClippersPage() {
  const latest = await getLatestRelease();
  const artifacts = latest
    ? {
        macArm: latest.macArm ?? undefined,
        macIntel: latest.macIntel ?? undefined,
        macUniversal: latest.macUniversal ?? undefined,
      }
    : undefined;

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to earn from Whop content-reward campaigns with Liquid Clips",
    description:
      "Download Liquid Clips, connect your Whop account, generate a clip from any long-form source, submit to a live campaign, get paid in USDC.",
    image: `${SITE_URL}/brand/og-default.png`,
    totalTime: "PT5M",
    step: steps.map((s) => ({
      "@type": "HowToStep",
      position: Number(s.num),
      name: s.title.replace(/\.$/, ""),
      text: s.body,
    })),
  };

  return (
    <PageShell>
      <main className="start-page">
        {/* Hero */}
        <section className="hero" style={{ minHeight: 0, padding: "72px 0 32px" }}>
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>
              CLIPPER MODE · EARN TAB
            </div>
            <h1 className="page-title" style={{ margin: "20px auto 0", textAlign: "center" }}>
              Turn streams into clips. <em>Get paid</em> by brands.
            </h1>
            <p className="hero-copy" style={{ margin: "20px auto 0", textAlign: "center", maxWidth: 720 }}>
              Liquid Clips is the desktop workbench every Whop clipper uses to cut, caption, and
              submit. Browse live brand campaigns in-app, ship clips to TikTok, Shorts, or Reels,
              and settle payouts in USDC through Whop.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <DownloadCTA variant="primary" artifacts={artifacts} version={latest?.version} />
              <Link href="#how-it-works" className="button-secondary">
                See the 4 steps
              </Link>
            </div>
            <div style={{ marginTop: 14, textAlign: "center" }}>
              <DownloadMeta version={latest?.version} />
            </div>
            <div
              style={{
                marginTop: 48,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <Image
                src="/brand/kade/kade-shooter.webp"
                alt="Kade firing clips from the Liquid Clips workbench"
                width={520}
                height={520}
                style={{
                  width: "min(440px, 80vw)",
                  height: "auto",
                  filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.4))",
                }}
                priority
              />
            </div>
          </div>
        </section>

        {/* Value props · 3 pillars */}
        <section className="section section-warm">
          <div className="container">
            <div className="eyebrow">WHY CLIPPERS PICK LIQUID CLIPS</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Three reasons the workbench wins your stack.
            </h2>
            <div className="feature-grid" style={{ marginTop: 42, gridTemplateColumns: "repeat(3, 1fr)" }}>
              {valueProps.map((v) => (
                <article className="tile" key={v.title}>
                  <h3>{v.title}</h3>
                  <p>{v.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* How it works · 4 steps */}
        <section className="section" id="how-it-works">
          <div className="container">
            <div className="eyebrow">CLIPPER FLOW</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Four steps from <em>download</em> to <em>first paid clip</em>.
            </h2>
            <p className="section-copy">
              No course, no Discord onboarding. Drop a video, pick a campaign, hit submit.
            </p>
            <div className="steps-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              {steps.map((step) => (
                <article className="tile" key={step.num}>
                  <div className="num">{step.num}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Earnings example */}
        <section className="section section-warm">
          <div className="container">
            <div className="eyebrow">EARNINGS EXAMPLE</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              5,000 views on a $10 CPM campaign.
            </h2>
            <p className="section-copy">
              One worked example using the default campaign settings. Concrete CPM, qualifying
              threshold, and dedupe rules vary per brand brief — every campaign declares its own
              terms before you submit.
            </p>
            <div
              style={{
                marginTop: 42,
                maxWidth: 560,
                marginLeft: "auto",
                marginRight: "auto",
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: "20px 28px",
                background: "var(--paper)",
              }}
            >
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {earningsRows.map((row, i) => (
                  <li
                    key={row.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      padding: "14px 0",
                      borderBottom:
                        i === earningsRows.length - 1
                          ? "none"
                          : "1px solid var(--line)",
                      fontWeight: i === earningsRows.length - 1 ? 700 : 400,
                    }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: i === earningsRows.length - 1 ? "var(--fuchsia)" : "var(--ink)",
                      }}
                    >
                      {row.value}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="section-copy muted" style={{ marginTop: 28, textAlign: "center", fontSize: 14 }}>
              Want to run campaigns on the other side?{" "}
              <Link href="/agencies" className="inline-link">
                Flip to the agency view
              </Link>
              .
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="section" id="faq">
          <div className="container">
            <div className="eyebrow">BEFORE YOU INSTALL</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Questions clippers ask first.
            </h2>
            <div className="help-article" style={{ marginTop: 36 }}>
              {faqs.map((f) => (
                <section className="help-section" key={f.q}>
                  <h2 style={{ fontSize: 22 }}>{f.q}</h2>
                  <p>{f.a}</p>
                </section>
              ))}
              <div className="help-callout">
                <h2>Stuck during install?</h2>
                <p>
                  Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with your macOS version,
                  the step you hit, and what the app showed. Real human reply within one business
                  day.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="section section-dark">
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>
              INSERT COIN
            </div>
            <h2 className="section-title" style={{ marginTop: 22, textAlign: "center" }}>
              Ready to clip and earn?
            </h2>
            <p className="section-copy" style={{ marginTop: 18, textAlign: "center" }}>
              Free to download. Free to start. Upgrade only when 100 starter clips runs out.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center", marginTop: 28 }}>
              <DownloadCTA variant="primary" artifacts={artifacts} version={latest?.version} />
            </div>
            <div style={{ marginTop: 14 }}>
              <DownloadMeta version={latest?.version} />
            </div>
          </div>
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(howToLd) }}
        />
      </main>
    </PageShell>
  );
}
