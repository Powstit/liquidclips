/**
 * ClaimScreen · the first thing a funnel-handed-off user sees on launch.
 *
 * The user pasted a URL on liquidclips.app, watched 10 evidence cards land,
 * clicked Open My 10 Clips, downloaded the app, and just launched it. We
 * recognise the session id (URL param · localStorage · clipboard) and fetch
 * the same 10 evidence cards from the marketing API.
 *
 * No login. No setup. No tour. Just: "Your 10 clips are here."
 */

import { useEffect, useState } from "react";
import {
  fetchFunnelSession,
  persistSessionId,
  clearFunnelSession,
  type FunnelSession,
} from "../../lib/funnelSession";
import { openInApp } from "../../lib/openInApp";
import "./ClaimScreen.css";

type Props = {
  sessionId: string;
  onEnterWorkbench: () => void;
  onAbandon: () => void;
};

export function ClaimScreen({ sessionId, onEnterWorkbench, onAbandon }: Props) {
  const [session, setSession] = useState<FunnelSession | null>(null);
  const [status, setStatus] = useState<"resolving" | "ready" | "failed">("resolving");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    persistSessionId(sessionId);
    setStatus("resolving");
    void fetchFunnelSession(sessionId).then((data) => {
      if (cancelled) return;
      if (data) {
        setSession(data);
        setStatus("ready");
      } else {
        setStatus("failed");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="lc-claim-screen-shell">
      <div className="lc-claim-screen-haze" aria-hidden="true" />
      <div className="lc-claim-screen">
        <header className="lc-claim-screen-head">
          <span className="lc-claim-screen-eb">
            session {sessionId}
            {session ? ` · ${session.sourceTitle} · ${session.sourceDuration}` : ""}
          </span>
          <h1 className="lc-claim-screen-h1">
            Your 10 clips are <em>here</em>.
          </h1>
          <p className="lc-claim-screen-sub">
            {status === "resolving" && "Resolving your session…"}
            {status === "ready" && "Pick one. Kade will tell you why he picked it."}
            {status === "failed" && (
              <>
                We couldn&apos;t find session <strong>{sessionId}</strong>. Open the workbench
                anyway, or paste a new URL on{" "}
                <a
                  href="https://liquidclips.app"
                  onClick={(event) => {
                    event.preventDefault();
                    void openInApp("https://liquidclips.app", { intent: "read-only" });
                  }}
                >
                  liquidclips.app
                </a>
                .
              </>
            )}
          </p>
        </header>

        {status === "ready" && session && (
          <>
            <ol className="lc-claim-screen-grid" aria-label="Your 10 clips">
              {session.clips.map((c) => (
                <li key={c.id} className="lc-claim-screen-card-wrap">
                  <button
                    type="button"
                    className={`lc-claim-screen-card ${activeIdx === c.index ? "is-active" : ""}`}
                    onClick={() => setActiveIdx(c.index)}
                  >
                    <div
                      className="lc-claim-screen-thumb"
                      style={{ ['--thumb-hue' as string]: `${c.thumbHue}deg` }}
                    >
                      <div className="lc-claim-screen-thumb-play" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                          <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
                        </svg>
                      </div>
                      <span className="lc-claim-screen-thumb-num">
                        {c.index < 10 ? `0${c.index}` : c.index}
                      </span>
                      <span className="lc-claim-screen-thumb-dur">{c.duration}</span>
                    </div>
                    <div className="lc-claim-screen-meta">
                      <div className="lc-claim-screen-meta-row">
                        <span className="lc-claim-screen-score">{c.viralScore}</span>
                        <span className="lc-claim-screen-reach">{c.estimatedReach}</span>
                      </div>
                      <h3 className="lc-claim-screen-title">{c.title}</h3>
                      <p className="lc-claim-screen-hook">“{c.hookLine}”</p>
                    </div>
                  </button>
                </li>
              ))}
            </ol>

            <div className="lc-claim-screen-cta-row">
              <button
                type="button"
                className="lc-claim-screen-cta"
                onClick={() => {
                  clearFunnelSession();
                  onEnterWorkbench();
                }}
              >
                Enter the workbench →
              </button>
              <button
                type="button"
                className="lc-claim-screen-alt"
                onClick={() => {
                  clearFunnelSession();
                  onAbandon();
                }}
              >
                Not now
              </button>
            </div>

            {activeIdx !== null && (
              <aside className="lc-claim-screen-kade" role="note">
                <span className="lc-claim-screen-kade-eb">Kade · why he picked this</span>
                <p>
                  {session.clips.find((c) => c.index === activeIdx)?.transcriptWindow}
                </p>
              </aside>
            )}
          </>
        )}

        {status === "failed" && (
          <div className="lc-claim-screen-fail">
            <button type="button" className="lc-claim-screen-cta" onClick={onAbandon}>
              Open the workbench
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
