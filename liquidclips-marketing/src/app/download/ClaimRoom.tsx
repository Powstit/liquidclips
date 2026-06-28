"use client";

import { useState } from "react";
import Link from "next/link";
import { DownloadCTA } from "@/components/DownloadCTA";

type Props = {
  sessionId: string;
  clipCount: number;
  sourceTitle: string;
  sourceDuration: string;
  artifacts?: {
    macArm?: string;
    macIntel?: string;
    macUniversal?: string;
  };
  version: string | null;
};

const STEPS = [
  { label: "Choose your Mac build" },
  { label: "Drag to Applications" },
  { label: "Open Liquid Clips" },
  { label: "Your 10 clips appear" },
];

export function ClaimRoom({
  sessionId,
  clipCount,
  sourceTitle,
  sourceDuration,
  artifacts,
  version,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function copySession() {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* fail-silent */
    }
  }

  return (
    <div className="lc-claim">
      <header className="lc-claim-head">
        <div className="lc-claim-eb">
          session {sessionId} · {sourceTitle} · {sourceDuration} · {clipCount} clips locked
        </div>
        <h1 className="lc-claim-h1">
          Your clips are ready. <em>Choose the right Mac build.</em>
        </h1>
        <p className="lc-claim-sub">
          Download Liquid Clips, drag it to Applications, then open it. Your session follows you into the app.
        </p>
      </header>

      <div className="lc-claim-row">
        <div className="lc-claim-actions">
          <DownloadCTA
            variant="primary"
            artifacts={artifacts}
            version={version ?? undefined}
          />
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
              className="lc-claim-step"
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
            <li>Set assisted posting reminders for TikTok, Shorts, Reels, and X.</li>
            <li>Submit to creator campaigns · paid per clip.</li>
          </ul>
        </div>
      </div>

      <footer className="lc-claim-foot">
        <span>
          Liquid Clips{version ? ` · v${version}` : ""} · the workbench for clippers
        </span>
        <Link href="/" className="lc-claim-foot-link">
          Find more clips →
        </Link>
      </footer>
    </div>
  );
}
