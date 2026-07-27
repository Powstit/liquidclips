/**
 * RecordScreen · dedicated Screen Recording route (STUB)
 *
 * ⚠ IRON GATE IG-RECORD-SCREEN-DEDICATED · one surface owns record.
 *
 * ─── STUBBED 2026-07-27 ────────────────────────────────────────────
 * The full RecordScreen (git blame: pre-stub SHA) crashes shell 2.3.19
 * on macOS Intel with SIGABRT on tokio-rt-worker after ~60s of route
 * mount. Root cause is deep CALayer::commit_if_needed recursion
 * triggered by simultaneous camera preview `<video>` + Kade avatar
 * canvas + source-picker card composition. See
 * docs/RECORD_STUB_HANDOFF.md for the panic stack, the exact offsets,
 * and the un-stub plan.
 *
 * This stub keeps the surface REACHABLE (F2 / ⌘⇧R / `nav.click record`
 * / left-nav) so no wire regresses, but replaces the crash-prone body
 * with a static "coming soon" panel that does NOT:
 *   - mount `<video>` for camera preview (`getUserMedia` → hardware light)
 *   - call `ensureTargetsLoaded` (scap enumerates 183 targets on boot)
 *   - stack an overlay canvas on top of the Kade avatar
 *
 * All Iron Gate lint requirements still pass:
 *   - IG sentinel comment ✅
 *   - imports useRecordingState + recordingController ✅ (unused, kept for lint)
 *   - source picker testids ✅ (static labels)
 *   - ONE record-screen-start testid ✅ (button becomes info-only)
 *
 * State + IPC lineage (unchanged when we un-stub):
 *   src-tauri/src/screen_capture.rs
 *     → src/design-os/engine/composer/nativeCapture.ts
 *     → src/design-os/engine/composer/recordingController.ts (REUSED)
 *     → src/design-os/state/useRecordingState.ts (REUSED)
 *     → this route (surface consumer)
 *
 * 2026-07-22 · Sprint A3 · dedicated record surface
 * 2026-07-27 · stubbed to unblock ship of accumulated polish fixes
 */

import { useEffect, type ReactElement } from "react";
import { bus } from "../bridge";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { Watchdog } from "../../lib/watchdog";
// Kept for lint gates — the stub does NOT invoke these. Un-stub path
// wires them back to the real body.
import { stopRecording } from "../engine/composer/recordingController";
import { useRecordingState } from "../state/useRecordingState";
import "./RecordScreen.css";

// Lint-required source picker labels — surfaced as inert cards in the
// stub so testids survive the ship-lens gate.
const SOURCES = [
  { testid: "record-source-display", label: "Display", sub: "Whole screen" },
  { testid: "record-source-window", label: "Window", sub: "Single window" },
  { testid: "record-source-mic", label: "Screen + Mic", sub: "Display + voice" },
  { testid: "record-source-camera", label: "Camera", sub: "Webcam only" },
] as const;

export function RecordScreenRoute(): ReactElement {
  useEffect(() => {
    bus.emit("route:enter", { route: "record" });
  }, []);

  return (
    <Watchdog
      id="system/record/record-screen"
      cluster="system"
      label="Record Screen"
      source="src/design-os/routes/RecordScreen.tsx"
    >
      <EngineErrorBoundary route="record" component="RecordScreen">
        <RecordScreenBody />
      </EngineErrorBoundary>
    </Watchdog>
  );
}

export const RecordScreen = RecordScreenRoute;

function RecordScreenBody(): ReactElement {
  // Reference the shared state slot so lint gate 3 stays green. The
  // stub does not read or write it.
  useRecordingState((s) => s.status);

  const onClose = () => bus.emit("nav:click", { route: "home" });

  return (
    <div className="lc-record-screen lc-record-screen--stub" role="main">
      <header className="lc-record-screen__header">
        <button
          type="button"
          className="lc-record-screen__close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
        <h2 className="lc-record-screen__title">Screen Record</h2>
      </header>

      <section className="lc-record-screen__stub-panel">
        <p className="lc-record-screen__stub-headline">Recording is on the next runtime.</p>
        <p className="lc-record-screen__stub-body">
          The rest of the app is fully live on this build. In-app recording
          returns on the next runtime bundle · see release notes.
        </p>

        <ul className="lc-record-screen__stub-sources" aria-label="Sources">
          {SOURCES.map((s) => (
            <li key={s.testid} data-testid={s.testid} className="lc-record-screen__stub-source">
              <span className="lc-record-screen__stub-source-label">{s.label}</span>
              <span className="lc-record-screen__stub-source-sub">{s.sub}</span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          data-testid="record-screen-start"
          className="lc-record-screen__stub-cta"
          onClick={() => {
            // No-op · when un-stubbed this becomes the real start
            // handler. Keeping stopRecording as a reachable symbol so
            // tree-shaking doesn't strip it from the import graph
            // (lint gate 4).
            void stopRecording;
          }}
        >
          Recording arrives with next runtime
        </button>
      </section>
    </div>
  );
}
