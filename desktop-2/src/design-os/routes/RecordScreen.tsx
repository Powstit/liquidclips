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
 *   1. Source picker (Display / Window / Camera / Camera + Mic) — cards
 *      with 44x44 minimum touch targets, one primary CTA at bottom.
 *   2. Target picker (which display/window) for the screen lanes.
 *   3. Resolution picker (720p · 1080p · 4K) — screen lanes only.
 *   4. Countdown before start (Off · 3s · 5s).
 *   5. ONE primary CTA — "Start recording" — testid `record-screen-start`.
 *   6. "Add a file from this Mac" — manual fallback that feeds an
 *      existing video straight into the same source:drop ingest path
 *      a finished recording uses.
 *
 * Once active:
 *   - Countdown overlays when armed (if the setting is on).
 *   - Screen lanes hide their config surface behind a status pill.
 *   - Camera lanes keep the live camera preview mounted (see below) —
 *     you see yourself the whole time you're recording.
 *   - A bottom-center recording pill shows the elapsed timer + a Stop
 *     button. Stop returns the user to the source-picker view.
 *
 * ─── 2026-07-28 · un-stubbed, then rebuilt against a reference build ──
 * This route shipped once (2026-07-22), got stubbed (a486c3fc,
 * 2026-07-27) after a reported SIGABRT, then un-stubbed here once the
 * two concretely-fixable things were actually fixed: eager target
 * enumeration on mount, and a scap/ffmpeg pipe that discarded frames
 * instead of writing a file.
 *
 * A parallel implementation surfaced later (Dropbox handoff,
 * window-face-recording-source-2026-07-28) with a much fuller UX:
 * live camera preview visible throughout, a target dropdown, Camera +
 * Mic as a real audio-recording source, "add a file from this Mac".
 * All of that landed here. What did NOT land: that build also ran a
 * *second* live native screen-preview (a separate scap Capturer
 * streaming frames over Tauri events into a <canvas>) simultaneously
 * with the camera preview by default — almost certainly the actual
 * SIGABRT mechanism, given its own comments are dated 2026-07-26, one
 * day before the stub. This route deliberately keeps only ONE live
 * video surface mounted at a time: the camera preview when a camera
 * lane is selected, nothing live for display/window (just a static
 * target label — no canvas, no second capturer).
 *
 * Target enumeration (`ensureTargetsLoaded`) still isn't called
 * unconditionally on mount. It fires when the user selects Display or
 * Window, deferred one tick past the initial render (see the comment
 * on the effect below) so it never competes with mount-time work.
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
 * 2026-07-28 · top-level camera preview, target picker, Camera+Mic audio,
 *              add-a-file fallback — matched against the reference build,
 *              minus its dual live-preview crash risk
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { bus } from "../bridge";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { Watchdog } from "../../lib/watchdog";
import {
  startCameraRecording,
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

type SourceKind = "display" | "window" | "camera" | "camera-mic";
type Resolution = "720p" | "1080p" | "4k";
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
    kind: "camera",
    testid: "record-source-camera",
    label: "Camera",
    sub: "Video only",
    icon: "○",
  },
  {
    kind: "camera-mic",
    testid: "record-source-camera-mic",
    label: "Camera + Mic",
    sub: "Video and voice",
    icon: "◉",
  },
];

const RESOLUTIONS: ReadonlyArray<Resolution> = ["720p", "1080p", "4k"];
const COUNTDOWNS: ReadonlyArray<Countdown> = [0, 3, 5];

