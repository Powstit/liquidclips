import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { DownloadCTA, DownloadMeta } from "@/components/DownloadCTA";
import { accountUrl, supportEmail } from "@/lib/site";
import { getLatestRelease } from "@/lib/latest-release";

export const metadata: Metadata = {
  title: "Start clipping YouTube, TikTok, podcasts — Liquid Clips onboarding",
  description:
    "Liquid Clips turns long videos into TikToks, Shorts, and Reels in 60 seconds. Sign up, drop a URL, get paid for clipping. Mac app — free to start.",
  alternates: { canonical: "/start" },
  keywords: [
    "how to clip YouTube videos",
    "TikTok clip maker",
    "YouTube to Shorts",
    "podcast clips",
    "clipping rewards",
    "make money clipping",
    "creator clipping platform",
    "Liquid Clips onboarding",
  ],
  openGraph: {
    title: "Start clipping YouTube, TikTok, podcasts — Liquid Clips",
    description:
      "Drop a long video, get publish-ready clips. Sign up free, optionally earn rewards on Whop.",
    url: "https://liquidclips.app/start",
    type: "article",
  },
};

const steps = [
  {
    num: "01",
    title: "Download Liquid Clips for Mac.",
    icon: "/icons/pillar-drop.png",
    body: "Get the signed, notarized .dmg from this page. Drag the app into Applications. Open it once. You're at the cockpit.",
  },
  {
    num: "02",
    title: "Pick your door — Direct or Whop.",
    icon: "/icons/pillar-publish.png",
    body: "Direct sign-in: Continue with Google, free Starter Pass (100 clip credits) on the house. Whop sign-in: for members of a creator's clipping community — your subscription + affiliate rewards run through Whop.",
  },
  {
    num: "03",
    title: "Drop a long video — file or URL.",
    icon: "/icons/pillar-clip.png",
    body: "Paste a YouTube link. Paste a TikTok. Paste a Twitch VOD, an X / Twitter video, an Instagram Reel source, a podcast episode. Or drag in a local .mp4. Liquid Clips downloads it locally — your bandwidth, your file.",
  },
  {
    num: "04",
    title: "Pick + brand your clips.",
    icon: "/icons/pillar-caption.png",
    body: "Hosted AI scores the strong moments and cuts. Hard-burnt captions, auto-reframe to 9:16, per-clip thumbnail covers. You scrub the timeline, tighten the hook, swap a caption style if you want different vibes.",
  },
  {
    num: "05",
    title: "Publish to TikTok, Shorts, Reels — or earn rewards.",
    icon: "/icons/pillar-reframe.png",
    body: "Schedule directly to your connected social channels. Or submit each clip to a creator's reward campaign on Whop and get paid per qualifying view. Track your clip performance from the Earn tab.",
  },
] as const;

const faqs = [
  {
    q: "What kind of videos can I clip?",
    a: "Anything with audio. Long YouTube videos, TikTok lives, Twitch VODs, podcast episodes, recorded webinars, Zoom calls, conference talks, Instagram Reels, even local .mp4 files. If yt-dlp can pull it or your Mac can read it, Liquid Clips can clip it.",
  },
  {
    q: "Do I need an OpenAI key?",
    a: "Free and Solo plans bring their own OpenAI key for the clip-selection step (paste a key starting with sk- in Settings). Pro and Agency plans get hosted AI — no key needed, no per-clip OpenAI bill, faster picks.",
  },
  {
    q: "What's Clip Rewards?",
    a: "Creator-run reward campaigns inside Whop where clippers get paid per qualifying view on TikTok / Reels / Shorts. Liquid Clips routes each submitted clip through the campaign, tracks views via the platform APIs, and surfaces your earnings inside the desktop Earn tab. Payouts run through Whop.",
  },
  {
    q: "Is it really 60 seconds?",
    a: "From URL paste to first clip exported: typically 45-90 seconds on Pro (hosted AI + fast machines), 2-4 minutes on Free (depends on your Mac's CPU and OpenAI response time). A 3-hour podcast usually produces 30-50 clips in the first pass.",
  },
  {
    q: "Does it work on Windows / Linux?",
    a: "Mac-only today (macOS 12+, Intel and Apple Silicon). Windows and Linux are not on the roadmap yet — we don't ship until each platform feels native.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. Direct subscribers cancel from account.liquidclips.app/dashboard (Stripe). Whop subscribers cancel from whop.com. Your clips, exports, and license stay yours.",
  },
];

