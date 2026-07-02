import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { downloadUrl } from "@/lib/site";
import { SITE_URL } from "@/lib/env";

// /whats-clipping — top-of-funnel education. Written for someone who has
// literally never heard the word "clipper" before. Answers 6 questions in
// order. Every number here is a real number from a real campaign.

export const metadata: Metadata = {
  title: "What's clipping? · Liquid Clips",
  description:
    "Clipping is turning long videos into short ones and getting paid when people watch. Podcasts, streams, YouTube — cut the best bits, post them, earn per view. Here's how it works, start to finish.",
  alternates: { canonical: "/whats-clipping" },
  keywords: [
    "what is clipping",
    "how to become a clipper",
    "content reward campaigns",
    "get paid for TikTok clips",
    "clipper starter guide",
    "Whop clipping",
  ],
  openGraph: {
    title: "What's clipping? · Liquid Clips",
    description:
      "Short videos = money. Here's how it works, who pays, and how you start.",
    url: `${SITE_URL}/whats-clipping`,
    type: "article",
  },
};

const STEPS = [
  {
    n: "01",
    kade: "/brand/kade/kade-reading-brief.webp",
    title: "Someone posts a bounty.",
    body:
      "A creator, brand, or agency puts money into a Whop content-reward campaign. They say: 'Here's a long video. Cut it into short clips. Post them on TikTok. I'll pay $X per 1,000 real views.' That's a bounty.",
  },
  {
    n: "02",
    kade: "/brand/kade/kade-cutting-clips.webp",
    title: "You cut the clips.",
    body:
      "You open Liquid Clips, drop the source video in, and the app finds the best moments. You get short clips back with captions already on them. Pick your favorites.",
  },
  {
    n: "03",
    kade: "/brand/kade/kade-publishing.webp",
    title: "You post them.",
    body:
      "Same app posts to TikTok, Instagram Reels, YouTube Shorts, X, Facebook. Space them out over a day or a week so the algorithm treats you like a real account, not a bot.",
  },
  {
    n: "04",
    kade: "/brand/kade/kade-earn-mode.webp",
    title: "Whop counts the views.",
    body:
      "Whop watches your posts. If a clip hits verified views (real humans, not bots), you earn. If it doesn't, you don't. Payouts are weekly, straight into your Whop wallet.",
  },
];

const FAQ = [
  {
    q: "How much do clippers actually make?",
    a: "It depends on the campaign and how much your clips take off. Real number from one campaign we ran: 42 clippers split $1,808 across 1.46 million verified views. The top clipper made ~$300 in 8 weeks. It's not a get-rich-quick — it's a get-paid-for-something-you'd-do-anyway.",
  },
  {
    q: "Do I need followers to start?",
    a: "No. Whop pays per view, not per follower. Two people with zero followers made ~$50 each in the Jae5 campaign because a couple of their clips went off. If your clip is good, the algorithm doesn't care who posted it.",
  },
  {
    q: "Is this legal? What about copyright?",
    a: "The bounty poster gives you rights to clip their video when they post the campaign. That's the whole point — they WANT you clipping their stuff. Reading the brief before you post is the only rule. If the brief says 'don't remix with music,' don't remix with music.",
  },
  {
    q: "Do I need a paid Liquid Clips account?",
    a: "No. The Free tier gives you 100 clip exports before you have to upgrade. Most people know within a week whether clipping is for them. If it isn't, you never paid anything.",
  },
  {
    q: "What if I want to run my own bounty instead of clipping other people's?",
    a: "That's the Agency tier. You put the money in, write the brief, invite clippers to your roster. You also earn 50% MRR on every clipper you bring in — from day one, no qualification grind. Starts at $50/mo.",
  },
  {
    q: "How is this different from just posting TikToks?",
    a: "You're posting for someone else's bounty, not your own account. Your goal isn't to build YOUR audience — it's to make THEIR clips go viral. That means less pressure to be a personality, more focus on picking the right moments from the source video.",
  },
];

