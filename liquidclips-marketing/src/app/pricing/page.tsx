import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { accountUrl, supportEmail } from "@/lib/site";
import { SITE_URL } from "@/lib/env";

// Marketing /pricing page. Mirrors the data shape in
// account-app/src/components/PricingCards.tsx (the in-app upgrade surface)
// but presented at marketing weight — comparison-friendly, link-out to
// the in-app checkout instead of embedding Clerk CheckoutButton.
//
// Source of truth for plan IDs lives in the account-app component; this
// page only carries copy + price points. When pricing changes, edit the
// account-app component first, then sync this file.
//
// All copy here promises only what ships today. "Hosted AI", "drip
// scheduling", and "white-label exports" are intentionally not promised
// — they're marked Soon on the in-app card and we keep that discipline
// here too.

export const metadata: Metadata = {
  title: "Pricing — Liquid Clips",
  description:
    "Free, Solo $29.99, Pro $99.99, Agency $500 per month. Local-first clipping for one creator or a whole team. Cancel anytime. USD billed monthly via Whop.",
  alternates: { canonical: "/pricing" },
  keywords: [
    "Liquid Clips pricing",
    "clipping software cost",
    "clipper subscription",
    "content rewards pricing",
    "video clipping app price",
    "agency clipping plan",
  ],
  openGraph: {
    title: "Liquid Clips pricing — Free, Solo, Pro, Agency",
    description:
      "Free to start. Upgrade only when 100 starter clips runs out.",
    url: `${SITE_URL}/pricing`,
    type: "website",
  },
};

type Plan = {
  id: string;
  name: string;
  priceUsd: number;
  tagline: string;
  highlights: string[];
  cta: { label: string; href: string; primary: boolean };
  featured?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceUsd: 0,
    tagline: "Try it. 100 clip exports, no card.",
    highlights: [
      "100 free clip exports",
      "Bring your own OpenAI key",
      "Multi-ratio export · 9:16 · 1:1 · 4:5",
    ],
    cta: { label: "Sign up free", href: "/sign-up", primary: false },
  },
  {
    id: "pro",
    name: "Solo",
    priceUsd: 29.99,
    tagline: "Unlimited clips for one creator.",
    highlights: [
      "Unlimited videos per month",
      "5 connected social accounts",
      "Local-only processing on your Mac",
    ],
    cta: { label: "Start with Solo", href: `${accountUrl}/upgrade?plan=pro`, primary: true },
  },
  {
    id: "growth",
    name: "Pro",
    priceUsd: 99.99,
    tagline: "More accounts, more output, more clippers.",
    highlights: [
      "Everything in Solo",
      "10 connected social accounts",
      "All platform connections wired",
    ],
    cta: { label: "Start with Pro", href: `${accountUrl}/upgrade?plan=growth`, primary: true },
    featured: true,
  },
  {
    id: "agency",
    name: "Agency",
    priceUsd: 500,
    tagline: "Content-reward campaigns and team accounts.",
    highlights: [
      "Everything in Pro",
      "25 connected social accounts",
      "Whop content-reward campaigns",
    ],
    cta: { label: "Start with Agency", href: `${accountUrl}/upgrade?plan=agency`, primary: false },
  },
];

type ComparisonRow = {
  feature: string;
  free: string;
  pro: string;
  growth: string;
  agency: string;
};

const COMPARISON: ComparisonRow[] = [
  { feature: "Clip exports per month", free: "100", pro: "Unlimited", growth: "Unlimited", agency: "Unlimited" },
  { feature: "Connected social accounts", free: "1", pro: "5", growth: "10", agency: "25" },
  { feature: "Multi-ratio export · 9:16 · 1:1 · 4:5", free: "Yes", pro: "Yes", growth: "Yes", agency: "Yes" },
  { feature: "B-roll overlay and hook burn-in", free: "Yes", pro: "Yes", growth: "Yes", agency: "Yes" },
  { feature: "Local-only processing on your Mac", free: "Yes", pro: "Yes", growth: "Yes", agency: "Yes" },
  { feature: "Bring your own OpenAI key", free: "Yes", pro: "Yes", growth: "Yes", agency: "Yes" },
  { feature: "Submit to Whop content-reward campaigns", free: "Yes", pro: "Yes", growth: "Yes", agency: "Yes" },
  { feature: "Run your own content-reward campaigns", free: "—", pro: "—", growth: "—", agency: "Yes" },
  { feature: "Priority support", free: "—", pro: "—", growth: "Soon", agency: "Soon" },
];

const faqs = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. Whop handles your subscription, card, receipts, and cancellation. Your local projects and exported clips stay on your computer.",
  },
  {
    q: "Do I have to pay to clip?",
    a: "No. The Free tier covers 100 clip exports for new accounts with no card on file. Upgrade only when you outgrow the starter pass.",
  },
  {
    q: "Is annual billing available?",
    a: "Not yet. Monthly only until we have real cohort data to back a discount — no fake save-20% theatre. Annual ships once we can offer it honestly.",
  },
  {
    q: "What changes between Solo, Pro, and Agency?",
    a: "Account count and campaign access. Solo is one creator with 5 accounts. Pro is 10 accounts plus higher capacity. Agency is 25 accounts plus the ability to run your own content-reward campaigns through Whop.",
  },
  {
    q: "Where do I see all the features?",
    a: "The desktop app's plan picker shows every entitlement, including the ones still marked Soon. Each Soon line ships when the in-app card flips from outline to filled — no separate roadmap to track.",
  },
];

