"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Props = {
  sessionId: string;
  clipCount: number;
  sourceTitle: string;
  sourceDuration: string;
  downloadHref: string | null;
  version: string | null;
};

const STEPS = [
  { label: "Download starts" },
  { label: "Drag to Applications" },
  { label: "Open Liquid Clips" },
  { label: "Your 10 clips appear" },
];

export function ClaimRoom({
  sessionId,
  clipCount,
  sourceTitle,
  sourceDuration,
  downloadHref,
  version,
}: Props) {
  const [downloadStartedAt, setDownloadStartedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  // Kick the DMG download immediately when the page loads. The user can
  // also click the button manually — we never want them to wonder where
  // it went.
  useEffect(() => {
    if (!downloadHref) return;
    const id = window.setTimeout(() => {
      window.location.href = downloadHref;
      setDownloadStartedAt(Date.now());
    }, 800);
    return () => window.clearTimeout(id);
  }, [downloadHref]);

  async function copySession() {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* fail-silent */
    }
  }

  const elapsedSec =
    downloadStartedAt === null ? 0 : Math.floor((Date.now() - downloadStartedAt) / 1000);

  return (
    <div className="lc-claim">
      <header className="lc-claim-head">
        <div className="lc-claim-eb">
          session {sessionId} · {sourceTitle} · {sourceDuration} · {clipCount} clips locked
        </div>
        <h1 className="lc-claim-h1">
          We&apos;ve started downloading the app. <em>Your clips are inside.</em>
        </h1>
        <p className="lc-claim-sub">
          Drag Liquid Clips to Applications. Open it once. Your clips will be there.
        </p>
      </header>

      <div className="lc-claim-row">
        <div className="lc-claim-actions">
          {downloadHref ? (
            <a
              className="lc-claim-cta"
              href={downloadHref}
              onClick={() => setDownloadStartedAt(Date.now())}
            >
              Restart the download
            </a>
          ) : (
            <span className="lc-claim-cta is-disabled">Preparing your build…</span>
          )}
          <button type="button" className="lc-claim-copy" onClick={copySession}>
            {copied ? "Session copied" : `Copy session · ${sessionId}`}
          </button>
          <span className="lc-claim-meta">
            {version ? `v${version} · ` : ""}Apple Developer ID notarised · Apple Silicon + Intel
          </span>
        </div>

        <ol className="lc-claim-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.label}
              className={`lc-claim-step ${i === 0 && downloadStartedAt !== null ? "is-active" : ""}`}
            >
              <span className="lc-claim-step-num">0{i + 1}</span>
              <span className="lc-claim-step-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="lc-claim-waiting">
        <div className="lc-claim-quote">
          <span className="lc-claim-quote-eb">in the workbench right now</span>
          <p>
            “I clip 12 long videos a week with this thing. The workbench is the moat.”
          </p>
          <span className="lc-claim-quote-attrib">— @uncledaniel · podcast clipper</span>
        </div>
        <div className="lc-claim-promise">
          <span className="lc-claim-promise-eb">what happens when the app opens</span>
          <ul>
            <li>Your 10 clips · already loaded.</li>
            <li>Viral scores + hook lines · ranked.</li>
            <li>One-tap export · watermarked free, 4K on Pro.</li>
            <li>Schedule to TikTok / Shorts / Reels / X · Pro.</li>
            <li>Submit to creator campaigns · paid per clip.</li>
          </ul>
        </div>
      </div>

      <footer className="lc-claim-foot">
        <span>
          Liquid Clips · 0.8.0-beta · the workbench for clippers · {elapsedSec > 0 ? `download ${elapsedSec}s` : "starting…"}
        </span>
        <Link href="/" className="lc-claim-foot-link">
          Find more clips →
        </Link>
      </footer>
    </div>
  );
}
