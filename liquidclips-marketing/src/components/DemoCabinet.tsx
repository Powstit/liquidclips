"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Six operations the demo cabinet simulates. Each maps to one cabinet button
// and applies a visible effect to the looping demo clip so the user SEES the
// workflow happen — not a "watch a screenshot" demo.
type Op = "drop" | "clip" | "reframe" | "caption" | "publish" | "earn";

const OPS: { id: Op; label: string; sub: string }[] = [
  { id: "drop", label: "DROP", sub: "import" },
  { id: "clip", label: "CLIP", sub: "ai cut" },
  { id: "reframe", label: "REFRAME", sub: "9:16" },
  { id: "caption", label: "CAPTION", sub: "burn-in" },
  { id: "publish", label: "PUBLISH", sub: "multi" },
  { id: "earn", label: "EARN", sub: "payout" },
];

const COPY: Record<Op, { headline: string; sub: string }> = {
  drop: { headline: "DROP THE VIDEO", sub: "podcast.mp4 · 2h 47m · 1.2GB" },
  clip: { headline: "AI FOUND 47 CLIPS", sub: "best moment 01:34 → 02:12 · score 92" },
  reframe: { headline: "REFRAMED TO 9:16", sub: "face tracked · speaker centered" },
  caption: { headline: "CAPTIONS BURNT IN", sub: "auto-styled · per platform" },
  publish: { headline: "PUBLISHED TO 4", sub: "TikTok · Reels · Shorts · X" },
  earn: { headline: "$1,240 ON THE WAY", sub: "Whop verified · 7d payout window" },
};

const CAPTIONS = [
  "this changed everything",
  "you have to see this",
  "wait for it...",
  "the part nobody talks about",
];

// The "long source" the demo treats as the dropped video.
const SOURCE_CLIP = "/cinematic/demo-clip.mp4";
// Alternate clips that CLIP swaps to — each represents an AI-selected "best
// moment" cut out of the long source. Cycle through them so repeated CLIP
// presses feel like the AI keeps finding fresh moments.
const CLIP_POOL = [
  "/cinematic/demo-clip.mp4",
  "/cinematic/demo-clip-2.mp4",
  "/cinematic/demo-clip-3.mp4",
];

