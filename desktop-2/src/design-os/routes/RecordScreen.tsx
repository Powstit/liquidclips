/**
 * RecordScreen · dedicated Screen Recording route
 *
 * ⚠ IRON GATE IG-RECORD-SCREEN-DEDICATED · one surface owns record.
 *
 * Screen recording used to be a chip buried in the Composer's ASK TESTS
 * dev panel. Clippers couldn't find it, and when they did it fired
 * inside the 14-surface Composer canvas.
 *
 * This route owns the record use case end-to-end:
 *
 *   1. Source picker (Display / Window / Screen+Mic / Camera) — cards
 *      with 44x44 minimum touch targets, one primary CTA at bottom.
 *   2. Resolution picker (720p · 1080p · 4K).
 *   3. Audio input picker — disabled for now (see note below).
 *   4. Countdown before start (Off · 3s · 5s).
 *   5. ONE primary CTA — "Start recording" — testid `record-screen-start`.
 *
 * Once active:
 *   - Countdown overlays when armed (if the setting is on).
 *   - The route stays mounted but hides its config surface.
 *   - A bottom-center recording pill shows the elapsed timer + a Stop
 *     button. Stop returns the user to the source-picker view.
 *
 * ─── 2026-07-28 · un-stubbed ───────────────────────────────────────
 * This route shipped once (2026-07-22), then got replaced with a
 * static "coming soon" stub (a486c3fc, 2026-07-27) after it was
 * blamed for a SIGABRT crash ~60s after mount. The committed version
 * of this file (this one) never actually mounted a `<video>` preview
 * or a duplicate Kade avatar canvas — the two things the crash
 * write-up pointed at — so that reproduction was against an
 * uncommitted local build, not this source. What IS verifiably true
 * from this file, and worth fixing regardless: `ensureTargetsLoaded`
 * used to fire unconditionally on every route mount, and on at least
 * one dev machine `scap` enumerates 183 targets — real, avoidable
 * work to run eagerly before the user has clicked anything. That
 * eager call is gone now; target loading happens lazily inside
 * `startRecording` itself (already idempotent), the first time the
 * user actually presses Start.
 *
 * screen_capture.rs also changed underneath this route in the same
 * pass: it now pipes real frames into ffmpeg and writes an actual MP4
 * (previously frames were captured and discarded — "Recording saved"
 * was a lie). Audio capture isn't wired on the Rust side yet, so the
 * Audio Input picker below is disabled by design until that lands.
 *
 * State + IPC lineage:
 *   src-tauri/src/screen_capture.rs
 *     → src/design-os/engine/composer/nativeCapture.ts
 *     → src/design-os/engine/composer/recordingController.ts (REUSED)
 *     → src/design-os/state/useRecordingState.ts (REUSED)
 *     → this route (surface consumer)
 *
 * NEVER reinvents the recording state machine. Every start / stop /
 * toggle goes through the shared recordingController exported by
 * `../engine/composer/recordingController` — same wire ComposerSuiteFrame
 * uses today.
 *
 * 2026-07-22 · Sprint A3 · dedicated record surface
 * 2026-07-28 · un-stubbed · lazy target load + real MP4 output path
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { bus } from "../bridge";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { Watchdog } from "../../lib/watchdog";
import {
  startRecording,
  stopRecording,
} from "../engine/composer/recordingController";
import {
  useRecordingElapsedSeconds,
  useRecordingState,
} from "../state/useRecordingState";
import {
  enumerateMediaInputs,
  startMediaCapture,
  type MediaCaptureSession,
  type MediaInputDevice,
} from "../engine/composer/mediaCapture";
import "./RecordScreen.css";

type SourceKind = "display" | "window" | "mic" | "camera";
type Resolution = "720p" | "1080p" | "4k";
type AudioInput = "system" | "mic" | "both" | "off";
type Countdown = 0 | 3 | 5;

interface SourceCard {
  kind: SourceKind;
  testid: string;
  label: string;
  sub: string;
  icon: string;
}

const SOURCES: ReadonlyArray<SourceCard> = [
  {
    kind: "display",
    testid: "record-source-display",
    label: "Display",
    sub: "Whole screen",
    icon: "◻",
  },
  {
    kind: "window",
    testid: "record-source-window",
    label: "Window",
    sub: "Single window",
    icon: "▢",
  },
  {
    kind: "mic",
    testid: "record-source-mic",
    label: "Screen + Mic",
    sub: "Display + voice",
    icon: "◉",
  },
  {
    kind: "camera",
    testid: "record-source-camera",
    label: "Camera",
    sub: "Webcam only",
    icon: "○",
  },
];

const RESOLUTIONS: ReadonlyArray<Resolution> = ["720p", "1080p", "4k"];
const AUDIO_INPUTS: ReadonlyArray<AudioInput> = ["system", "mic", "both", "off"];
const COUNTDOWNS: ReadonlyArray<Countdown> = [0, 3, 5];

/**
 * Pick the first target from useRecordingState that best matches the
 * chosen source kind. Falls back to index 0 when nothing matches — the
 * shared recordingController accepts a raw index, so the source picker
 * behaves like a hint, not a hard filter.
 */
