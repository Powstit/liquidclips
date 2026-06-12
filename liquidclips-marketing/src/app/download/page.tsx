import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { DownloadCTA, DownloadMeta } from "@/components/DownloadCTA";
import { supportEmail } from "@/lib/site";
import { getLatestRelease } from "@/lib/latest-release";

export const metadata: Metadata = {
  title: "Download Liquid Clips",
  description:
    "Download the Liquid Clips Mac app. Apple Silicon DMG, notarized by Apple.",
};

// v0.7.56 — six-step install path. Each step is one action a cold Mac
// user takes in order, with the macOS Gatekeeper prompt as its own
// step (5) so it doesn't surprise anyone. Helper notes (architecture
// glossary, manual link, older releases) live in `installHelpers`
// below so the action steps stay clean and scannable.
const steps = [
  {
    num: "01",
    title: "Download the correct version.",
    body: "Apple Silicon for M1/M2/M3/M4. Intel for older Intel Macs. Not sure which? See the chooser above.",
  },
  {
    num: "02",
    title: "Open the DMG.",
    body: "Double-click the file you just downloaded. A small install window opens.",
  },
  {
    num: "03",
    title: "Drag Liquid Clips into Applications.",
    body: "In the install window, drag the Liquid Clips icon onto the Applications folder shortcut.",
  },
  {
    num: "04",
    title: "Open Liquid Clips from Applications.",
    body: "Open Finder → Applications → double-click Liquid Clips. (Launching from Downloads is fine too.)",
  },
  {
    num: "05",
    title: "If macOS shows a security prompt, click Open.",
    body: "First launch only. The app is signed with a Developer ID and notarised by Apple — Gatekeeper just wants you to confirm.",
  },
  {
    num: "06",
    title: "Sign in and create your first clip.",
    body: "Use the account email you signed up with. Drop a video, pick the highlights you want, export. You're in.",
  },
];

const installHelpers = [
  { label: "Apple Silicon", value: "M1 / M2 / M3 / M4" },
  { label: "Intel Mac", value: "Older Intel processor" },
  { label: "Not sure?", value: "Apple menu → About This Mac" },
  { label: "Download didn't start?", value: "Use the manual link under the button" },
  { label: "Older version?", value: "View all releases on GitHub" },
];

const requirements = [
  { label: "macOS", value: "13 Ventura or later" },
  { label: "Chip", value: "Apple Silicon" },
  { label: "Memory", value: "8 GB minimum, 16 GB recommended" },
  { label: "Disk", value: "~2 GB after install (models + ffmpeg bundled)" },
];

export default async function DownloadPage() {
  // Fetch the latest GH release server-side. ISR-cached for 10 min.
  // If fetch fails, latest is null and DownloadCTA falls back to env vars.
  const latest = await getLatestRelease();
  const artifacts = latest
    ? {
        macArm: latest.macArm ?? undefined,
        macIntel: latest.macIntel ?? undefined,
        macUniversal: latest.macUniversal ?? undefined,
      }
    : undefined;
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
                Apple Silicon macOS DMG, notarized by Apple. Your videos, transcripts, and exports
                stay on your machine for local-tier workflows. No browser tab editor pretending
                to be an app.
              </p>
              <div className="hero-actions">
                <DownloadCTA variant="primary" artifacts={artifacts} version={latest?.version} />
                <Link className="button-secondary" href="/#pricing">
                  See pricing
                </Link>
              </div>
              <DownloadMeta version={latest?.version} />
              <a href="#install" className="hero-install-anchor">
                How to install →
              </a>
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
                  color: "var(--ink)",
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
                  <div className="media-pill">Apple Silicon</div>
                  <div className="media-pill">local-first</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="install" className="section section-warm">
          <div className="container">
            <div className="eyebrow">Install</div>
            <h2 className="section-title">
              From DMG to first clip in <em>six steps.</em>
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

            <ul className="install-helpers" aria-label="Helpful pointers">
              {installHelpers.map((h) => (
                <li key={h.label}>
                  <span className="install-helpers__label">{h.label}</span>
                  <span className="install-helpers__value">{h.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section">
          <div className="container">
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
              <DownloadCTA variant="primary" artifacts={artifacts} version={latest?.version} />
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  );
}