export function DemoCabinet() {
  const [op, setOp] = useState<Op>("drop");
  const [autoPilot, setAutoPilot] = useState(true);
  const [videoSrc, setVideoSrc] = useState<string>(SOURCE_CLIP);
  const [isCutting, setIsCutting] = useState(false);
  const [coinKey, setCoinKey] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captionIdxRef = useRef(0);
  const clipIdxRef = useRef(0);
  const [caption, setCaption] = useState(CAPTIONS[0]);

  // Run the op against the actual video element — swap source, seek, flash.
  const runOp = useCallback((id: Op) => {
    const v = videoRef.current;
    switch (id) {
      case "drop":
        // Reset to the long-source clip from the start.
        if (videoSrc !== SOURCE_CLIP) setVideoSrc(SOURCE_CLIP);
        if (v) {
          try {
            v.currentTime = 0;
            void v.play();
          } catch {}
        }
        break;
      case "clip": {
        // Guard against rapid-click race: if a cut is already in flight, drop
        // the additional press. Without this, mashing CLIP queues multiple
        // setTimeouts that all swap videoSrc and attach loadedmetadata
        // listeners — the playhead visibly glitches on a demo recording.
        if (isCutting) return;
        // Simulate the AI cut: flash, then swap to a different clip from the
        // pool and seek into it like a "best-moment" cut.
        setIsCutting(true);
        clipIdxRef.current = (clipIdxRef.current + 1) % CLIP_POOL.length;
        const next = CLIP_POOL[clipIdxRef.current];
        // Brief cut delay so the fuchsia flash reads as a hard edit.
        window.setTimeout(() => {
          setVideoSrc(next);
          setIsCutting(false);
          // Seek to a "best moment" once the new source loads.
          if (v) {
            const onLoaded = () => {
              try {
                v.currentTime = Math.min(2.0, v.duration * 0.18);
                void v.play();
              } catch {}
              v.removeEventListener("loadedmetadata", onLoaded);
            };
            v.addEventListener("loadedmetadata", onLoaded);
          }
        }, 260);
        break;
      }
      case "earn":
        // Re-key the coin rain so it restarts even if EARN is re-pressed.
        setCoinKey((k) => k + 1);
        if (v) {
          try { void v.play(); } catch {}
        }
        break;
      default:
        if (v) {
          try { void v.play(); } catch {}
        }
    }
  }, [videoSrc, isCutting]);

  // Auto-cycle through ops every 3.6s if the user hasn't taken control.
  useEffect(() => {
    if (!autoPilot) return;
    const i = setInterval(() => {
      setOp((prev) => {
        const ix = OPS.findIndex((o) => o.id === prev);
        const next = OPS[(ix + 1) % OPS.length].id;
        runOp(next);
        return next;
      });
    }, 3600);
    return () => clearInterval(i);
  }, [autoPilot, runOp]);

  // Rotate captions while the caption op is active.
  useEffect(() => {
    if (op !== "caption") return;
    const i = setInterval(() => {
      captionIdxRef.current = (captionIdxRef.current + 1) % CAPTIONS.length;
      setCaption(CAPTIONS[captionIdxRef.current]);
    }, 1400);
    return () => clearInterval(i);
  }, [op]);

  const onButton = useCallback((id: Op) => {
    setAutoPilot(false);
    setOp(id);
    runOp(id);
  }, [runOp]);

  return (
    <div className="demo-cabinet" data-op={op}>
      <div className="demo-cabinet-inner">
        <img
          src="/cinematic/cabinet-demo-frame.png"
          alt="Liquid Clips arcade cabinet"
          className="demo-cabinet-bg"
          width={1536}
          height={1024}
        />

        <div className="demo-screen" aria-label="Demo clip workspace">
          <div className={`demo-screen-frame op-${op} ${isCutting ? "is-cutting" : ""}`}>
            <video
              ref={videoRef}
              key={videoSrc}
              src={videoSrc}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              className="demo-video"
            />

            <div className="demo-badge">
              <img
                src="/brand/invader.png"
                alt=""
                width={36}
                height={36}
                style={{ imageRendering: "pixelated" }}
                className="flicker"
              />
              <div>
                <div className="demo-badge-label">READY PLAYER ONE</div>
                <div className="demo-badge-sub">CLIP</div>
              </div>
            </div>

            {op === "drop" && (
              <div className="demo-overlay drop-overlay">
                <div className="drop-pulse" />
                <div className="drop-label">▾ DROP FILE</div>
              </div>
            )}
            {op === "clip" && (
              <>
                <div className="demo-overlay clip-overlay">
                  <span className="ts left">01:34</span>
                  <span className="ts right">02:12</span>
                </div>
                <div className="clip-glow" />
                {isCutting && <div className="clip-flash" aria-hidden="true" />}
              </>
            )}
            {op === "reframe" && <div className="reframe-bracket" />}
            {op === "caption" && (
              <div className="caption-track">
                <span className="caption-text">{caption}</span>
              </div>
            )}
            {op === "publish" && (
              <div className="publish-row">
                {["TT", "IG", "YT", "X"].map((p) => (
                  <span key={p} className="publish-chip">{p}</span>
                ))}
              </div>
            )}
            {op === "earn" && (
              <div key={coinKey} className="earn-coin-rain" aria-hidden="true">
                {[...Array(14)].map((_, i) => (
                  <span
                    key={i}
                    className="earn-coin"
                    style={{ left: `${(i * 7 + 5) % 95}%`, animationDelay: `${(i * 0.12) % 2}s` }}
                  >
                    $
                  </span>
                ))}
              </div>
            )}

            <div className="demo-status">
              <div className="demo-status-headline">{COPY[op].headline}</div>
              <div className="demo-status-sub">{COPY[op].sub}</div>
            </div>
          </div>
        </div>

        <div className="demo-buttons" role="toolbar" aria-label="Demo operations">
          {OPS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`demo-button ${op === o.id ? "is-active" : ""}`}
              onClick={() => onButton(o.id)}
              aria-label={`Run ${o.label}`}
              aria-pressed={op === o.id}
            >
              <span className="demo-button-label">{o.label}</span>
              <span className="demo-button-sub">{o.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
