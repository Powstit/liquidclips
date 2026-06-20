"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  sessionId: string;
  sourceTitle: string;
  sourceDuration: string;
  transcriptLines: string[];
};

type Phase = {
  key: "ingest" | "listen" | "read" | "score" | "compose";
  label: string;
  ticker: string;
  duration: number; // ms
};

const PHASES: Phase[] = [
  { key: "ingest",  label: "Fetching footage",     ticker: "Pulling 9:43 from the source.",                 duration: 6_000  },
  { key: "listen",  label: "Listening",            ticker: "Transcribing the room.",                        duration: 16_000 },
  { key: "read",    label: "Reading for hooks",    ticker: "Looking for openers, payoffs, and replays.",    duration: 8_000  },
  { key: "score",   label: "Scoring 10 moments",   ticker: "Ranking against the last 30 days of viral.",    duration: 6_000  },
  { key: "compose", label: "Cutting + reframing",  ticker: "Composing the workbench. Almost done.",         duration: 9_000  },
];

const TOTAL_MS = PHASES.reduce((sum, p) => sum + p.duration, 0);

const TICKER_LINES = [
  "Kade is watching with you.",
  "Pulled the moment at 03:42 — high reaction density.",
  "That's a hook line.",
  "Scoring against the last 30 days of viral clips.",
  "Locked the opener. The next 9 seconds promise a payoff.",
  "Tagged a quotable. The room knew exactly what he meant.",
];

export function AnalysisTheatre({ sessionId, sourceTitle, sourceDuration, transcriptLines }: Props) {
  const router = useRouter();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tickerIdx, setTickerIdx] = useState(0);
  const startedAt = useRef<number | null>(null);

  // Drive the progress ring + phase transitions with a single rAF loop.
  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (startedAt.current === null) startedAt.current = now;
      const t = now - startedAt.current;
      setElapsedMs(Math.min(t, TOTAL_MS));
      if (t < TOTAL_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        // Hand off to the reveal.
        router.replace(`/clips/${sessionId}`);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [router, sessionId]);

  // Rotate the ticker every 4 s.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTickerIdx((i) => (i + 1) % TICKER_LINES.length);
    }, 4_000);
    return () => window.clearInterval(id);
  }, []);

  // Resolve the active phase from elapsed.
  let cumulative = 0;
  let activePhaseIdx = 0;
  for (let i = 0; i < PHASES.length; i++) {
    cumulative += PHASES[i].duration;
    if (elapsedMs < cumulative) {
      activePhaseIdx = i;
      break;
    }
    activePhaseIdx = i;
  }
  const progress = Math.min(1, elapsedMs / TOTAL_MS);

  // Transcript drips on phase 2 (listen).
  const listenPhaseStart = PHASES.slice(0, 1).reduce((s, p) => s + p.duration, 0);
  const listenPhaseEnd   = listenPhaseStart + PHASES[1].duration;
  const transcriptProgress =
    elapsedMs < listenPhaseStart
      ? 0
      : elapsedMs >= listenPhaseEnd
      ? 1
      : (elapsedMs - listenPhaseStart) / PHASES[1].duration;
  const visibleLines = Math.max(1, Math.floor(transcriptProgress * transcriptLines.length));

  // Score gauges fill on phase 4 (score).
  const scoreStart = PHASES.slice(0, 3).reduce((s, p) => s + p.duration, 0);
  const scoreEnd   = scoreStart + PHASES[3].duration;
  const scoreProgress =
    elapsedMs < scoreStart
      ? 0
      : elapsedMs >= scoreEnd
      ? 1
      : (elapsedMs - scoreStart) / PHASES[3].duration;
  const gaugesLit = Math.floor(scoreProgress * 10);

  const ringCircumference = 2 * Math.PI * 70;
  const ringDash = ringCircumference * (1 - progress);

  return (
    <div className="lc-stage">
      {/* Top eyebrow with the URL the user committed to */}
      <div className="lc-stage-top">
        <span className="lc-stage-eb">session {sessionId} · {sourceTitle} · {sourceDuration}</span>
      </div>

      {/* Centre · progress ring + active phase label */}
      <div className="lc-stage-centre">
        <div className="lc-stage-ring-wrap">
          <svg className="lc-stage-ring" viewBox="0 0 160 160" aria-hidden="true">
            <circle cx="80" cy="80" r="70" className="lc-stage-ring-track" />
            <circle
              cx="80" cy="80" r="70"
              className="lc-stage-ring-fill"
              strokeDasharray={ringCircumference}
              strokeDashoffset={ringDash}
            />
          </svg>
          <div className="lc-stage-ring-pct">{Math.round(progress * 100)}<span>%</span></div>
        </div>

        <div className="lc-stage-phase">
          <span className="lc-stage-phase-num">PHASE {activePhaseIdx + 1} / 5</span>
          <h1 className="lc-stage-phase-label">{PHASES[activePhaseIdx].label}.</h1>
          <p className="lc-stage-phase-ticker">{PHASES[activePhaseIdx].ticker}</p>
        </div>
      </div>

      {/* Left rail · 5 phase pips */}
      <ol className="lc-stage-pips" aria-hidden="true">
        {PHASES.map((p, i) => (
          <li
            key={p.key}
            className={`lc-stage-pip ${i < activePhaseIdx ? "is-done" : ""} ${i === activePhaseIdx ? "is-active" : ""}`}
          >
            <span className="lc-stage-pip-key">0{i + 1}</span>
            <span className="lc-stage-pip-label">{p.label}</span>
          </li>
        ))}
      </ol>

      {/* Right rail · 10 score gauges */}
      <div className="lc-stage-gauges" aria-hidden="true">
        <span className="lc-stage-gauges-eb">10 moments</span>
        <div className="lc-stage-gauges-grid">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={`lc-stage-gauge ${i < gaugesLit ? "is-lit" : ""}`}>
              <span className="lc-stage-gauge-num">0{i + 1 < 10 ? `${i + 1}` : "10"}</span>
              <div className="lc-stage-gauge-fill" />
            </div>
          ))}
        </div>
      </div>

      {/* Bottom · live transcript drip + Kade ticker */}
      <div className="lc-stage-bottom">
        <div className="lc-stage-transcript">
          <span className="lc-stage-transcript-eb">listening</span>
          <div className="lc-stage-transcript-body">
            {transcriptLines.slice(0, visibleLines).map((line, i) => (
              <p
                key={i}
                className={`lc-stage-transcript-line ${i === visibleLines - 1 ? "is-fresh" : ""}`}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
        <div className="lc-stage-ticker" role="status" aria-live="polite">
          <span className="lc-stage-ticker-dot" />
          <span className="lc-stage-ticker-text">{TICKER_LINES[tickerIdx]}</span>
        </div>
      </div>
    </div>
  );
}
