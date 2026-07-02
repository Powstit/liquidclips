import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { downloadUrl } from "@/lib/site";
import { SITE_URL } from "@/lib/env";

// /features — plain-language rundown of what the app actually does.
// Written for a 15-year-old who's never heard of "workflow tools." Every
// claim maps to real shipped code — no vaporware.

export const metadata: Metadata = {
  title: "Every feature · Liquid Clips",
  description:
    "The stuff Liquid Clips actually does. Drop a long video, get short clips. Captions burn in. Post to TikTok, Insta, YouTube Shorts, X — all from one app. Get paid for clips people watch.",
  alternates: { canonical: "/features" },
  keywords: [
    "Liquid Clips features",
    "AI clip finder",
    "auto captions",
    "TikTok scheduler",
    "clip publishing app",
    "content reward clips",
  ],
  openGraph: {
    title: "Every feature · Liquid Clips",
    description:
      "One app. Long video in, short clips out. Post everywhere. Get paid per view.",
    url: `${SITE_URL}/features`,
    type: "website",
  },
};

const FEATURES = [
  {
    kade: "/brand/kade/kade-cutting-clips.webp",
    eyebrow: "01 · the clip finder",
    title: "Drop a long video. Get short clips back.",
    body:
      "Paste a YouTube or TikTok link. Or drag a video off your desktop. Liquid Clips watches it, finds the parts people will actually stop scrolling for, and cuts them for you. No editing. No timeline. No hours lost.",
    proof: "In one podcast episode we got 42 clips back. All under 3 minutes.",
  },
  {
    kade: "/brand/kade/kade-generating-captions.webp",
    eyebrow: "02 · the captions",
    title: "Captions burn in automatically. In your style.",
    body:
      "Every clip lands with karaoke-style captions already on it. Word by word. Pick your color, size, font — the app remembers it for next time. You never type a single word yourself.",
    proof: "Same look every clip. Your brand, not ours.",
  },
  {
    kade: "/brand/kade/kade-publishing.webp",
    eyebrow: "03 · the post-everywhere",
    title: "Post to five platforms from one screen.",
    body:
      "TikTok. Instagram Reels. YouTube Shorts. X. Facebook. Link your accounts once, then hit post. Or drip — space them out over a week so the algorithm sees you're not spam.",
    proof: "One clip, five platforms. Two clicks each. That's it.",
  },
  {
    kade: "/brand/kade/kade-earn-mode.webp",
    eyebrow: "04 · the earn tab",
    title: "Get paid for clips people actually watch.",
    body:
      "Brands and creators put money into Whop content-reward campaigns. Their name, their brief, their payout per view. You clip their stuff, post it, and get paid when it hits verified views. All from the Earn tab.",
    proof: "One campaign paid $1,808 across 42 clippers in 8 weeks.",
  },
  {
    kade: "/brand/kade/kade-idle.webp",
    eyebrow: "05 · runs on your Mac",
    title: "Your files stay on your machine.",
    body:
      "Every clip is cut on your Mac. Not the cloud. Not our servers. Not shared. You choose when something leaves your computer — the moment you hit post.",
    proof: "Apple Silicon runs the AI locally. Zero uploads until you say so.",
  },
  {
    kade: "/brand/kade/kade-campaign-mode.webp",
    eyebrow: "06 · run your own agency",
    title: "Ship a whole campaign. Invite clippers. Earn 50% MRR.",
    body:
      "Agency tier: draft a brief, connect a Whop reward URL, publish. Invite clippers by email. Every clipper you bring in earns you 50% recurring on their subscription — from day one, no qualification grind.",
    proof: "Solo Agency starts at $50/mo. Cancel any time on Whop.",
    cta: { href: "/agency", label: "See agency tiers →" },
  },
];

const FAQ = [
  {
    q: "Do I need to know how to edit?",
    a: "No. If you can drag a file, you can use it. The app does the cuts, captions, and reframing. Editors are the users who WANT to tweak — everyone else just hits post.",
  },
  {
    q: "What computers does it run on?",
    a: "Mac only right now. Apple Silicon (M1/M2/M3/M4) runs fastest because the AI happens locally. Intel Macs work too — a little slower on the first clip. Windows is on the roadmap but not shipped.",
  },
  {
    q: "How much does it cost?",
    a: "Free for your first 100 clip exports — no card. After that, Solo is $29.99/mo, Pro is $99.99/mo, and the Agency tier is a $50/$299/$500 ladder if you want to run your own campaigns.",
  },
  {
    q: "Do I need an OpenAI account?",
    a: "On Free and Solo, yes — you bring your own OpenAI key so we're not paying for your clips. On Pro and up, we run hosted AI so you don't need one. Either way, it's optional to use captions and reframing.",
  },
  {
    q: "What is Whop and why does it keep coming up?",
    a: "Whop is where the money moves. Brands fund content-reward campaigns there, clippers get paid there, agencies fund their pot there. It's the payment rail. Liquid Clips is the workbench that plugs into it.",
  },
];

