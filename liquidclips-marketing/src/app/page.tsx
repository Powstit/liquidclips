import Image from "next/image";
import { PageShell } from "@/components/Chrome";
import { DemoCabinet } from "@/components/DemoCabinet";
import { DownloadCTA, DownloadMeta } from "@/components/DownloadCTA";
import { FleetMarquee, Marquee } from "@/components/Marquee";
import { accountUrl } from "@/lib/site";

const steps = [
  {
    num: "01",
    title: "Drop the long video.",
    icon: "/icons/pillar-drop.png",
    body: "Twitch VOD, podcast, livestream, YouTube long. Drop the file or paste the URL. We pull it down locally — your bandwidth, your files.",
  },
  {
    num: "02",
    title: "Slice into clips.",
    icon: "/icons/pillar-clip.png",
    body: "Hosted AI finds the strong moments. Hard-coded captions burnt in. Auto-reframe to 9:16. 47 ready-to-submit clips from a 3h podcast.",
  },
  {
    num: "03",
    title: "Submit. Get paid.",
    icon: "/icons/pillar-publish.png",
    body: "Send to TikTok / Reels / Shorts / X straight from the app. Submit to active Whop briefs. Payouts hit your bag.",
  },
];

const features = [
  { title: "Local-first processing", icon: "/icons/pillar-drop.png", body: "Files stay on your machine. Faster-whisper + ffmpeg bundled. No upload queue, no usage caps on your own clips." },
  { title: "Captions, baked", icon: "/icons/pillar-caption.png", body: "Hard-coded captions per-platform style. Whop briefs that require captions are pre-handled." },
  { title: "Auto-reframe 9:16", icon: "/icons/pillar-reframe.png", body: "Face-aware crop via native Swift detection. Speaker stays in frame, dead air gets cut." },
  { title: "One-click publish", icon: "/icons/pillar-publish.png", body: "Connect your Ayrshare Profile Key once. Send a clip to 6 platforms in two clicks." },
];

const tiers = [
  {
    name: "ROOKIE",
    badge: "/brand/invader.png",
    price: "$0",
    kicker: "100 free exports · BYO key",
    body: "Tutorial mode. Use your own OpenAI key. Watermarked.",
    features: ["100 clip exports", "Local processing", "BYO AI key", "Watermarked exports", "Submit to Whop"],
  },
  {
    name: "PRO CLIPPER",
    badge: "/brand/invader.png",
    price: "$29.99",
    kicker: "one creator · clean export",
    body: "Unlimited clips, no watermark, one-creator workflow.",
    features: ["Unlimited clip exports", "5 social accounts", "BYO AI key", "Clean export · no watermark", "Local-first"],
  },
  {
    name: "RUNNER",
    badge: "/icons/tier-runner-badge.png",
    price: "$79",
    kicker: "hosted AI · scaled hustle",
    body: "Hosted AI for no-key setup. Built for clippers running 200+ clips/week.",
    features: ["10 social accounts", "Hosted AI proxy", "Multi-platform publishing", "Scheduling + drip", "Priority briefs"],
    featured: true,
  },
  {
    name: "AGENCY BOSS",
    badge: "/brand/invader.png",
    price: "$149",
    kicker: "client teams · white label",
    body: "Run a clip-farm. Sub-accounts, white-label exports.",
    features: ["25 social accounts", "Client sub-accounts", "White-label exports", "Priority support", "Final-boss mode"],
  },
];

const stories = [
  { name: "AISHA", role: "PODCAST CLIPPER", photo: "/portraits/portrait-aisha.png", quote: "14 hours straight, week one — $640. Now $3k/mo on Joe Rogan + Lex back catalogue." },
  { name: "MARCO", role: "POKER CLIPPER", photo: "/portraits/portrait-marco.png", quote: "Hustler Casino Live + Hellmuth meltdowns. $1.2k my first weekend." },
  { name: "ZARA", role: "MINECRAFT CLIPPER", photo: "/portraits/portrait-zara.png", quote: "Story-moment hunting in long Minecraft VODs. $800/wk on the active brief." },
  { name: "THEO", role: "SPORTS CLIPPER", photo: "/portraits/portrait-theo.png", quote: "47 F1 clips on Sunday, $400 retainer + bonuses." },
];