export default function WhatsClippingPage() {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How clipping works",
    description: "Step-by-step: bounty → cut clips → post → get paid per verified view.",
    step: STEPS.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.body,
    })),
  };

  return (
    <PageShell>
      <main className="start-page">
        {/* ── HERO ───────────────────────────────────────────── */}
        <section className="hero" style={{ minHeight: 0, padding: "84px 0 40px" }}>
          <div className="container" style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 48, alignItems: "center" }}>
            <div>
              <div className="eyebrow">CLIPPING 101 · NEW HERE?</div>
              <h1 className="page-title" style={{ margin: "22px 0 0" }}>
                Cut short videos. <em>Get paid.</em>
              </h1>
              <p className="hero-copy" style={{ margin: "22px 0 0", maxWidth: 560 }}>
                Someone posts a long video and a bounty. You clip the best bits and post them
                on TikTok, Insta, Shorts. Whop counts real views. You get paid every week.
                That's clipping. Everything else on this page is detail.
              </p>
              <div className="hero-actions" style={{ marginTop: 32 }}>
                <a href={downloadUrl} className="button-primary">
                  Try it free →
                </a>
                <Link href="#how" className="button-secondary">
                  Show me how it works
                </Link>
              </div>
              <p style={{ marginTop: 22, fontSize: 13, color: "var(--text-tertiary)" }}>
                Real numbers below · one campaign paid 42 clippers $1,808 in 8 weeks.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Image
                src="/brand/kade/kade-earn-mode.webp"
                alt="Kade the Liquid Clips operator in earn mode"
                width={480}
                height={480}
                priority
                className="wc-hero-kade"
              />
            </div>
          </div>
        </section>

        {/* ── PROOF STRIP ────────────────────────────────────── */}
        <section className="section" style={{ paddingTop: 24 }}>
          <div className="container">
            <div className="eyebrow">REAL NUMBERS · JAE5 CAMPAIGN · APR–JUN 2026</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              We ran a real one. Here's what happened.
            </h2>
            <div className="wc-proof-row">
              <div className="wc-proof-tile">
                <div className="wc-proof-num">1,458,005</div>
                <div className="wc-proof-lbl">views · one campaign</div>
              </div>
              <div className="wc-proof-tile">
                <div className="wc-proof-num">$1,808.30</div>
                <div className="wc-proof-lbl">paid to 42 clippers</div>
              </div>
              <div className="wc-proof-tile">
                <div className="wc-proof-num">$1.24</div>
                <div className="wc-proof-lbl">per 1,000 views · under cap</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS · 4 STEPS ─────────────────────────── */}
        <section className="section section-warm" id="how">
          <div className="container">
            <div className="eyebrow">HOW IT WORKS</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Four steps. That's the whole thing.
            </h2>
            <div className="wc-steps">
              {STEPS.map((s) => (
                <article className="wc-step" key={s.n}>
                  <div className="wc-step-visual">
                    <span className="wc-step-num">{s.n}</span>
                    <Image src={s.kade} alt="" width={200} height={200} className="wc-step-kade" />
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ───────────────────────────────────────────── */}
        <section className="section" id="faq">
          <div className="container">
            <div className="eyebrow">STUFF PEOPLE ASK</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Six real questions.
            </h2>
            <div className="help-article" style={{ marginTop: 36 }}>
              {FAQ.map((f) => (
                <section className="help-section" key={f.q}>
                  <h2 style={{ fontSize: 22 }}>{f.q}</h2>
                  <p>{f.a}</p>
                </section>
              ))}
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ─────────────────────────────────────── */}
        <section className="section section-dark">
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>INSERT COIN</div>
            <h2 className="section-title" style={{ marginTop: 22, textAlign: "center" }}>
              First 100 clips are free. <em>No card.</em>
            </h2>
            <p className="section-copy" style={{ marginTop: 18, textAlign: "center", maxWidth: 620, marginLeft: "auto", marginRight: "auto" }}>
              You'll know in a week whether clipping is your thing. If it is, you'll be
              chasing bounties. If it isn't, you never paid anything.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center", marginTop: 28 }}>
              <a href={downloadUrl} className="button-primary">
                Download for Mac →
              </a>
              <Link href="/features" className="button-secondary">
                Every feature
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

        <style>{`
          .wc-hero-kade {
            width: min(400px, 90%);
            height: auto;
            filter: drop-shadow(0 24px 60px rgba(255,26,140,0.35));
            animation: wc-kade-bob 5.5s ease-in-out infinite;
          }
          @keyframes wc-kade-bob {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50%      { transform: translateY(-10px) rotate(-2deg); }
          }
          .wc-proof-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 18px;
            margin-top: 36px;
          }
          .wc-proof-tile {
            padding: 24px 22px;
            border: 1px solid var(--line);
            border-radius: 14px;
            background: var(--paper);
          }
          .wc-proof-num {
            font-family: var(--font-display), Georgia, serif;
            font-size: clamp(28px, 3.4vw, 40px);
            font-weight: 600;
            letter-spacing: -0.02em;
            color: var(--fuchsia);
          }
          .wc-proof-lbl {
            margin-top: 6px;
            font-size: 12.5px;
            line-height: 1.55;
            color: var(--text-secondary);
          }
          .wc-steps {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 18px;
            margin-top: 42px;
          }
          .wc-step {
            padding: 24px;
            border: 1px solid var(--line);
            border-radius: 16px;
            background: var(--paper);
          }
          .wc-step-visual {
            position: relative;
            display: flex;
            justify-content: center;
            padding: 12px 0 20px;
          }
          .wc-step-num {
            position: absolute;
            top: 0;
            left: 0;
            font-family: var(--font-mono), monospace;
            font-size: 22px;
            font-weight: 600;
            color: var(--fuchsia);
            letter-spacing: 0.08em;
          }
          .wc-step-kade {
            width: 150px;
            height: auto;
            filter: drop-shadow(0 12px 24px rgba(255,26,140,0.28));
            animation: wc-step-float 4.5s ease-in-out infinite;
          }
          .wc-step:nth-child(2) .wc-step-kade { animation-delay: 0.4s; }
          .wc-step:nth-child(3) .wc-step-kade { animation-delay: 0.8s; }
          .wc-step:nth-child(4) .wc-step-kade { animation-delay: 1.2s; }
          @keyframes wc-step-float {
            0%, 100% { transform: translateY(0px); }
            50%      { transform: translateY(-6px); }
          }
          .wc-step h3 {
            font-family: var(--font-display), Georgia, serif;
            font-size: 20px;
            font-weight: 600;
            letter-spacing: -0.01em;
            color: var(--ink);
            margin: 12px 0 8px;
          }
          .wc-step p {
            font-size: 14px;
            line-height: 1.55;
            color: var(--text-secondary);
          }
          @media (prefers-reduced-motion: reduce) {
            .wc-hero-kade,
            .wc-step-kade { animation: none; }
          }
          @media (max-width: 960px) {
            .hero .container,
            .wc-proof-row,
            .wc-steps { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </main>
    </PageShell>
  );
}
