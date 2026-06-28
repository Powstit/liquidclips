import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { accountUrl, supportEmail } from "@/lib/site";
import { SITE_URL } from "@/lib/env";

// Agencies persona landing. Reuses the canonical brand vocabulary
// (`section`, `tile`, `eyebrow`, `feature-grid`, `steps-grid`, `help-section`,
// `button-primary`, `button-secondary`) defined in globals.css so this page
// stays compatible with Agent B's brand-token canonicalisation sweep.
//
// Copy discipline: every promise here maps to a shipped surface in
// account-app/agency or junior-backend/app/agency_campaigns. No "AI matching",
// no "white-label dashboard", no "automated KYC" — those are roadmap, not
// landed.

export const metadata: Metadata = {
  title: "Launch a Whop content-reward campaign — Liquid Clips for agencies",
  description:
    "Stand up a Whop content-reward campaign in 15 minutes. You set the brief and payout, clippers worldwide submit, Whop handles the money. Built for agencies and brand teams.",
  alternates: { canonical: "/agencies" },
  keywords: [
    "Whop content rewards",
    "agency content rewards",
    "clipper campaign platform",
    "creator rewards Whop",
    "brand UGC clippers",
    "Liquid Clips agencies",
    "Whop affiliate campaigns",
    "content reward platform",
  ],
  openGraph: {
    title: "Launch a Whop content-reward campaign in 15 minutes — Liquid Clips",
    description:
      "You set the brief and payout. Clippers worldwide submit. Whop handles the money.",
    url: `${SITE_URL}/agencies`,
    type: "article",
  },
};

const valueProps = [
  {
    title: "Clippers worldwide submit on your terms.",
    body:
      "Post a campaign brief. Set the payout rate, the qualifying threshold, the approval rules. Clippers already inside the Whop ecosystem find your campaign and start submitting from day one.",
  },
  {
    title: "You set the brief and payout. We handle the approval flow.",
    body:
      "Each submission lands in your approval queue with platform metrics attached. Approve, reject, or request changes. Notes go back to the clipper, and your decision is logged for the next payout cycle.",
  },
  {
    title: "Whop handles the money. You handle the brand.",
    body:
      "Funding, KYC, payouts to bank or crypto wallet all run through Whop's existing rails. No new merchant of record, no separate compliance file. You stay focused on the brief.",
  },
];

const steps = [
  {
    num: "01",
    title: "Sign up as an agency.",
    body:
      "Create an account, pick the Agency tier, and link the Whop community that will host your campaign. One Whop link covers funding, payouts, and member management.",
  },
  {
    num: "02",
    title: "Create the campaign.",
    body:
      "Write the brief — what the clip should highlight, what platforms count, what counts as a qualifying view. Set CPM rate, dedupe rules, and a budget ceiling. The campaign goes live on a single shareable URL.",
  },
  {
    num: "03",
    title: "Get clippers.",
    body:
      "Share the campaign URL with your existing clipper network, or let it surface in the Liquid Clips desktop Earn tab where every active clipper sees open campaigns. Submissions start landing in your queue.",
  },
  {
    num: "04",
    title: "Approve and pay.",
    body:
      "Review each submission with view metrics attached. Approve the ones that meet the brief, reject the ones that don't. Whop settles payouts on your declared cycle — weekly, fortnightly, or per qualifying threshold.",
  },
] as const;

const faqs = [
  {
    q: "What is a Whop content-reward campaign?",
    a: "A creator- or agency-funded bounty pool that pays clippers per qualifying view on TikTok, Shorts, or Reels. The funder writes a brief (e.g. 'highlight our launch video'), sets a CPM rate, and Whop handles the money flow. Liquid Clips wires the desktop submission surface, the approval queue, and the per-clip metrics readout on top.",
  },
  {
    q: "How long does it take to launch?",
    a: "About 15 minutes if your Whop is already set up. Sign up on the Agency tier, paste the Whop community link, write the brief, fund the budget. The campaign is live the moment Whop confirms the funding hold.",
  },
  {
    q: "Who finds my campaign?",
    a: "Every clipper who has Liquid Clips installed sees open campaigns in the desktop Earn tab. Plus you can share the campaign URL directly with your existing clipper network, or surface it inside your Whop community feed.",
  },
  {
    q: "Do I have to approve every submission manually?",
    a: "Yes. The approval queue is intentional — auto-approval ships with too much rev-share risk. Each submission shows view metrics, dedupe checks, and the original source clip so you can decide in seconds, not minutes. Bulk approve is on the roadmap for the v0.9 series.",
  },
  {
    q: "Can clippers submit clips made outside Liquid Clips?",
    a: "Today the desktop app is the submission surface. We're scoping a web submission flow for campaigns that want to accept clips made in CapCut, Descript, or other editors. Until that lands, clippers cut in Liquid Clips and submit one tap.",
  },
  {
    q: "What does the Agency tier cost?",
    a: "$500/mo. Includes 25 connected social accounts, every clipper feature, and the campaign creation flow. See the full comparison on the pricing page.",
  },
];

