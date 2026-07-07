/**
 * KadeIgnition · BUG-029.6
 *
 * The big, brand-loud 3D loading state surfaced immediately after the
 * user hits Analyze & Clip. Renders a large Kade portrait that floats
 * with a 3D parallax, with a churning headline drawn from the live
 * engine session. Dismisses itself the moment the first generated clip
 * lands (clipsReady > 0) or the run completes / errors.
 *
 * Mounted inside the Workstation route body, ABOVE the ClipPreviewShell
 * and ResultsGrid (which are empty for the first ~seconds of a run
 * anyway). Pure CSS animation — no rive, no GSAP, no extra deps.
 *
 * UI-only. Reads from useEngineSession; no engine, sidecar, or RPC
 * calls.
 */

import { useEngineSession } from "../state/useEngineSession";
import "./KadeIgnition.css";

const HEADLINE_BY_STAGE: Record<string, string> = {
  ingest: "Preparing video",
  audio: "Preparing audio",
  transcribe: "Transcribing",
  llm: "Picking clips",
  cut: "Cutting",
  reframe: "Rendering",
  thumbs: "Making thumbnails",
};

export function KadeIgnition() {
  const session = useEngineSession();

  // Only render when the engine is actively churning AND no clips have
  // landed yet. Once the first clip arrives the ResultsGrid is the
  // primary surface; the ignition overlay would just be noise.
  if (session.phase !== "running" || session.clipsReady > 0) return null;

  const stageHeadline =
    (session.stage && HEADLINE_BY_STAGE[session.stage]) ?? "Analyzing";

  return (
    <div className="lc-kade-ignition" role="status" aria-live="polite">
      <div className="lc-kade-ignition-stage">
        <div className="lc-kade-ignition-orbit lc-kade-ignition-orbit-outer" />
        <div className="lc-kade-ignition-orbit lc-kade-ignition-orbit-inner" />
        <div className="lc-kade-ignition-floor" />
        <img
          src="/brand/kade/kade-cutting-clips.webp"
          alt=""
          className="lc-kade-ignition-img"
          draggable={false}
        />
      </div>
      <div className="lc-kade-ignition-copy">
        <span className="lc-kade-ignition-eb">Engine · live</span>
        <h2 className="lc-kade-ignition-h">{stageHeadline}…</h2>
        {session.note && (
          <p className="lc-kade-ignition-note">{session.note}</p>
        )}
      </div>
    </div>
  );
}