const videoTypes = [
  {
    title: "YouTube long-form to Shorts",
    body: "Paste a YouTube URL — 10-minute video, 1-hour podcast, 3-hour stream. Liquid Clips downloads the source locally, picks the moments, captions them, reframes to 9:16. Ready-to-upload Shorts in one pass.",
  },
  {
    title: "TikTok lives + long content",
    body: "TikTok now allows up to 60-minute uploads, and creators paste TikTok lives into Liquid Clips to re-cut the highlights for fresh upload. Auto-pulls the source TikTok video, generates 5-15 ready clips per source.",
  },
  {
    title: "Podcast episodes",
    body: "Apple, Spotify, YouTube podcast feeds. Drop the audio file or paste the YouTube link. Liquid Clips uses face-aware reframing on the video track and burnt captions on the audio so each clip stands on its own.",
  },
  {
    title: "Twitch VODs + stream highlights",
    body: "Streamers paste a Twitch VOD URL or upload the local recording. Liquid Clips finds the spikes (gameplay clutches, audio reactions, chat-driven peaks) and cuts them into vertical clips with stream UI cropped out automatically.",
  },
  {
    title: "Webinars, talks, lectures",
    body: "Educational creators run conference talks and product webinars through Liquid Clips. The clip-pick model prioritises soundbite moments — the quote that becomes the LinkedIn post, the slide that becomes the carousel.",
  },
  {
    title: "Local .mp4 you own",
    body: "Personal recordings, screen captures, agency client footage — drag the file into the cockpit. Nothing leaves your machine unless you explicitly choose hosted AI on Pro+.",
  },
] as const;