export default function AgenciesPage() {
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
    name: "Launch a Whop content-reward campaign with Liquid Clips",
    description:
      "Sign up as an agency, create a campaign brief, share the campaign with clippers, approve submissions, pay through Whop.",
    image: `${SITE_URL}/brand/og-default.png`,
    totalTime: "PT15M",
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
              AGENCY MODE · CAMPAIGN OPS
            </div>
            <h1 className="page-title" style={{ margin: "20px auto 0", textAlign: "center" }}>
              Launch a Whop content-reward campaign in <em>15 minutes</em>.
            </h1>
            <p className="hero-copy" style={{ margin: "20px auto 0", textAlign: "center", maxWidth: 720 }}>
              You set the brief and the payout. Clippers worldwide submit. Whop handles the money flow,
              the approval queue lives in your account, and every submission arrives with platform
              metrics attached.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <Link href="/sign-up" className="button-primary">
                Sign up as an agency
              </Link>
              <Link href="/pricing" className="button-secondary">
                See agency pricing
              </Link>
            </div>
            <div
              style={{
                marginTop: 48,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <Image
                src="/brand/kade/kade-campaign-mode.webp"
                alt="Kade reviewing a campaign brief in the Liquid Clips workbench"
                width={480}
                height={480}
                style={{
                  width: "min(420px, 80vw)",
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
            <div className="eyebrow">WHY AGENCIES PICK LIQUID CLIPS</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Three things change when your campaign runs on these rails.
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
            <div className="eyebrow">CAMPAIGN FLOW</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Four steps from <em>sign-up</em> to <em>first approved clip</em>.
            </h2>
            <p className="section-copy">
              No agency onboarding call, no contract negotiation. The product is the campaign loop —
              everything else is paperwork we refuse to add.
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

        {/* Pricing call-out */}
        <section className="section section-dark">
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>
              AGENCY TIER
            </div>
            <h2 className="section-title" style={{ marginTop: 22, textAlign: "center" }}>
              $500/mo. Everything in the workbench, plus the campaign console.
            </h2>
            <p className="section-copy" style={{ marginTop: 18, textAlign: "center", maxWidth: 640, marginLeft: "auto", marginRight: "auto" }}>
              25 connected social accounts, unlimited campaigns, the approval queue, the metrics
              readout, and every clipper feature in the Liquid Clips desktop app for your team.
              Compare against Solo, Growth, and Free on the pricing page.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center", marginTop: 28 }}>
              <Link href="/pricing" className="button-primary">
                See full pricing
              </Link>
              <Link href={`${accountUrl}/dashboard`} className="button-secondary">
                Open your dashboard
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section" id="faq">
          <div className="container">
            <div className="eyebrow">BEFORE YOU SIGN UP</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Questions agencies ask first.
            </h2>
            <div className="help-article" style={{ marginTop: 36 }}>
              {faqs.map((f) => (
                <section className="help-section" key={f.q}>
                  <h2 style={{ fontSize: 22 }}>{f.q}</h2>
                  <p>{f.a}</p>
                </section>
              ))}
              <div className="help-callout">
                <h2>Need a walkthrough first?</h2>
                <p>
                  Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with the campaign you
                  want to run. We will reply with a 60-second loom of the exact flow, no booking
                  required.
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
              Ready to launch your first campaign?
            </h2>
            <p className="section-copy" style={{ marginTop: 18, textAlign: "center" }}>
              15 minutes from sign-up to a live campaign URL you can hand to clippers.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center", marginTop: 28 }}>
              <Link href="/sign-up" className="button-primary">
                Sign up as an agency
              </Link>
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
