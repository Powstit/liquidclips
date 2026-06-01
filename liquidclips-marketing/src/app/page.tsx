import Image from "next/image";
import { PageShell } from "@/components/Chrome";
import { accountUrl, appUrl, downloadUrl } from "@/lib/site";

const steps = [
  {
    num: "01",
    title: "Drop in a recording.",
    body: "Use a local file or a video URL. Liquid Clips keeps source files and generated clips on your machine.",
  },
  {
    num: "02",
    title: "Generate short clips.",
    body: "Find strong moments, add captions, reframe for each platform, and prepare YouTube metadata without opening a timeline.",
  },
  {
    num: "03",
    title: "Publish, schedule, or submit.",
    body: "Send clips to social accounts through Ayrshare, queue content, or prepare a Whop Content Rewards submission.",
  },
];

const features = [
  {
    title: "Local-first editing",
    body: "Free and Solo run with your own OpenAI key and local processing. Your videos, transcripts, and exports stay on the device for local-tier workflows.",
  },
  {
    title: "Hosted AI for Pro+",
    body: "Pro and Agency are designed for no-key setup through the hosted Liquid Clips LLM proxy once the backend gate is live.",
  },
  {
    title: "Whop reward workspace",
    body: "Browse rewards, keep briefs attached to projects, score fit, prepare submissions, and track Whop outcomes without losing context.",
  },
  {
    title: "Social publishing",
    body: "Connect an Ayrshare Profile Key and publish to the platforms attached to that profile, with scheduling and drip workflows in the desktop app.",
  },
];

const plans = [
  {
    name: "Free",
    price: "$0",
    kicker: "100 exports",
    body: "Try the workflow with your own key.",
    features: ["100 clip exports", "Local processing", "Watermarked exports", "Manual posting"],
  },
  {
    name: "Solo",
    price: "$29.99",
    kicker: "one creator",
    body: "Unlimited clips for a single creator.",
    features: ["Unlimited clip exports", "5 social accounts", "BYO AI key", "Local-first processing"],
  },
  {
    name: "Pro",
    price: "$79",
    kicker: "hosted AI",
    body: "For creators who want hosted model access and publishing power.",
    features: ["10 social accounts", "Hosted LLM planned", "Multi-platform publishing", "Scheduling workflows"],
    featured: true,
  },
  {
    name: "Agency",
    price: "$149",
    kicker: "client teams",
    body: "For operators managing client accounts.",
    features: ["25 social accounts", "Client sub-accounts planned", "White-label exports planned", "Priority support planned"],
  },
];