export default function PricingPage() {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Liquid Clips",
    description:
      "Local-first desktop workbench for clippers. Turn long videos into vertical, captioned, publish-ready clips. Submit to Whop content-reward campaigns and earn per qualifying view.",
    brand: { "@type": "Brand", name: "Liquid Clips" },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "0",
      highPrice: "500",
      offerCount: PLANS.length,
      offers: PLANS.map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.priceUsd.toFixed(2),
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: `${SITE_URL}${p.cta.href.startsWith("http") ? "" : p.cta.href}`,
      })),
    },
  };

  return (
    <PageShell>
      <main className="start-page">
        {/* Hero */}
        <section className="hero" style={{ minHeight: 0, padding: "72px 0 32px" }}>
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>
              PRICING · INSERT COIN
            </div>
            <h1 className="page-title" style={{ margin: "20px auto 0", textAlign: "center" }}>
              Free to start. Upgrade when <em>100 clips</em> runs out.
            </h1>
            <p className="hero-copy" style={{ margin: "20px auto 0", textAlign: "center", maxWidth: 680 }}>
              Four tiers. USD billed monthly by Whop. Your bank converts at their
              card-network rate. Cancel anytime from your dashboard.
            </p>
          </div>
        </section>

        {/* Plan cards */}
        <section className="section section-warm">
          <div className="container">
            <div className="pricing-grid">
              {PLANS.map((p) => (
                <PlanCard key={p.id} plan={p} />
              ))}
            </div>
            <p className="section-copy muted" style={{ marginTop: 28, textAlign: "center", fontSize: 13 }}>
              Billed monthly in USD by Whop. No annual lock-in today.
            </p>
          </div>
        </section>

        {/* Comparison table */}
        <section className="section" id="compare">
          <div className="container">
            <div className="eyebrow">COMPARE</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              What you get on every tier.
            </h2>
            <p className="section-copy">
              Side-by-side view of the entitlements. Lines marked &ldquo;Soon&rdquo; are scoped and
              wired in the app — they flip from outline to filled when the ship lands. Full feature
              spec lives inside the desktop app&rsquo;s plan picker.
            </p>
            <div className="pricing-compare-wrap">
              <table className="pricing-compare">
                <thead>
                  <tr>
                    <th scope="col" className="pricing-compare-feature">Feature</th>
                    <th scope="col">Free</th>
                    <th scope="col">Solo</th>
                    <th scope="col" className="pricing-compare-feature-active">Pro</th>
                    <th scope="col">Agency</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON.map((row) => (
                    <tr key={row.feature}>
                      <th scope="row" className="pricing-compare-feature">{row.feature}</th>
                      <td>{row.free}</td>
                    <td>{row.pro}</td>
                      <td className="pricing-compare-feature-active">{row.growth}</td>
                      <td>{row.agency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section section-warm" id="faq">
          <div className="container">
            <div className="eyebrow">BEFORE YOU PICK A TIER</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Questions about pricing.
            </h2>
            <div className="help-article" style={{ marginTop: 36 }}>
              {faqs.map((f) => (
                <section className="help-section" key={f.q}>
                  <h2 style={{ fontSize: 22 }}>{f.q}</h2>
                  <p>{f.a}</p>
                </section>
              ))}
              <div className="help-callout">
                <h2>Need help picking a tier?</h2>
                <p>
                  Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with how many videos
                  per month you cut and which platforms you publish to. We will reply with the tier
                  that costs least for your actual usage.
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
              Ready to start?
            </h2>
            <p className="section-copy" style={{ marginTop: 18, textAlign: "center" }}>
              Free tier covers your first 100 clips. No card required.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center", marginTop: 28 }}>
              <Link href="/sign-up" className="button-primary">
                Sign up free
              </Link>
              <Link href="/download" className="button-secondary">
                Download for Mac
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
        />

        {/* Lightweight scoped styles for the comparison table — no new global
            tokens, just layout for a marketing-weight table. All colour
            references use existing CSS variables from globals.css. */}
        <style>{`
          .pricing-compare-wrap {
            margin-top: 36px;
            overflow-x: auto;
            border: 1px solid var(--line);
            border-radius: 12px;
            background: var(--paper);
          }
          .pricing-compare {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
            min-width: 640px;
          }
          .pricing-compare th,
          .pricing-compare td {
            padding: 14px 18px;
            text-align: left;
            border-bottom: 1px solid var(--line);
            color: var(--ink);
            vertical-align: middle;
          }
          .pricing-compare thead th {
            font-family: var(--font-mono), monospace;
            font-size: 11px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--text-tertiary);
            background: var(--paper-warm);
          }
          .pricing-compare tbody tr:last-child th,
          .pricing-compare tbody tr:last-child td {
            border-bottom: none;
          }
          .pricing-compare-feature {
            font-weight: 600;
            color: var(--ink);
          }
          .pricing-compare thead th.pricing-compare-feature-active,
          .pricing-compare td.pricing-compare-feature-active {
            color: var(--fuchsia);
            background: rgba(255, 26, 140, 0.04);
          }
        `}</style>
      </main>
    </PageShell>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const isFree = plan.priceUsd === 0;
  return (
    <article className={`price-card ${plan.featured ? "featured" : ""}`}>
      <div className="plan-kicker">{plan.name.toUpperCase()}</div>
      <div className="price">
        {isFree ? "Free" : `$${plan.priceUsd.toFixed(2)}`}
        {!isFree && <span> /mo</span>}
      </div>
      <p style={{ marginTop: 12 }}>{plan.tagline}</p>
      <ul className="checks">
        {plan.highlights.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      <div style={{ marginTop: "auto", paddingTop: 24 }}>
        <Link
          href={plan.cta.href}
          className={plan.cta.primary ? "button-primary" : "button-secondary"}
          style={{ width: "100%", justifyContent: "center", display: "inline-flex" }}
        >
          {plan.cta.label}
        </Link>
      </div>
    </article>
  );
}