export default function Home() {
  return (
    <PageShell>
      <main>
        <Marquee tokens={["SUBMIT CLIP", "DROP VIDEO", "CLIP", "POST", "EARN", "REPEAT", "INSERT COIN"]} />

        <section className="hero" style={{ minHeight: 0, padding: "56px 0 24px" }}>
          <div className="container" style={{ textAlign: "center" }}>
            <div className="eyebrow" style={{ margin: "0 auto" }}>THE ARCADE FOR CLIPPERS · LIVE NOW</div>
            <h1 style={{ margin: "20px auto 0", textAlign: "center" }}>
              Drop video. <em>Clip. Post. Earn.</em>
            </h1>
            <p className="hero-copy" style={{ margin: "20px auto 0", textAlign: "center" }}>
              Liquid Clips turns long podcasts, livestreams, Twitch VODs and YouTube long-form
              into captioned, ready-to-submit clips for Whop Content Rewards. Local-first.
              Signed for Mac. Built by a clipper.
            </p>
          </div>
        </section>

        {/* THE DEMO CABINET — the interactive showpiece. Six buttons, real
            clip workflow simulated on a looping video, floating Invader badge. */}
        <section style={{ padding: "16px 0 120px", position: "relative" }}>
          <DemoCabinet />

          {/* BIG download CTA — directly below the cabinet */}
          <div className="container" style={{ marginTop: 56, textAlign: "center" }}>
            <div className="big-download">
              <DownloadCTA variant="primary" className="button-primary--xl" />
              <div style={{ marginTop: 14 }}>
                <DownloadMeta />
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="section section-warm">
          <div className="container">
            <div className="eyebrow">ATTRACT MODE</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              From long video to <em>paid submission</em>{" "}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6em", color: "var(--cyan)" }}>
                in 3 moves.
              </span>
            </h2>
            <p className="section-copy">
              No timeline. No render farm. No &quot;premium&quot; cloud editor pretending to be an app.
              Just the clipper workflow, modeled directly: drop, clip, post.
            </p>
            <div className="steps-grid">
              {steps.map((step) => (
                <article className="tile" key={step.num}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <Image src={step.icon} alt="" width={56} height={56} style={{ width: 56, height: 56 }} />
                    <div className="num">{step.num}</div>
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="product">
          <div className="container">
            <div className="eyebrow">POWER-UPS</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>Built around the actual hustle.</h2>
            <p className="section-copy">
              No fluff features. Every pickup maps to something a working clipper does
              between Sunday night and the next Whop payout window.
            </p>
            <div className="feature-grid" style={{ marginTop: 42 }}>
              {features.map((f) => (
                <article className="tile" key={f.title}>
                  <Image src={f.icon} alt="" width={56} height={56} style={{ width: 56, height: 56 }} />
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-dark">
          <div className="container">
            <div className="eyebrow">CLIPPER ROSTER</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              These clippers are already <em>in their bag.</em>
            </h2>
            <p className="section-copy">
              Real workflows. Names + stats representative of typical Whop Content Rewards
              earnings for clippers running Liquid Clips at full tilt.
            </p>
            <div className="feature-grid" style={{ marginTop: 42 }}>
              {stories.map((s) => (
                <article className="tile" key={s.name} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 18 }}>
                  <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--line-strong)", aspectRatio: "1 / 1", background: "var(--paper-warm)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Image
                      src={s.photo}
                      alt={`${s.name} — ${s.role}`}
                      width={240}
                      height={240}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                  <div>
                    <div className="plan-kicker">{s.role}</div>
                    <h3 style={{ marginTop: 4 }}>{s.name}</h3>
                    <p style={{ marginTop: 8 }}>&ldquo;{s.quote}&rdquo;</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-warm" id="pricing">
          <div className="container">
            <div className="eyebrow">CHARACTER SELECT</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Pick your player. <em>Level up later.</em>
            </h2>
            <p className="section-copy">
              Same engine in every tier. Power-ups stack: more accounts, hosted AI, clean
              exports, sub-accounts. Start free, upgrade when the brief demands it.
            </p>
            <div className="pricing-grid">
              {tiers.map((tier) => (
                <article className={`price-card ${tier.featured ? "featured" : ""}`} key={tier.name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <Image
                      src={tier.badge}
                      alt=""
                      width={48}
                      height={48}
                      style={{ imageRendering: "pixelated", width: 48, height: 48 }}
                    />
                    <div>
                      <div className="plan-kicker">{tier.kicker}</div>
                      <h3 style={{ margin: 0, fontSize: 22 }}>{tier.name}</h3>
                    </div>
                  </div>
                  <div className="price">
                    {tier.price} <span>/ mo</span>
                  </div>
                  <p style={{ margin: "8px 0 0", fontSize: 14 }}>{tier.body}</p>
                  <ul className="checks">
                    {tier.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <div style={{ marginTop: 32 }}>
              <a className="button-primary" href={`${accountUrl}/dashboard#plans`}>▸ Continue</a>
            </div>
          </div>
        </section>

        <section id="earn" className="section section-dark">
          <div className="container">
            <div className="eyebrow">EARN MODE</div>
            <h2 className="section-title" style={{ marginTop: 22 }}>
              Made for clippers who clip for <em>money.</em>
            </h2>
            <p className="section-copy">
              Whop Content Rewards are paid by the brands. Liquid Clips makes you faster
              at submitting more clips that fit the brief.
            </p>
            <div className="steps-grid" style={{ marginTop: 42 }}>
              <article className="tile">
                <div className="plan-kicker">BRIEF</div>
                <h3>Rules stay attached.</h3>
                <p>Payout, platforms, hashtags, source links — locked to each project so you submit clean every time.</p>
              </article>
              <article className="tile">
                <div className="plan-kicker">FIT SCORE</div>
                <h3>Know what hits.</h3>
                <p>Auto-check clip against the brief before you post. Catches the obvious DQs (length, watermark, hashtag).</p>
              </article>
              <article className="tile">
                <div className="plan-kicker">RECEIPTS</div>
                <h3>Keep the log.</h3>
                <p>Local record of every submission so you can prove which clip earned which payout when Whop is slow.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="download" className="section section-warm">
          <div className="container">
            <div className="download-panel">
              <div>
                <div className="plan-kicker">INSERT COIN</div>
                <h2 className="section-title">Press start.</h2>
                <p className="section-copy">
                  One click. Detects your Mac. Downloads the signed DMG. First boot installs
                  the local sidecar — give it a few seconds. Sign in to unlock your tier.
                </p>
              </div>
              <DownloadCTA variant="primary" />
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container" style={{ maxWidth: 720 }}>
            <div className="eyebrow">ARCADE OWNER</div>
            <p style={{ marginTop: 22, fontSize: 19, lineHeight: 1.6, color: "var(--ink)" }}>
              &ldquo;I built this because I was clipping podcasts to pay rent and Premiere
              couldn&apos;t keep up. Liquid Clips is the tool I wish I&apos;d had in week one.
              Drop a long video, get back something you can submit. No timeline. No render
              farm. No upsell wall.&rdquo;
            </p>
            <p
              style={{
                marginTop: 16,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-tertiary)",
              }}
            >
              — Daniel · arcade owner
            </p>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
