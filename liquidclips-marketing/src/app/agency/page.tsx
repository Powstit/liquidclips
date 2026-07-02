import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { accountUrl, downloadUrl, supportEmail } from "@/lib/site";
import { SITE_URL } from "@/lib/env";

// /agency — cold-email → download funnel · Sprint continues the A–G stack.
//
// Every claim on this page maps 1:1 to shipped code in the local commit
// stack (b87a476 → 50e33ec). Nothing invented. Nothing on the roadmap.
// Distinct from /agencies (plural · legacy) — that page pre-dates the
// 3-tier ladder and stays live until the ladder ships publicly.
//
// Funnel shape (single scroll · zero side paths):
//   1. Hero            → Kade + one-line promise + primary CTA
//   2. Proof           → 3 real numbers from the Jae5 campaign
//   3. Three promises  → bypass gate · 50% MRR · campaign engine
//   4. Three tiers     → $50 / $299 / $500 · direct Whop checkout
//   5. Demo space      → placeholder container awaiting the Loom
//   6. FAQ             → 5 questions · truthful answers
//   7. Final CTA       → download + email support
//
// Env-driven Whop plan IDs (same convention as /pricing):
//   NEXT_PUBLIC_WHOP_PLAN_ID_AGENCY_SOLO       ($50/mo)
//   NEXT_PUBLIC_WHOP_PLAN_ID_AGENCY            ($299/mo)
//   NEXT_PUBLIC_WHOP_PLAN_ID_AGENCY_WHITELABEL ($500/mo)
// Missing vars → mailto fallback so the CTA is never dead.

export const metadata: Metadata = {
  title: "Run your own clipping agency · Liquid Clips",
  description:
    "Bypass the affiliate qualification gate · earn 50% MRR on every clipper you invite · publish Whop content-reward campaigns from a desktop cockpit. $50/mo Solo Agency · $299/mo Agency · $500/mo White-Label.",
  alternates: { canonical: "/agency" },
  keywords: [
    "clipping agency",
    "Whop content rewards agency",
    "run a clipping campaign",
    "50% MRR agency",
    "agency clipping software",
    "Liquid Clips agency",
  ],
  openGraph: {
    title: "Run your own clipping agency · Liquid Clips",
    description:
      "Skip the qualification gate. Earn 50% MRR on every clipper you invite. Publish content-reward campaigns from the desktop cockpit.",
    url: `${SITE_URL}/agency`,
    type: "website",
  },
};

const WHOP_PLAN_ID_AGENCY_SOLO = process.env.NEXT_PUBLIC_WHOP_PLAN_ID_AGENCY_SOLO ?? "";
const WHOP_PLAN_ID_AGENCY = process.env.NEXT_PUBLIC_WHOP_PLAN_ID_AGENCY ?? "";
const WHOP_PLAN_ID_AGENCY_WHITELABEL = process.env.NEXT_PUBLIC_WHOP_PLAN_ID_AGENCY_WHITELABEL ?? "";

function checkoutHref(planId: string, tierLabel: string): string {
  if (planId && planId.startsWith("plan_")) {
    return `https://whop.com/checkout/${planId}`;
  }
  const subject = encodeURIComponent(`Interest in ${tierLabel}`);
  return `mailto:${supportEmail}?subject=${subject}`;
}

type Tier = {
  id: string;
  name: string;
  priceUsd: number;
  hook: string;
  highlights: string[];
  ctaHref: string;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "solo",
    name: "Solo Agency",
    priceUsd: 50,
    hook: "Prove the model on one brand.",
    highlights: [
      "1 active campaign",
      "5 sub-clippers in your roster",
      "50% MRR on every clipper you invite · from day one",
      "10 connected social accounts",
    ],
    ctaHref: checkoutHref(WHOP_PLAN_ID_AGENCY_SOLO, "Solo Agency ($50/mo)"),
  },
  {
    id: "agency",
    name: "Agency",
    priceUsd: 299,
    hook: "Run your book of brands.",
    highlights: [
      "5 active campaigns",
      "25 sub-clippers in your roster",
      "50% MRR · day one · every tier",
      "25 connected social accounts",
      "Payout-split editor · priority queue",
    ],
    ctaHref: checkoutHref(WHOP_PLAN_ID_AGENCY, "Agency ($299/mo)"),
    featured: true,
  },
  {
    id: "white-label",
    name: "White-Label",
    priceUsd: 500,
    hook: "Resell it as your own brand.",
    highlights: [
      "Unlimited campaigns + clippers",
      "Watermark removal on all exports",
      "Sub-accounts · drip scheduling",
      "50 connected social accounts",
      "Priority support",
    ],
    ctaHref: checkoutHref(WHOP_PLAN_ID_AGENCY_WHITELABEL, "White-Label ($500/mo)"),
  },
];