function isScreenSource(kind: SourceKind): kind is "display" | "window" {
  return kind === "display" || kind === "window";
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
  const [countdown, setCountdown] = useState<Countdown>(0);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  // Shared with CameraPreview (below) so the device you're previewing is
  // the same one startCameraRecording() actually opens — the preview's
  // own getUserMedia stream is separate from the recording's, but both
  // should point at the same physical camera.
  const [cameraDeviceId, setCameraDeviceId] = useState<string>("");

  // Load the target list when the user selects a screen lane — deferred
  // one macrotask past the render that made it lazy (setTimeout 0)
  // rather than firing synchronously during mount/render. On at least
  // one dev machine scap enumerates 183 targets; running that
  // synchronously the instant this route (or its default source) mounts
  // was flagged as a real contributor to the shell instability that got
  // this surface stubbed once already. Deferring by a tick means it
  // still runs promptly, just not stacked into the same synchronous
  // work as everything else mounting this route.
  useEffect(() => {
    if (!isScreenSource(sourceKind)) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (!cancelled) void import("../engine/composer/recordingController").then((m) => m.ensureTargetsLoaded());
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [sourceKind]);

  const targetsForSource = useMemo(
    () => (isScreenSource(sourceKind) ? targets.filter((t) => t.kind === sourceKind) : []),
    [targets, sourceKind],
  );

  const resolveTargetIdx = (): number => {
    const idx = targets.findIndex((t) => t.id === selectedTargetId);
    if (idx >= 0 && targets[idx]?.kind === sourceKind) return idx;
    const fallback = targets.findIndex((t) => t.kind === sourceKind);
    return fallback >= 0 ? fallback : 0;
  };

  const beginRecording = () => {
    if (sourceKind === "camera" || sourceKind === "camera-mic") {
      void startCameraRecording(cameraDeviceId || undefined, sourceKind === "camera-mic");
      return;
    }
    void startRecording(resolveTargetIdx(), resolution);
  };

  useEffect(() => {
    if (countdownRemaining === null) return;
    if (countdownRemaining <= 0) {
      setCountdownRemaining(null);
      beginRecording();
      return;
    }
    const t = window.setTimeout(() => {
      setCountdownRemaining((n) => (n === null ? null : n - 1));
    }, 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownRemaining, sourceKind, targets, resolution, cameraDeviceId, selectedTargetId]);

  const isActive = status === "active";
  const isArming = status === "arming" || countdownRemaining !== null;
  const isStopping = status === "stopping";

  const canStart = useMemo(() => {
    return !isActive && !isArming && !isStopping;
  }, [isActive, isArming, isStopping]);

  const onStart = () => {
    if (!canStart) return;
    if (countdown > 0) {
      setCountdownRemaining(countdown);
      return;
    }
    beginRecording();
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

  const addFileFromComputer = async () => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const chosen = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Video", extensions: ["mp4", "mov", "m4v", "webm"] }],
      });
      if (!chosen) return;
      const path = typeof chosen === "string" ? chosen : String(chosen);
      if (path.trim()) bus.emit("source:drop", { paths: [path] });
    } catch (exc) {
      useRecordingState
        .getState()
        .setError(`file picker failed · ${String(exc).slice(0, 140)}`);
    }
  };

  const showCameraPreview = sourceKind === "camera" || sourceKind === "camera-mic";

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

      {/* Mounted at the top level — outside the isActive/ConfigView
         switch — so it stays visible through the whole recording, not
         just while choosing a source. Camera-only: no second live
         surface runs alongside it (see file header). */}
      {showCameraPreview && (
        <div className="lc-record-screen-camera-stage">
          <CameraPreview deviceId={cameraDeviceId} onDeviceChange={setCameraDeviceId} />
        </div>
      )}

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
          countdown={countdown}
          setCountdown={setCountdown}
          targetsForSource={targetsForSource}
          selectedTargetId={selectedTargetId}
          setSelectedTargetId={setSelectedTargetId}
          canStart={canStart}
          onStart={onStart}
          lastError={lastError}
          lastRecordingPath={status === "idle" ? lastRecordingPath : null}
          onAddFile={() => void addFileFromComputer()}
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
  countdown: Countdown;
  setCountdown: (c: Countdown) => void;
  targetsForSource: ReadonlyArray<{ id: string; kind: string; label: string }>;
  selectedTargetId: string;
  setSelectedTargetId: (id: string) => void;
  canStart: boolean;
  onStart: () => void;
  lastError: string | null;
  lastRecordingPath: string | null;
  onAddFile: () => void;
  armingLabel: string | null;
}