export default function FeaturesPage() {
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
        {/* ── HERO ───────────────────────────────────────────── */}
        <section className="hero" style={{ minHeight: 0, padding: "84px 0 40px" }}>
          <div className="container" style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 48, alignItems: "center" }}>
            <div>
              <div className="eyebrow">EVERYTHING THE APP DOES</div>
              <h1 className="page-title" style={{ margin: "22px 0 0" }}>
                Drop the video. <em>Get the clips.</em>
              </h1>
              <p className="hero-copy" style={{ margin: "22px 0 0", maxWidth: 560 }}>
                One app. Five platforms. Real payouts. No editing. Six features you'll
                actually use, one per section. If it's on this page, it's already shipped.
              </p>
              <div className="hero-actions" style={{ marginTop: 32 }}>
                <a href={downloadUrl} className="button-primary">
                  Download for Mac →
                </a>
                <Link href="/whats-clipping" className="button-secondary">
                  What's clipping?
                </Link>
              </div>
              <p style={{ marginTop: 22, fontSize: 13, color: "var(--text-tertiary)" }}>
                Free for your first 100 clips. No card. Cancel any time later.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Image
                src="/brand/kade/kade-cutting-clips.webp"
                alt="Kade the Liquid Clips operator cutting clips"
                width={480}
                height={480}
                priority
                className="features-hero-kade"
              />
            </div>
          </div>
        </section>

        {/* ── FEATURE STACK ─────────────────────────────────── */}
        {FEATURES.map((f, i) => {
          const flip = i % 2 === 1;
          return (
            <section
              key={f.title}
              className={`section ${i % 2 === 0 ? "section-warm" : ""}`}
              style={{ padding: "56px 0" }}
            >
              <div
                className="container features-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 48,
                  alignItems: "center",
                  direction: flip ? "rtl" : "ltr",
                }}
              >
                <div style={{ direction: "ltr" }}>
                  <div className="eyebrow">{f.eyebrow}</div>
                  <h2 className="section-title" style={{ marginTop: 20 }}>
                    {f.title}
                  </h2>
                  <p className="section-copy" style={{ marginTop: 16, maxWidth: 520 }}>
                    {f.body}
                  </p>
                  <div className="features-proof">
                    <span className="features-proof-dot" />
                    {f.proof}
                  </div>
                  {f.cta && (
                    <div style={{ marginTop: 24 }}>
                      <Link href={f.cta.href} className="button-secondary">
                        {f.cta.label}
                      </Link>
                    </div>
                  )}
                </div>
                <div style={{ direction: "ltr", display: "flex", justifyContent: "center" }}>
                  <div className="features-kade-wrap">
                    <Image
                      src={f.kade}
                      alt=""
                      width={360}
                      height={360}
                      className="features-kade"
                    />
                  </div>
                </div>
              </div>
            </section>
          );
        })}

        {/* ── FAQ ───────────────────────────────────────────── */}
        <section className="section section-warm" id="faq">
          <div className="container">
            <div className="eyebrow">STUFF PEOPLE ASK</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Five quick questions.
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
              Ready to see it? <em>Download it.</em>
            </h2>
            <p className="section-copy" style={{ marginTop: 18, textAlign: "center", maxWidth: 620, marginLeft: "auto", marginRight: "auto" }}>
              First 100 clips are free. No card. You'll know within 5 minutes whether it's
              worth staying on.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center", marginTop: 28 }}>
              <a href={downloadUrl} className="button-primary">
                Download for Mac →
              </a>
              <Link href="/agency" className="button-secondary">
                Run your own agency
              </Link>
            </div>
          </div>
        </section>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />

        <style>{`
          .features-hero-kade {
            width: min(400px, 90%);
            height: auto;
            filter: drop-shadow(0 24px 60px rgba(255,26,140,0.35));
            animation: features-kade-bob 5s ease-in-out infinite;
          }
          @keyframes features-kade-bob {
            0%, 100% { transform: translateY(0px) rotate(0deg); }
            50%      { transform: translateY(-10px) rotate(2deg); }
          }
          .features-kade-wrap {
            padding: 24px;
            background: radial-gradient(circle at 50% 50%, rgba(255,26,140,0.12), transparent 65%);
            border-radius: 50%;
          }
          .features-kade {
            width: min(320px, 85%);
            height: auto;
            filter: drop-shadow(0 20px 40px rgba(255,26,140,0.30));
            animation: features-kade-float 6s ease-in-out infinite;
          }
          @keyframes features-kade-float {
            0%, 100% { transform: translateY(0px); }
            50%      { transform: translateY(-8px); }
          }
          .features-proof {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            margin-top: 22px;
            padding: 10px 16px;
            border-radius: 999px;
            background: rgba(255,26,140,0.08);
            border: 1px solid rgba(255,26,140,0.3);
            font-family: var(--font-mono), monospace;
            font-size: 12px;
            color: var(--ink);
          }
          .features-proof-dot {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: var(--fuchsia);
            box-shadow: 0 0 10px rgba(255,26,140,0.8);
            animation: features-dot-pulse 1.8s ease-in-out infinite;
          }
          @keyframes features-dot-pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%      { opacity: 0.55; transform: scale(1.3); }
          }
          @media (prefers-reduced-motion: reduce) {
            .features-hero-kade,
            .features-kade,
            .features-proof-dot { animation: none; }
          }
          @media (max-width: 960px) {
            .hero .container,
            .features-row {
              grid-template-columns: 1fr !important;
              direction: ltr !important;
            }
          }
        `}</style>
      </main>
    </PageShell>
  );
}