const PROMISES = [
  {
    eyebrow: "one",
    kade: "/brand/kade/kade-shooter.webp",
    title: "Skip the gate.",
    body:
      "Normal clippers grind 2 paid referrals or 11K views before 50% recurring unlocks. Every agency tier bypasses that qualification carrot at grant time · you earn 50% MRR from day one.",
  },
  {
    eyebrow: "two",
    kade: "/brand/kade/kade-success.webp",
    title: "Earn on every clipper you invite.",
    body:
      "Send an invite. They accept. Their Liquid Clips subscription MRR credits you at 50% · recurring · for as long as they stay subscribed. Payouts route through Whop or Stripe Connect. Attribution is first-touch and locked at accept.",
  },
  {
    eyebrow: "three",
    kade: "/brand/kade/kade-campaign-mode.webp",
    title: "Own the whole campaign.",
    body:
      "Draft a brief. Connect a Whop content-reward URL. Publish when funding lands. Every submission arrives with view metrics + dedupe checks. Approve, reject, or request changes. Your roster splits the pot by whatever percentages you set.",
  },
];

const PROOF = [
  { number: "1,458,005", label: "views · one Jae5 campaign · $1.24 CPM under cap" },
  { number: "$1,808.30", label: "paid out to 42 verified clippers" },
  { number: "50%", label: "MRR on every clipper you bring in · day one" },
];

const FAQ = [
  {
    q: "Whose MRR is the 50% based on?",
    a: "Every clipper you invite pays Liquid Clips a subscription ($29.99 Solo · $99.99 Pro). You earn 50% of that recurring subscription revenue for as long as they stay subscribed. Not the brand's spend, not the clipper's clip payouts — the software subscription MRR.",
  },
  {
    q: "How is the 50% actually paid?",
    a: "At the moment your agency tier activates, the backend applies a 50% custom-commission override to your Whop affiliate record. Every invited clipper who subscribes routes commission through Whop's standard weekly payout cycle. Non-Whop affiliates get paid via Stripe Connect Express.",
  },
  {
    q: "What if I invite someone who already had a referrer?",
    a: "First-touch stays. We never overwrite an existing affiliate. If a clipper you invite has NO prior referrer, they're stamped to you at accept. That way we can't accidentally poach commission from another affiliate — and no one can poach yours.",
  },
  {
    q: "Can I really cancel any time?",
    a: "Yes. Whop owns the subscription and cancellation flow · one click in your Whop dashboard. Your existing campaigns close cleanly, existing clippers keep their attribution, no clawback on commission already paid.",
  },
  {
    q: "Is there a trial?",
    a: "No trial period · no discount promo · card is required at checkout via Whop. Solo Agency at $50/mo is the permanent entry price · if you outgrow one campaign, upgrade to Agency ($299) or White-Label ($500). Nothing changes about how you use the product between the three tiers except the caps and (on White-Label) watermark removal.",
  },
];

