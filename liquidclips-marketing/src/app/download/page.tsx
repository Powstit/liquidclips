import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { downloadUrl, supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download Liquid Clips",
  description:
    "Download the Liquid Clips Mac app. Universal Apple Silicon + Intel DMG, notarized by Apple.",
};

const steps = [
  {
    num: "01",
    title: "Download the DMG.",
    body: "Universal macOS build, signed and notarized. Works on Apple Silicon and Intel.",
  },
  {
    num: "02",
    title: "Drag Liquid Clips to Applications.",
    body: "Open the DMG and drop the app icon into the Applications folder.",
  },
  {
    num: "03",
    title: "Launch and sign in.",
    body: "First boot installs the Python sidecar locally — give it a few seconds. Sign in with your account email to unlock your plan.",
  },
];

const requirements = [
  { label: "macOS", value: "13 Ventura or later" },
  { label: "Chip", value: "Apple Silicon or Intel" },
  { label: "Memory", value: "8 GB minimum, 16 GB recommended" },
  { label: "Disk", value: "~2 GB after install (models + ffmpeg bundled)" },
];

export default function DownloadPage() {
  return (
    <PageShell>
      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <div className="eyebrow">Mac download</div>
              <h1>
                Get Liquid Clips. <em>Run it locally.</em>
              </h1>
              <p className="hero-copy">
                Universal macOS DMG, notarized by Apple. Your videos, transcripts, and exports
                stay on your machine for local-tier workflows. No browser tab editor pretending
                to be an app.
              </p>
              <div className="hero-actions">
                <a className="button-primary" href={downloadUrl}>
                  Download for Mac
                </a>
                <Link className="button-secondary" href="/#pricing">
                  See pricing
                </Link>
              </div>
              <p className="microcopy">
                The button always points at the latest published release.
              </p>
            </div>

            <div className="hero-media" aria-label="Mac install card">
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                  padding: 28,
                  height: "100%",
                  background:
                    "linear-gradient(160deg, rgba(255,26,140,0.12) 0%, rgba(11,11,16,0.95) 60%)",
                  color: "var(--paper)",
                  borderRadius: "inherit",
                }}
              >
                <div className="plan-kicker">System requirements</div>
                <ul style={{ display: "grid", gap: 10, fontSize: 14, lineHeight: 1.5 }}>
                  {requirements.map((r) => (
                    <li
                      key={r.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 16,
                        borderBottom: "1px solid rgba(244,241,234,0.12)",
                        paddingBottom: 8,
                      }}
                    >
                      <span style={{ opacity: 0.65 }}>{r.label}</span>
                      <span style={{ textAlign: "right" }}>{r.value}</span>
                    </li>
                  ))}
                </ul>
                <div className="media-rail" style={{ marginTop: "auto" }}>
                  <div className="media-pill">notarized</div>
                  <div className="media-pill">universal</div>
                  <div className="media-pill">local-first</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-warm">
          <div className="container">
            <h2 className="section-title">
              Install in <em>three moves.</em>
            </h2>
            <p className="section-copy">
              First launch installs the local Python sidecar. After that, opens in under a second.
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

        <section className="section">
          <div className="container">
            <h2 className="section-title">First-launch warning?</h2>
            <p className="section-copy">
              If Gatekeeper says the app can&apos;t be opened, right-click Liquid Clips in
              Applications and choose <strong>Open</strong>, then confirm. The build is signed
              with a Developer ID certificate and notarized by Apple — the prompt only appears
              on the very first launch from the DMG.
            </p>
            <div className="feature-grid">
              <article className="tile">
                <h3>Auto-update built in</h3>
                <p>
                  Future releases install in place from the app. You only need to download the
                  DMG once.
                </p>
              </article>
              <article className="tile">
                <h3>Local processing</h3>
                <p>
                  Faster-whisper, ffmpeg, and the clip engine run on your machine. Hosted AI is
                  opt-in on the Pro and Agency tiers.
                </p>
              </article>
              <article className="tile">
                <h3>Need a hand?</h3>
                <p>
                  Visit the <Link href="/help/troubleshooting">troubleshooting guide</Link> or
                  email <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="section section-warm">
          <div className="container">
            <div className="download-panel">
              <div>
                <div className="plan-kicker">Ready when you are</div>
                <h2 className="section-title">Download the Mac app.</h2>
                <p className="section-copy">
                  Free includes 100 clip exports. No card, no trial timer.
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
