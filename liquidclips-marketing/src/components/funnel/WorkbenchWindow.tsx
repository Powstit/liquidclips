"use client";

import Image from "next/image";
import Link from "next/link";

/**
 * Window 4 · The Workbench.
 * Straight-on cockpit view · arrived. Fuchsia ONLY on the unlock.
 * Embeds a faithful dark-glass preview of the Liquid Clips workbench
 * (left-nav · clip queue · preview pane · export rail) using
 * inherited W1 tokens. Swap with the real cockpit-html later by
 * replacing <AppPreview/>.
 */

const NAV_ITEMS = [
  { label: "Home", glyph: "▶" },
  { label: "Create", glyph: "+" },
  { label: "Engine", glyph: "▣" },
  { label: "Studio", glyph: "✂" },
  { label: "Thumbs", glyph: "▦" },
  { label: "Export", glyph: "⬆" },
  { label: "Campaigns", glyph: "★", pill: "12" },
  { label: "Earn", glyph: "$" },
  { label: "Library", glyph: "▤", pill: "18" },
];

const CLIP_ROWS = [
  { idx: "01", title: "The 12-second hook nobody's using.", score: 94, dur: "00:38" },
  { idx: "02", title: "Why your first 3 seconds always die.", score: 91, dur: "00:42" },
  { idx: "03", title: "He answered the question they never asked.", score: 88, dur: "00:51" },
  { idx: "04", title: "The replay line.", score: 86, dur: "00:29" },
  { idx: "05", title: "90 seconds, then the silence.", score: 84, dur: "01:32" },
];

export function WorkbenchWindow() {
  return (
    <section className="lc-w4" aria-labelledby="lc-w4-h">
      <div className="lc-w4-head">
        <span className="lc-w4-eb">
          <span className="lc-w4-eb-dot" /> THE WORKBENCH
        </span>
        <h2 id="lc-w4-h" className="lc-w4-h2">
          Your clips are ready. <em>Download</em> to open them.
        </h2>
        <p className="lc-w4-sub">
          Open the workbench — your session loads exactly here.
        </p>
      </div>

      <div className="lc-w4-frame">
        <span className="lc-w4-bracket lc-w4-bracket--tl" aria-hidden="true" />
        <span className="lc-w4-bracket lc-w4-bracket--tr" aria-hidden="true" />
        <span className="lc-w4-bracket lc-w4-bracket--bl" aria-hidden="true" />
        <span className="lc-w4-bracket lc-w4-bracket--br" aria-hidden="true" />

        {/* Window title bar · macOS-like + console label */}
        <div className="lc-w4-titlebar">
          <span className="lc-w4-traffic" aria-hidden="true">
            <span /><span /><span />
          </span>
          <span className="lc-w4-titlebar-label">liquid/clips · session is loaded</span>
          <span className="lc-w4-titlebar-version">v0.7.80</span>
        </div>

        {/* App preview · 3 columns */}
        <div className="lc-w4-app">
          <nav className="lc-w4-nav" aria-hidden="true">
            <div className="lc-w4-nav-mark">liquid/clips</div>
            <div className="lc-w4-nav-section">CONSOLE</div>
            <ul className="lc-w4-nav-list">
              {NAV_ITEMS.map((n, i) => (
                <li key={n.label} className={i === 1 ? "is-active" : ""}>
                  <span className="lc-w4-nav-glyph">{n.glyph}</span>
                  <span className="lc-w4-nav-label">{n.label}</span>
                  {n.pill && <span className="lc-w4-nav-pill">{n.pill}</span>}
                </li>
              ))}
            </ul>
          </nav>

          <div className="lc-w4-center">
            <div className="lc-w4-center-eb">CLIP QUEUE · 10 READY</div>
            <h3 className="lc-w4-center-h">Pick a clip to preview.</h3>
            <ul className="lc-w4-queue">
              {CLIP_ROWS.map((c, i) => (
                <li key={c.idx} className={i === 0 ? "is-selected" : ""}>
                  <span className="lc-w4-queue-num">{c.idx}</span>
                  <div className="lc-w4-queue-mid">
                    <span className="lc-w4-queue-title">{c.title}</span>
                    <span className="lc-w4-queue-dur">{c.dur}</span>
                  </div>
                  <span className="lc-w4-queue-score">{c.score}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lc-w4-right">
            <div className="lc-w4-preview" aria-hidden="true">
              <div className="lc-w4-preview-screen">
                <Image
                  src="/cinematic/cabinet-demo-frame.png"
                  alt=""
                  width={420}
                  height={748}
                  className="lc-w4-preview-frame-img"
                />
                <div className="lc-w4-preview-caption">
                  “THE 12-SECOND HOOK NOBODY'S USING.”
                </div>
              </div>
              <div className="lc-w4-preview-meta">
                <span>9:16</span>
                <span>FRAME · 00:00:14 / 00:00:38</span>
                <span>SCORE 94</span>
              </div>
            </div>

            <div className="lc-w4-rail">
              <span className="lc-w4-rail-eb">EXPORT TARGETS</span>
              <ul className="lc-w4-rail-list">
                <li>TikTok</li>
                <li>Shorts</li>
                <li>Reels</li>
                <li>X</li>
              </ul>
              <span className="lc-w4-rail-eb">PRESETS</span>
              <ul className="lc-w4-rail-list">
                <li>9:16 · vertical</li>
                <li>1:1 · square</li>
                <li>16:9 · landscape</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer rail of the embedded window */}
        <div className="lc-w4-footrail">
          <span>session · loaded from Liquid Clips</span>
          <span>kade · standing by</span>
          <span>10 clips · 4 mins of footage selected</span>
        </div>
      </div>

      {/* Unlock CTA · fuchsia · the ONLY action here */}
      <div className="lc-w4-cta-row">
        <Link href="/download" className="lc-w4-cta lc-btn lc-btn--primary">
          <span className="lc-w4-cta-glyph" aria-hidden="true">▾</span>
          <span>Download to Open Your Clips</span>
        </Link>
        <span className="lc-w4-cta-sub">macOS · Apple Developer ID notarised</span>
      </div>
    </section>
  );
}