export default function Home() {
  return (
    <PageShell>
      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="eyebrow">Public launch build</div>
              <h1>
                Your AI editor. <em>Lives on your computer.</em>
              </h1>
              <p className="hero-copy">
                Liquid Clips turns long recordings and Whop Content Rewards into captioned,
                ready-to-post clips. It is built for creators who want speed without handing
                every file to a cloud editor.
              </p>
              <div className="hero-actions">
                <a className="button-primary" href={downloadUrl}>
                  Download for Mac
                </a>
                <a className="button-secondary" href={appUrl}>
                  Try the account app
                </a>
              </div>
              <p className="microcopy">
                Universal macOS DMG. Notarized release link turns on after the CI artifact lands.
              </p>
            </div>

            <div className="hero-media" aria-label="Liquid Clips editing workspace preview">
              <Image
                src="/img/clipper-editing.jpg"
                alt="Creator editing short-form clips on a laptop"
                width={1100}
                height={1300}
                priority
              />
              <div className="media-overlay">
                <div>
                  <div className="plan-kicker">Liquid Clips workflow</div>
                  <h2 className="mt-2 font-display text-[30px] font-semibold leading-tight">
                    Record once. Cut the week.
                  </h2>
                </div>
                <div className="media-rail">
                  <div className="media-pill">captions</div>
                  <div className="media-pill">publish</div>
                  <div className="media-pill">earn</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="section section-warm">
          <div className="container">
            <h2 className="section-title">
              From long video to short-form output in <em>three moves.</em>
            </h2>
            <p className="section-copy">
              The app is built around repeated creator work: import, generate, review, export,
              then publish or submit. No landing-page magic trick - just the actual workflow.
            </p>
            <div className="steps-grid">
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

        <section className="section" id="product">
          <div className="container">
            <h2 className="section-title">Built for the work after the clip is found.</h2>
            <p className="section-copy">
              Liquid Clips is not just a moment picker. It carries the project through metadata,
              reward briefs, publishing status, and local files.
            </p>
            <div className="product-strip">
              <div className="product-shot">
                <Image
                  src="/img/clipper-win.jpg"
                  alt="Creator celebrating after preparing clips"
                  width={900}
                  height={680}
                />
              </div>
              <div className="feature-grid">
                {features.map((feature) => (
                  <article className="tile" key={feature.title}>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="earn" className="section section-dark">
          <div className="container">
            <h2 className="section-title">
              Made for creators who clip for <em>money.</em>
            </h2>
            <p className="section-copy">
              Whop Content Rewards are handled by Whop and the campaign brands. Liquid Clips
              helps you read the brief, create stronger clips, prepare the post, and keep a
              local record of what you submitted.
            </p>
            <div className="steps-grid">
              <article className="tile">
                <div className="plan-kicker">Reward brief</div>
                <h3>Rules stay attached.</h3>
                <p>Keep payout, allowed platforms, source links, and campaign instructions near the clips.</p>
              </article>
              <article className="tile">
                <div className="plan-kicker">Fit scoring</div>
                <h3>Know what to submit.</h3>
                <p>Use reward-aware checks as guidance before you post. The brand still decides approval.</p>
              </article>
              <article className="tile">
                <div className="plan-kicker">Affiliate flywheel</div>
                <h3>Earn on referrals.</h3>
                <p>Paid customers can qualify for recurring affiliate commission through the partner program.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="pricing" className="section section-warm">
          <div className="container">
            <h2 className="section-title">Four launch tiers. Clear upgrade path.</h2>
            <p className="section-copy">
              Free and Solo are local-first. Pro and Agency are where hosted AI and team workflows
              become the paid value prop.
            </p>
            <div className="pricing-grid">
              {plans.map((plan) => (
                <article className={`price-card ${plan.featured ? "featured" : ""}`} key={plan.name}>
                  <div className="plan-kicker">{plan.kicker}</div>
                  <h3>{plan.name}</h3>
                  <div className="price">
                    {plan.price}
                    {plan.price !== "$0" && <span> / month</span>}
                  </div>
                  <p>{plan.body}</p>
                  <ul className="checks">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            <div className="mt-8">
              <a className="button-primary" href={`${accountUrl}/dashboard#plans`}>
                Open account pricing
              </a>
            </div>
          </div>
        </section>

        <section id="trust" className="section">
          <div className="container">
            <h2 className="section-title">Privacy promises based on the actual code path.</h2>
            <p className="section-copy">
              Local files stay local for local-tier workflows. Analytics use internal IDs and
              funnel events, not video names, file paths, transcripts, raw emails, tokens, or API keys.
            </p>
            <div className="feature-grid">
              <article className="tile">
                <h3>Local-first by default</h3>
                <p>Desktop projects live under the user&apos;s Liquid Clips folder and the OS keychain stores sensitive local credentials.</p>
              </article>
              <article className="tile">
                <h3>Clear processors</h3>
                <p>Clerk handles sign-in, Stripe/Whop handle billing, PostHog handles product analytics, Ayrshare handles social posting, and Railway/Vercel host services.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="download" className="section section-warm">
          <div className="container">
            <div className="download-panel">
              <div>
                <div className="plan-kicker">Download</div>
                <h2 className="section-title">Get the public Mac build.</h2>
                <p className="section-copy">
                  The download button points at the latest release until the notarized DMG URL is set
                  in Vercel as <code>NEXT_PUBLIC_DOWNLOAD_DMG_URL</code>.
                </p>
              </div>
              <a className="button-primary" href={downloadUrl}>
                Download DMG
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