export default function AgencyLandingPage() {
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Liquid Clips for Agencies",
    description:
      "Desktop cockpit for running clipping agencies. Bypass affiliate qualification. Earn 50% MRR on invited clippers. Publish Whop content-reward campaigns.",
    brand: { "@type": "Brand", name: "Liquid Clips" },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "50",
      highPrice: "500",
      offerCount: TIERS.length,
      offers: TIERS.map((t) => ({
        "@type": "Offer",
        name: t.name,
        price: t.priceUsd.toFixed(2),
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: t.ctaHref,
      })),
    },
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <PageShell>
      <main className="start-page">
        {/* ─── 1 · HERO ────────────────────────────────────────────── */}
        <section className="hero" style={{ minHeight: 0, padding: "84px 0 40px" }}>
          <div className="container" style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 48, alignItems: "center" }}>
            <div>
              <div className="eyebrow">AGENCY MODE · $50 → $500 · WHOP-NATIVE</div>
              <h1 className="page-title" style={{ margin: "22px 0 0" }}>
                Run a clipping agency. <em>Earn 50% MRR on every clipper you bring in.</em>
              </h1>
              <p className="hero-copy" style={{ margin: "22px 0 0", maxWidth: 560 }}>
                Skip the qualification gate. Publish Whop content-reward campaigns from the
                desktop cockpit. Route commissions through Whop or Stripe. From <strong>$50/mo</strong>.
              </p>
              <div className="hero-actions" style={{ marginTop: 32 }}>
                <Link href="#tiers" className="button-primary">
                  Pick a tier → $50/mo
                </Link>
                <Link href="#demo" className="button-secondary">
                  Watch demo
                </Link>
              </div>
              <p style={{ marginTop: 22, fontSize: 13, color: "var(--text-tertiary)" }}>
                Cancel any time from Whop · card required at checkout · macOS Apple Silicon or Intel.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Image
                src="/brand/kade/kade-campaign-mode.webp"
                alt="Kade the Liquid Clips operator in campaign-mode pose"
                width={520}
                height={520}
                priority
                style={{
                  width: "min(460px, 90%)",
                  height: "auto",
                  filter: "drop-shadow(0 24px 60px rgba(255,26,140,0.35))",
                }}
              />
            </div>
          </div>
        </section>

        {/* ─── 2 · PROOF ROW ──────────────────────────────────────── */}
        <section className="section" style={{ paddingTop: 24 }}>
          <div className="container">
            <div className="eyebrow">MEASURED · JAE5 CAMPAIGN · APR–JUN 2026</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              The channel already works. <em>You just get to own it.</em>
            </h2>
            <div className="agency-proof-row">
              {PROOF.map((p) => (
                <div className="agency-proof-tile" key={p.label}>
                  <div className="agency-proof-num">{p.number}</div>
                  <div className="agency-proof-lbl">{p.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 3 · THREE PROMISES ─────────────────────────────────── */}
        <section className="section section-warm" id="how">
          <div className="container">
            <div className="eyebrow">WHAT YOU GET</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Three things flip the moment you subscribe.
            </h2>
            <div className="agency-promise-grid">
              {PROMISES.map((p) => (
                <article className="tile agency-promise-card" key={p.title}>
                  <div className="agency-promise-eb">{p.eyebrow}</div>
                  <Image
                    src={p.kade}
                    alt=""
                    width={200}
                    height={200}
                    style={{ width: 160, height: "auto", marginBottom: 12 }}
                  />
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 4 · THREE TIERS ────────────────────────────────────── */}
        <section className="section" id="tiers">
          <div className="container">
            <div className="eyebrow">PRICING · THREE WAYS TO RUN AN AGENCY</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Pick the tier that fits how many brands you serve.
            </h2>
            <p className="section-copy" style={{ maxWidth: 620 }}>
              Every tier bypasses the qualification gate. Every tier earns you 50% MRR on invited
              clippers from day one. What changes is capacity — campaigns, roster size, whether
              you can white-label the exports.
            </p>
            <div className="pricing-grid agency-tier-grid" style={{ marginTop: 36 }}>
              {TIERS.map((t) => (
                <article
                  key={t.id}
                  className={`price-card ${t.featured ? "featured" : ""}`}
                >
                  <div className="plan-kicker">{t.name.toUpperCase()}</div>
                  <div className="price">
                    ${t.priceUsd.toFixed(2)}
                    <span> /mo</span>
                  </div>
                  <p style={{ marginTop: 12 }}>{t.hook}</p>
                  <ul className="checks">
                    {t.highlights.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                  <div style={{ marginTop: "auto", paddingTop: 24 }}>
                    <a
                      href={t.ctaHref}
                      className={t.featured ? "button-primary" : "button-secondary"}
                      style={{ width: "100%", justifyContent: "center", display: "inline-flex" }}
                    >
                      Start {t.name} · ${t.priceUsd}/mo →
                    </a>
                  </div>
                </article>
              ))}
            </div>
            <p style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
              Billed monthly in USD by Whop · cancel any time · card at checkout.
            </p>
          </div>
        </section>

        {/* ─── 5 · DEMO PLACEHOLDER ───────────────────────────────── */}
        <section className="section section-warm" id="demo">
          <div className="container">
            <div className="eyebrow">DEMO · 90 SECONDS</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Watch the whole flow · campaign → invite → payout.
            </h2>
            <div className="agency-demo-frame">
              <div className="agency-demo-inner">
                <Image
                  src="/brand/kade/kade-reading-brief.webp"
                  alt="Kade reading the campaign brief"
                  width={220}
                  height={220}
                  style={{ width: 180, height: "auto" }}
                />
                <div className="agency-demo-copy">
                  <div className="agency-demo-eb">Loom coming</div>
                  <h3>Demo drops here.</h3>
                  <p>
                    Draft campaign · connect Whop reward · invite clipper · watch attribution
                    lock at accept. Recorded and dropped in before public launch.
                  </p>
                </div>
              </div>
            </div>
            <p style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "var(--text-tertiary)" }}>
              While the Loom bakes: email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> for a live walkthrough.
            </p>
          </div>
        </section>

        {/* ─── 6 · FAQ ────────────────────────────────────────────── */}
        <section className="section" id="faq">
          <div className="container">
            <div className="eyebrow">BEFORE YOU BUY</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Five honest questions.
            </h2>
            <div className="help-article" style={{ marginTop: 36 }}>
              {FAQ.map((f) => (
                <section className="help-section" key={f.q}>
                  <h2 style={{ fontSize: 22 }}>{f.q}</h2>
                  <p>{f.a}</p>
                </section>
              ))}
              <div className="help-callout">
                <h2>Still unsure?</h2>
                <p>
                  Reply to your cold email or write to <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with what
                  you're trying to run. We'll tell you which tier fits — including whether you'd cost less by
                  staying on the clipper-side and skipping the agency layer altogether. No hard sell.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── 7 · FINAL CTA ──────────────────────────────────────── */}
        <section className="section section-dark">
          <div className="container" style={{ display: "grid", gridTemplateColumns: "0.9fr 1fr", gap: 48, alignItems: "center" }}>
            <Image
              src="/brand/kade/kade-success.webp"
              alt="Kade celebrating a successful campaign publish"
              width={400}
              height={400}
              style={{
                width: "min(360px, 90%)",
                height: "auto",
                filter: "drop-shadow(0 24px 60px rgba(255,26,140,0.5))",
                justifySelf: "center",
              }}
            />
            <div>
              <div className="eyebrow">INSERT COIN</div>
              <h2 className="section-title" style={{ marginTop: 22 }}>
                Your first campaign in <em>15 minutes</em>.
              </h2>
              <p className="section-copy" style={{ marginTop: 18 }}>
                Pick a tier, checkout with Whop, download Liquid Clips, invite your first clipper.
                Attribution locks the moment they accept. Your first commission credits on their
                next subscription cycle.
              </p>
              <div className="hero-actions" style={{ marginTop: 28 }}>
                <a
                  href={TIERS[0].ctaHref}
                  className="button-primary"
                >
                  Start Solo Agency · $50/mo →
                </a>
                <a href={downloadUrl} className="button-secondary">
                  Just download the app
                </a>
              </div>
              <p style={{ marginTop: 20, fontSize: 13, color: "var(--text-tertiary)" }}>
                Card required · Whop hosts checkout + payouts · macOS Apple Silicon or Intel.
              </p>
            </div>
          </div>
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />

        {/* Scoped styles · no new globals, all inline to this route */}
        <style>{`
          .agency-proof-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
            margin-top: 36px;
          }
          .agency-proof-tile {
            padding: 24px 22px;
            border: 1px solid var(--line);
            border-radius: 14px;
            background: var(--paper);
          }
          .agency-proof-num {
            font-family: var(--font-display), Georgia, serif;
            font-size: clamp(28px, 3.4vw, 40px);
            font-weight: 600;
            letter-spacing: -0.02em;
            color: var(--fuchsia);
          }
          .agency-proof-lbl {
            margin-top: 6px;
            font-size: 12.5px;
            line-height: 1.55;
            color: var(--text-secondary);
          }

          .agency-promise-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-top: 42px;
          }
          .agency-promise-card { display: flex; flex-direction: column; align-items: flex-start; padding: 24px; }
          .agency-promise-eb {
            font-family: var(--font-mono), monospace;
            font-size: 11px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--fuchsia);
            margin-bottom: 6px;
          }

          .agency-tier-grid { grid-template-columns: repeat(3, 1fr); }

          .agency-demo-frame {
            margin-top: 36px;
            padding: 4px;
            border-radius: 20px;
            background: linear-gradient(140deg, rgba(255,26,140,0.55), rgba(255,26,140,0.1) 55%, rgba(255,26,140,0));
          }
          .agency-demo-inner {
            aspect-ratio: 16 / 9;
            border-radius: 18px;
            background: var(--paper);
            border: 1px solid var(--line);
            display: grid;
            grid-template-columns: 220px 1fr;
            align-items: center;
            gap: 32px;
            padding: 28px 36px;
            overflow: hidden;
          }
          .agency-demo-copy h3 {
            font-family: var(--font-display), Georgia, serif;
            font-size: clamp(22px, 2.6vw, 30px);
            font-weight: 600;
            letter-spacing: -0.02em;
            margin: 6px 0 10px;
            color: var(--ink);
          }
          .agency-demo-copy p { color: var(--text-secondary); max-width: 480px; }
          .agency-demo-eb {
            font-family: var(--font-mono), monospace;
            font-size: 11px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--fuchsia);
          }

          /* Responsive collapse */
          @media (max-width: 960px) {
            .hero .container { grid-template-columns: 1fr !important; }
            .agency-proof-row,
            .agency-promise-grid,
            .agency-tier-grid { grid-template-columns: 1fr !important; }
            .agency-demo-inner { grid-template-columns: 1fr !important; text-align: center; padding: 24px; }
            .section-dark .container { grid-template-columns: 1fr !important; text-align: center; }
          }
        `}</style>
      </main>
    </PageShell>
  );
}