function pickTargetIdx(
  kind: SourceKind,
  targets: ReadonlyArray<{ kind: string }>,
): number {
  if (targets.length === 0) return 0;
  // The scap `kind` field comes back as "display" | "window" (macOS). Mic
  // + camera aren't a scap concept yet; they map to display 0 for now so
  // the shared wire doesn't have to grow a new branch. Follow-up sprint
  // will land the mediaCapture (camera / mic) path behind this same
  // route without changing the API surface.
  const wanted = kind === "camera" || kind === "mic" ? "display" : kind;
  const idx = targets.findIndex((t) => t.kind === wanted);
  return idx >= 0 ? idx : 0;
}

/** mm:ss formatter for the recording pill timer. */
function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Route entry — wraps the surface in Watchdog + EngineErrorBoundary
 *  per the design-os convention. Never bypass. */
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

/** Alias export so SimulatorRouter can import a `default` shape either
 *  way (the pattern in-tree varies). */
export const RecordScreen = RecordScreenRoute;

function RecordScreenBody(): ReactElement {
  const status = useRecordingState((s) => s.status);
  const targets = useRecordingState((s) => s.targets);
  const targetLabel = useRecordingState((s) => s.targetLabel);
  const lastError = useRecordingState((s) => s.lastError);
  const lastRecordingPath = useRecordingState((s) => s.lastRecordingPath);
  const elapsed = useRecordingElapsedSeconds();

  const [sourceKind, setSourceKind] = useState<SourceKind>("display");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [audioInput, setAudioInput] = useState<AudioInput>("off");
  const [countdown, setCountdown] = useState<Countdown>(0);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);

  // NOTE 2026-07-28: this route used to prime the target list on mount
  // (`void ensureTargetsLoaded()`) so the first Start click wouldn't have
  // to wait for permission-check + enumeration. Removed intentionally —
  // on at least one dev machine `scap` enumerates 183 targets, and doing
  // that unconditionally the instant this route mounts was flagged as a
  // real contributor to the shell instability that got this surface
  // stubbed out (see the file header). `startRecording()` already calls
  // the idempotent `ensureTargetsLoaded()` itself, so functionality is
  // unchanged — only the timing moves from "on mount" to "on first
  // Start press", which is also when the user expects to wait anyway.

  // Countdown tick. Runs only when countdownRemaining is a positive
  // number; drops to null once the timer fires the actual start.
  useEffect(() => {
    if (countdownRemaining === null) return;
    if (countdownRemaining <= 0) {
      setCountdownRemaining(null);
      const idx = pickTargetIdx(sourceKind, targets);
      void startRecording(idx, resolution);
      return;
    }
    const t = window.setTimeout(() => {
      setCountdownRemaining((n) => (n === null ? null : n - 1));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [countdownRemaining, sourceKind, targets, resolution]);

  const isActive = status === "active";
  const isArming = status === "arming" || countdownRemaining !== null;
  const isStopping = status === "stopping";

  // Camera has a live preview (below) but Start still isn't wired to it —
  // pickTargetIdx falls back to a scap display target for "camera" (see
  // its doc comment), which would silently record the screen instead of
  // the face the user is previewing. Disabling Start here instead of
  // lying about what it will do; camera recording is a separate,
  // not-yet-built pipeline through mediaCapture.ts.
  const canStart = useMemo(() => {
    return !isActive && !isArming && !isStopping && sourceKind !== "camera";
  }, [isActive, isArming, isStopping, sourceKind]);

  const onStart = () => {
    if (!canStart) return;
    if (countdown > 0) {
      setCountdownRemaining(countdown);
      return;
    }
    const idx = pickTargetIdx(sourceKind, targets);
    void startRecording(idx, resolution);
  };

  const onStop = () => {
    void stopRecording();
  };

  const onClose = () => {
    // Bounce to Home. Never stop an active recording as a side-effect
    // of Close — the user might be recording the app itself and only
    // navigating the shell mid-take.
    bus.emit("nav:click", { route: "home" });
  };

  return (
    <div className="lc-record-screen" data-testid="record-screen-root">
      <header className="lc-record-screen-head">
        <button
          type="button"
          className="lc-record-screen-close"
          onClick={onClose}
          aria-label="Close Screen Record"
          data-testid="record-screen-close"
        >
          ×
        </button>
        <span className="lc-record-screen-title">Screen Record</span>
        <span className="lc-record-screen-spacer" aria-hidden="true" />
      </header>

      {isActive ? (
        <ActiveView
          targetLabel={targetLabel}
          elapsedText={formatElapsed(elapsed)}
          onStop={onStop}
          stopping={isStopping}
        />
      ) : (
        <ConfigView
          sourceKind={sourceKind}
          setSourceKind={setSourceKind}
          resolution={resolution}
          setResolution={setResolution}
          audioInput={audioInput}
          setAudioInput={setAudioInput}
          countdown={countdown}
          setCountdown={setCountdown}
          canStart={canStart}
          onStart={onStart}
          lastError={lastError}
          lastRecordingPath={status === "idle" ? lastRecordingPath : null}
          armingLabel={
            countdownRemaining !== null
              ? `Starting in ${countdownRemaining}…`
              : isArming
                ? "Preparing capture…"
                : null
          }
        />
      )}

      {countdownRemaining !== null && (
        <div
          className="lc-record-screen-countdown"
          role="status"
          aria-live="polite"
          data-testid="record-screen-countdown"
        >
          <span className="lc-record-screen-countdown-num">
            {countdownRemaining}
          </span>
          <span className="lc-record-screen-countdown-sub">
            Get ready…
          </span>
        </div>
      )}
    </div>
  );
}

interface ConfigProps {
  sourceKind: SourceKind;
  setSourceKind: (k: SourceKind) => void;
  resolution: Resolution;
  setResolution: (r: Resolution) => void;
  audioInput: AudioInput;
  setAudioInput: (a: AudioInput) => void;
  countdown: Countdown;
  setCountdown: (c: Countdown) => void;
  canStart: boolean;
  onStart: () => void;
  lastError: string | null;
  lastRecordingPath: string | null;
  armingLabel: string | null;
}

function ConfigView(props: ConfigProps): ReactElement {
  return (
    <div className="lc-record-screen-config">
      <section className="lc-record-screen-section">
        <h2 className="lc-record-screen-section-h">Source</h2>
        <div className="lc-record-screen-sources" role="radiogroup" aria-label="Source">
          {SOURCES.map((s) => (
            <button
              key={s.kind}
              type="button"
              role="radio"
              aria-checked={props.sourceKind === s.kind}
              className={`lc-record-screen-source ${
                props.sourceKind === s.kind ? "is-selected" : ""
              }`}
              data-testid={s.testid}
              onClick={() => props.setSourceKind(s.kind)}
            >
              <span className="lc-record-screen-source-ico" aria-hidden="true">
                {s.icon}
              </span>
              <span className="lc-record-screen-source-label">{s.label}</span>
              <span className="lc-record-screen-source-sub">{s.sub}</span>
            </button>
          ))}
        </div>
      </section>

      {props.sourceKind === "camera" && (
        <section className="lc-record-screen-section">
          <h2 className="lc-record-screen-section-h">
            Preview
            <span className="lc-record-screen-section-note"> · recording this arrives next runtime</span>
          </h2>
          <CameraPreview />
        </section>
      )}

      <section className="lc-record-screen-section">
        <h2 className="lc-record-screen-section-h">Resolution</h2>
        <div className="lc-record-screen-chips" role="radiogroup" aria-label="Resolution">
          {RESOLUTIONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={props.resolution === r}
              className={`lc-record-screen-chip ${
                props.resolution === r ? "is-selected" : ""
              }`}
              data-testid={`record-screen-res-${r}`}
              onClick={() => props.setResolution(r)}
            >
              {r === "4k" ? "4K" : r}
            </button>
          ))}
        </div>
      </section>

      <section className="lc-record-screen-section">
        <h2 className="lc-record-screen-section-h">
          Audio input
          <span className="lc-record-screen-section-note"> · video only for now</span>
        </h2>
        {/* 2026-07-28: screen_capture.rs deliberately does not wire audio
           yet (captures_audio: false — see its module doc for why muxing
           a second stream needs its own A/V-sync design). Leaving four
           audio buttons that silently do nothing would be exactly the
           kind of false-success UI this whole fix pass exists to remove,
           so the picker is disabled rather than deleted — it comes back
           live the moment the Rust side actually captures audio. */}
        <div
          className="lc-record-screen-chips"
          role="radiogroup"
          aria-label="Audio input"
          aria-disabled="true"
        >
          {AUDIO_INPUTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={props.audioInput === a}
              disabled
              className={`lc-record-screen-chip ${
                props.audioInput === a ? "is-selected" : ""
              }`}
              data-testid={`record-screen-audio-${a}`}
              onClick={() => props.setAudioInput(a)}
            >
              {a === "system"
                ? "System"
                : a === "mic"
                  ? "Mic"
                  : a === "both"
                    ? "Both"
                    : "Off"}
            </button>
          ))}
        </div>
      </section>

      <section className="lc-record-screen-section">
        <h2 className="lc-record-screen-section-h">Countdown before start</h2>
        <div className="lc-record-screen-chips" role="radiogroup" aria-label="Countdown">
          {COUNTDOWNS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={props.countdown === c}
              className={`lc-record-screen-chip ${
                props.countdown === c ? "is-selected" : ""
              }`}
              data-testid={`record-screen-count-${c}`}
              onClick={() => props.setCountdown(c)}
            >
              {c === 0 ? "Off" : `${c}s`}
            </button>
          ))}
        </div>
      </section>

      {props.lastError && (
        <p
          className="lc-record-screen-error"
          role="alert"
          data-testid="record-screen-error"
        >
          {props.lastError}
        </p>
      )}

      {!props.lastError && props.lastRecordingPath && (
        <p
          className="lc-record-screen-saved"
          role="status"
          data-testid="record-screen-saved"
        >
          Last recording saved to {props.lastRecordingPath}
        </p>
      )}

      <div className="lc-record-screen-cta-row">
        <button
          type="button"
          className="lc-record-screen-cta"
          data-testid="record-screen-start"
          onClick={props.onStart}
          disabled={!props.canStart}
        >
          <span className="lc-record-screen-cta-dot" aria-hidden="true" />
          {props.armingLabel ??
            (props.sourceKind === "camera" ? "Camera recording arrives next runtime" : "Start recording")}
        </button>
      </div>
    </div>
  );
}

