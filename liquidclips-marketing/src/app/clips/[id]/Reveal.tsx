"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ClipEvidence } from "@/lib/fixtureClips";

type Props = {
  sessionId: string;
  sourceTitle: string;
  sourceDuration: string;
  clips: ClipEvidence[];
  downloadHref: string;
  version: string | null;
};

const SESSION_COOKIE = "lc_session";

export function Reveal({
  sessionId,
  sourceTitle,
  sourceDuration,
  clips,
  downloadHref,
  version,
}: Props) {
  // Persist sessionId in a cookie so we can recognize returning visitors
  // even if they close the tab. The download page reads from the URL param
  // directly · this is the recovery path.
  useEffect(() => {
    document.cookie = `${SESSION_COOKIE}=${sessionId};path=/;max-age=${60 * 60 * 24 * 30};samesite=lax`;
  }, [sessionId]);

  // Card-click → smooth-scroll to the download CTA + flash the bar.
  const [flash, setFlash] = useState(0);
  function pulseCta(reason: string) {
    setFlash((n) => n + 1);
    if (typeof window !== "undefined") {
      window.location.hash = "claim";
      // analytics hook · replace with real telemetry when wired
      console.log("[reveal] cta pulse", { reason, sessionId });
    }
  }

  return (
    <div className="lc-reveal">
      <header className="lc-reveal-head">
        <div className="lc-reveal-eb">
          session {sessionId} · {sourceTitle} · {sourceDuration} · 10 clips found
        </div>
        <h1 className="lc-reveal-h1">Your 10 clips are ready.</h1>
        <p className="lc-reveal-sub">
          Open Liquid Clips to watch and export them. They&apos;re locked to this session.
        </p>
      </header>

      <ol className="lc-reveal-grid" aria-label="Locked clip evidence">
        {clips.map((c) => (
          <li key={c.id} className="lc-reveal-card-wrap">
            <button
              type="button"
              className="lc-reveal-card"
              onClick={() => pulseCta(`card-${c.id}`)}
              aria-label={`Open clip ${c.index} in the app · ${c.title}`}
            >
              <div
                className="lc-reveal-thumb"
                style={{ ['--thumb-hue' as string]: `${c.thumbHue}deg` }}
              >
                <div className="lc-reveal-thumb-lock" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path
                      d="M7 10V8a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 12.5v6A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10H7zm2 0h6V8a3 3 0 1 0-6 0v2z"
                      fill="currentColor"
                    />
                  </svg>
                </div>
                <span className="lc-reveal-thumb-num">{c.index < 10 ? `0${c.index}` : c.index}</span>
                <span className="lc-reveal-thumb-dur">{c.duration}</span>
              </div>

              <div className="lc-reveal-meta">
                <div className="lc-reveal-meta-row">
                  <span className="lc-reveal-score" aria-label={`viral score ${c.viralScore}`}>
                    {c.viralScore}
                  </span>
                  <span className="lc-reveal-reach">{c.estimatedReach}</span>
                </div>
                <h3 className="lc-reveal-title">{c.title}</h3>
                <p className="lc-reveal-hook">“{c.hookLine}”</p>
                <span className="lc-reveal-open">Open in app →</span>
              </div>
            </button>
          </li>
        ))}
      </ol>

      <div id="claim" className={`lc-reveal-cta ${flash > 0 ? "is-pulse" : ""}`} key={flash}>
        <div className="lc-reveal-cta-inner">
          <div className="lc-reveal-cta-copy">
            <span className="lc-reveal-cta-eb">claim your clips</span>
            <h2 className="lc-reveal-cta-h2">Open Liquid Clips · your 10 clips will be waiting.</h2>
            <p className="lc-reveal-cta-sub">
              No sign-up. No setup. Your session opens automatically.
            </p>
          </div>
          <div className="lc-reveal-cta-actions">
            <a
              href={`/download?session=${sessionId}`}
              className="lc-reveal-cta-button"
              data-variant="primary"
            >
              Open my 10 clips →
            </a>
            <Link className="lc-reveal-cta-alt" href={`/download?session=${sessionId}&email=1`}>
              Email me the link instead
            </Link>
            {version && (
              <span className="lc-reveal-cta-version">v{version} · Apple Developer ID notarised</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