function ConfigView(props: ConfigProps): ReactElement {
  const isScreen = isScreenSource(props.sourceKind);
  const currentTargetValue = props.targetsForSource.some((t) => t.id === props.selectedTargetId)
    ? props.selectedTargetId
    : (props.targetsForSource[0]?.id ?? "");

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

      {isScreen && (
        <section className="lc-record-screen-section">
          <h2 className="lc-record-screen-section-h">
            {props.sourceKind === "window" ? "Window to record" : "Display to record"}
          </h2>
          {props.targetsForSource.length > 0 ? (
            <select
              className="lc-record-screen-target-select"
              value={currentTargetValue}
              onChange={(e) => props.setSelectedTargetId(e.target.value)}
              data-testid="record-screen-target-select"
              aria-label="Recording target"
            >
              {props.targetsForSource.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="lc-record-screen-camera-status" data-testid="record-screen-target-loading">
              Loading {props.sourceKind}s… (grant Screen Recording permission if prompted)
            </p>
          )}
        </section>
      )}

      {isScreen && (
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
      )}

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
          {props.armingLabel ?? "Start recording"}
        </button>
      </div>

      <div className="lc-record-screen-cta-row">
        <button
          type="button"
          className="lc-record-screen-secondary"
          data-testid="record-screen-add-file"
          onClick={props.onAddFile}
        >
          Add a file from this Mac
        </button>
      </div>
    </div>
  );
}

/**
 * CameraPreview · live `getUserMedia` feed for Camera / Camera + Mic.
 *
 * Mounted at the top level of RecordScreenBody whenever a camera lane
 * is selected — before AND during active recording, matching the
 * reference build's "you see yourself the whole time" behaviour.
 * Deliberately its own component with its own mount/unmount effect:
 * switching to Display/Window (or leaving this route) tears the
 * stream down immediately via the cleanup function, so nothing lingers
 * once you're not looking at a camera source.
 *
 * This is a SEPARATE getUserMedia call from the one
 * recordingController.startCameraRecording() makes when you actually
 * press Start — two independent camera handles, not one shared
 * stream. Simpler than threading a shared MediaStream through the
 * store, and macOS allows multiple concurrent consumers of the same
 * camera. The device dropdown here is controlled (deviceId/onDeviceChange)
 * so Start opens the same physical camera you're previewing.
 */
function CameraPreview(props: {
  deviceId: string;
  onDeviceChange: (id: string) => void;
}): ReactElement {
  const { deviceId, onDeviceChange } = props;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<MediaCaptureSession | null>(null);
  const [devices, setDevices] = useState<MediaInputDevice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

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
    setPlaying(false);
    // mediaCapture.ts's own previewEl wiring does `void previewEl.play()`
    // fire-and-forget — if the WebView's autoplay policy silently rejects
    // that (common once the call is a tick past the click that triggered
    // it, since getUserMedia's await breaks the "user gesture" chain),
    // you get a live stream attached to a video element that never
    // renders a frame: no error anywhere, just a black box. Skip passing
    // previewEl into startMediaCapture and instead wire srcObject + play()
    // here ourselves so a rejection actually surfaces.
    void startMediaCapture({
      video: true,
      audio: false,
      videoDeviceId: deviceId || undefined,
    })
      .then((session) => {
        if (cancelled) {
          session.cancel();
          return;
        }
        sessionRef.current = session;
        const el = videoRef.current;
        if (!el) return;
        el.srcObject = session.stream;
        el.play()
          .then(() => {
            if (!cancelled) setPlaying(true);
          })
          .catch((err: unknown) => {
            if (!cancelled) {
              const msg = err instanceof Error ? err.message : "camera.play_blocked";
              setError(`preview didn't start playing: ${msg}`);
            }
          });
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
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    // Re-run only when the chosen device changes — mount/unmount of this
    // whole component (via the showCameraPreview check in RecordScreenBody)
    // already covers the start/stop-on-source-switch case.
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
        onError={() => setError("video element failed to load the camera stream")}
      />
      {!playing && !error && (
        <p className="lc-record-screen-camera-status" data-testid="record-screen-camera-waiting">
          Connecting to camera…
        </p>
      )}
      {devices.length > 1 && (
        <select
          className="lc-record-screen-camera-select"
          data-testid="record-screen-camera-select"
          value={deviceId}
          onChange={(e) => onDeviceChange(e.target.value)}
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