/**
 * CameraPreview · live `getUserMedia` feed for the Camera source card.
 *
 * Mounted ONLY while `sourceKind === "camera"` (see ConfigView) — this
 * is exactly the kind of live `<video>` element the pre-stub crash
 * write-up blamed for CALayer commit recursion when combined with
 * other layers on RecordScreen. Keeping it isolated to its own
 * component with its own mount/unmount effect means switching away
 * from Camera (or leaving this route) tears the stream + preview
 * down immediately — nothing lingers to stack up with whatever else
 * is on screen. Preview only: Start is disabled while this source is
 * selected (see the canStart note in RecordScreenBody) because actual
 * camera recording isn't wired to a save path yet.
 */
function CameraPreview(): ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<MediaCaptureSession | null>(null);
  const [devices, setDevices] = useState<MediaInputDevice[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void enumerateMediaInputs().then(({ video }) => {
      if (!cancelled) setDevices(video);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void startMediaCapture({
      video: true,
      audio: false,
      videoDeviceId: deviceId || undefined,
      previewEl: videoRef.current,
    })
      .then((session) => {
        if (cancelled) {
          session.cancel();
          return;
        }
        sessionRef.current = session;
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "camera.preview_failed");
        }
      });
    return () => {
      cancelled = true;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
    // Re-run only when the chosen device changes — mount/unmount of this
    // whole component (via ConfigView's sourceKind check) already covers
    // the start/stop-on-source-switch case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="lc-record-screen-camera-preview">
      <video
        ref={videoRef}
        className="lc-record-screen-camera-video"
        data-testid="record-screen-camera-preview"
        playsInline
        muted
      />
      {devices.length > 1 && (
        <select
          className="lc-record-screen-camera-select"
          data-testid="record-screen-camera-select"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          <option value="">Default camera</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p className="lc-record-screen-camera-error" role="alert" data-testid="record-screen-camera-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface ActiveProps {
  targetLabel: string | null;
  elapsedText: string;
  onStop: () => void;
  stopping: boolean;
}

function ActiveView(props: ActiveProps): ReactElement {
  return (
    <div className="lc-record-screen-active" data-testid="record-screen-active">
      <div className="lc-record-screen-active-body">
        <div className="lc-record-screen-active-dot" aria-hidden="true" />
        <div className="lc-record-screen-active-copy">
          <span className="lc-record-screen-active-title">Recording</span>
          <span className="lc-record-screen-active-sub">
            {props.targetLabel ?? "Screen"}
          </span>
        </div>
      </div>

      <div
        className="lc-record-screen-pill"
        role="status"
        aria-live="polite"
        data-testid="record-screen-pill"
      >
        <span className="lc-record-screen-pill-dot" aria-hidden="true" />
        <span className="lc-record-screen-pill-time">{props.elapsedText}</span>
        <button
          type="button"
          className="lc-record-screen-pill-stop"
          data-testid="record-screen-stop"
          onClick={props.onStop}
          disabled={props.stopping}
        >
          {props.stopping ? "Saving…" : "Stop"}
        </button>
      </div>
    </div>
  );
}