export default async function StartPage() {
  // Same pattern as the homepage — fetch latest release for DownloadCTA, fall
  // back to component defaults if the GH API blips.
  const latest = await getLatestRelease();
  const artifacts = latest
    ? {
        macArm: latest.macArm ?? undefined,
        macIntel: latest.macIntel ?? undefined,
        macUniversal: latest.macUniversal ?? undefined,
      }
    : undefined;

  // JSON-LD payloads embedded after render — HowTo for the 5 steps, FAQPage
  // for the FAQ block. Google parses these for rich results.
  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to start clipping YouTube and TikTok videos with Liquid Clips",
    description:
      "Install Liquid Clips on Mac, sign in, drop a long video URL, pick and brand the clips, then publish to TikTok / Shorts / Reels or earn through Clip Rewards.",
    image: "https://liquidclips.app/brand/og-default.png",
    totalTime: "PT3M",
    step: steps.map((s) => ({
      "@type": "HowToStep",
      position: Number(s.num),
      name: s.title.replace(/\.$/, ""),
      text: s.body,
    })),
  };

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <PageShell>
      <main className="start-page">
        {/* ───── Hero ───── */}
        <section className="hero" style={{ minHeight: 0, padding: "72px 0 32px" }}>
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>
              START SCREEN · ONBOARDING
            </div>
            <h1 className="page-title" style={{ margin: "20px auto 0", textAlign: "center" }}>
              Start clipping. <em>YouTube, TikTok, podcasts</em> — all in 60 seconds.
            </h1>
            <p className="hero-copy" style={{ margin: "20px auto 0", textAlign: "center", maxWidth: 720 }}>
              Liquid Clips turns long videos into vertical, captioned, publish-ready clips for
              TikTok, YouTube Shorts, and Instagram Reels. Drop a URL, pick the moments, ship the
              clips — or earn through Clip Rewards on Whop. This page walks you through every step.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center" }}>
              <DownloadCTA variant="primary" artifacts={artifacts} />
              <Link href="#how-it-works" className="button-secondary">
                See the 5 steps
              </Link>
            </div>
            <div style={{ marginTop: 14, textAlign: "center" }}>
              <DownloadMeta />
            </div>
          </div>
        </section>

        {/* ───── The 5 steps ───── */}
        <section id="how-it-works" className="section section-warm">
          <div className="container">
            <div className="eyebrow">ATTRACT MODE</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              The five steps from <em>install</em> to <em>first clip live</em>.
            </h2>
            <p className="section-copy">
              No course. No 40-minute tutorial. Liquid Clips is opinionated software: the path from
              long video to published Short is short on purpose. Here&rsquo;s exactly what happens.
            </p>
            <div className="steps-grid">
              {steps.map((step) => (
                <article className="tile" key={step.num}>
                  <div className="num">{step.num}</div>
                  <Image
                    src={step.icon}
                    alt=""
                    width={48}
                    height={48}
                    style={{ marginBottom: 12, opacity: 0.92 }}
                  />
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ───── Two doors ───── */}
        <section className="section">
          <div className="container">
            <div className="eyebrow">PLAYER SELECT</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Two doors. Same desktop app. Different billing stacks.
            </h2>
            <p className="section-copy">
              Liquid Clips supports two sign-up paths because clippers come from two worlds:
              creators who manage their own subscription, and members of a creator&rsquo;s clipping
              community who pay through Whop. Pick whichever describes you.
            </p>
            <div className="feature-grid" style={{ marginTop: 42 }}>
              <article className="tile">
                <h3>Direct sign-up (Google + Stripe)</h3>
                <p>
                  Sign in with Google. 100 free clip credits on the Starter Pass. Upgrade to Solo
                  ($29.99/mo), Pro ($79.99/mo) for hosted AI, or Agency ($149/mo). Billing managed
                  by Stripe on{" "}
                  <Link href={accountUrl + "/dashboard"} className="inline-link">
                    your dashboard
                  </Link>
                  . Cancel anytime.
                </p>
              </article>
              <article className="tile">
                <h3>Whop sign-up (creator clipping communities)</h3>
                <p>
                  Pay through Whop, get desktop activation + access to that creator&rsquo;s Clip
                  Rewards campaigns. Subscription managed on whop.com. Affiliate commission goes to
                  the creator who referred you. Submit clips directly from the desktop Earn tab.
                </p>
              </article>
            </div>
            <p className="section-copy muted" style={{ marginTop: 28, fontSize: 14 }}>
              You can switch doors later. Existing Direct subscribers can join a Whop campaign;
              existing Whop members can add a Direct subscription if they want extra clip credit
              outside their campaign.
            </p>
          </div>
        </section>

        {/* ───── Clip Rewards ───── */}
        <section className="section section-dark">
          <div className="container">
            <div className="eyebrow">CLIP REWARDS</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Make money clipping. Per qualifying view.
            </h2>
            <p className="section-copy">
              Clip Rewards is the part most clipping platforms gatekeep behind &ldquo;contact
              us&rdquo;. Liquid Clips wires it in by default. Every clip you publish to TikTok,
              Shorts, or Reels from a connected reward campaign earns CPM-based payouts settled by
              the creator&rsquo;s campaign budget. Track everything from the Earn tab inside the
              desktop app.
            </p>
            <div className="feature-grid">
              <article className="tile">
                <h3>Submit from the desktop</h3>
                <p>
                  After a clip exports, the Submit button routes it into whichever Whop reward
                  campaign you joined. Campaigns are creator-funded — Liquid Clips just runs the
                  rails.
                </p>
              </article>
              <article className="tile">
                <h3>Tracked views, honest payouts</h3>
                <p>
                  View counts pull from TikTok, YouTube, and Instagram APIs daily. Earnings update
                  per campaign rules (CPM, qualifying threshold, dedupe). All visible in the Earn
                  tab — no spreadsheets, no waiting on creator screenshots.
                </p>
              </article>
              <article className="tile">
                <h3>Payouts via Whop</h3>
                <p>
                  Whop handles the money flow. Stripe-backed payouts to bank or crypto wallet
                  depending on creator setup. KYC happens once on Whop and applies across every
                  reward campaign you join.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* ───── Anything with audio ───── */}
        <section className="section section-warm">
          <div className="container">
            <div className="eyebrow">POWER-UPS</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              If it has audio, you can clip it.
            </h2>
            <p className="section-copy">
              Long-form video is exploding in 2026, but most of it sits unwatched. Liquid Clips
              works on whatever long-form source you have — YouTube uploads, podcast episodes,
              Twitch streams, recorded talks, even client footage from your agency. Here&rsquo;s
              the typical use-case grid.
            </p>
            <div className="feature-grid">
              {videoTypes.map((v) => (
                <article className="tile" key={v.title}>
                  <h3>{v.title}</h3>
                  <p>{v.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ───── FAQ ───── */}
        <section className="section" id="faq">
          <div className="container">
            <div className="eyebrow">BONUS LIFE</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Questions clippers ask before they sign up.
            </h2>
            <div className="help-article" style={{ marginTop: 36 }}>
              {faqs.map((f) => (
                <section className="help-section" key={f.q}>
                  <h2 style={{ fontSize: 22 }}>{f.q}</h2>
                  <p>{f.a}</p>
                </section>
              ))}
              <div className="help-callout">
                <h2>Stuck during onboarding?</h2>
                <p>
                  Email{" "}
                  <a href={`mailto:${supportEmail}`}>{supportEmail}</a> with your macOS version, the
                  step you hit, and what the app showed. Real human reply within one business day.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ───── Final CTA ───── */}
        <section className="section section-dark">
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>
              INSERT COIN
            </div>
            <h2 className="section-title" style={{ marginTop: 22, textAlign: "center" }}>
              Ready to clip?
            </h2>
            <p className="section-copy" style={{ marginTop: 18, textAlign: "center" }}>
              Free to download. Free to start. Upgrade only when 100 starter clips isn&rsquo;t
              enough.
            </p>
            <div className="hero-actions" style={{ justifyContent: "center", marginTop: 28 }}>
              <DownloadCTA variant="primary" artifacts={artifacts} />
            </div>
            <div style={{ marginTop: 14 }}>
              <DownloadMeta />
            </div>
          </div>
        </section>

        {/* ───── Schema.org JSON-LD for HowTo + FAQ rich results ───── */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(howToLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
      </main>
    </PageShell>
  );
}
