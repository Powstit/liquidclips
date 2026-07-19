/**
 * RecordPanel · Composer Phase 1c · F8 flowRecord.
 *
 * ⚠ IRON GATE IG-COMPOSER-II · Record source contract (end-to-end).
 *
 * 6-tile source picker (Tutorial · Display · Window · Screen+mic ·
 * Screen+audio · Camera). Click a tile → panel actually STARTS a
 * capture session via the right lane:
 *
 *   * camera / mic paths      → mediaCapture.ts (getUserMedia +
 *                                MediaRecorder · WKWebView native)
 *   * display / window / audio → nativeCapture.ts (Tauri invoke →
 *                                scap crate · macOS 13.0+)
 *
 * Live sessions are held on module state so the caller (Composer) can
 * stop them from a REC pill without holding React refs. The onPick
 * contract stays intact — every panel event still bubbles to
 * Composer's runtime reducer.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { bus } from "../../../bridge";
import { useCockpit, type ReactionLayoutKey } from "../../cockpit/CockpitContext";
import {
  startMediaCapture,
  enumerateMediaInputs,
  type MediaCaptureSession,
  type MediaInputDevice,
} from "../mediaCapture";
import { nativeCaptureStart, nativeCaptureStop } from "../nativeCapture";
import {
  startReactionRecording,
  type ReactionLayout,
  type ReactionRecordSession,
} from "../reactionRecord";
import { sidecarCall, isSidecarUnavailable } from "../../sidecarCall";
import "./ParamPanel.css";

export interface ParamPanelProps {
  visible: boolean;
  onPick: (fieldName: string, value: unknown) => void;
}

type SourceValue =
  | "tutorial"
  | "display"
  | "window"
  | "screen-mic"
  | "screen-audio"
  | "camera"
  // Composer D · Reaction Record mode (IG-COMPOSER-JJ) · records
  // screen + camera in parallel · sidecar merges via existing
  // _build_overlay_filter using CockpitSettings.reaction.layout.
  | "reaction";

interface SourceTile {
  value: SourceValue;
  label: string;
  earn?: boolean;
  wide?: boolean;
}

const SOURCES: ReadonlyArray<SourceTile> = [
  { value: "tutorial", label: "Tutorial · demo Kade", earn: true, wide: true },
  { value: "reaction", label: "Screen + Camera · React", wide: true },
  { value: "display", label: "Full screen" },
  { value: "window", label: "Just window" },
  { value: "screen-mic", label: "Screen + mic" },
  { value: "screen-audio", label: "Screen + audio" },
  { value: "camera", label: "Camera only" },
];

function toReactionLayout(k: ReactionLayoutKey): ReactionLayout {
  switch (k) {
    case "solo":
    case "side-by-side":
    case "top-bottom":
    case "pip-tl":
    case "pip-tr":
    case "pip-bl":
    case "pip-br":
    case "grid-2x2":
      return k;
    case "full-overlay":
      return "solo";
  }
}

type SessionKind = "media" | "native" | "tutorial";

interface ActiveSession {
  kind: SessionKind;
  source: SourceValue;
  mediaSession?: MediaCaptureSession;
  nativeSessionId?: string;
  previewUrl?: string;
  startedAtMs: number;
}

async function startForSource(source: SourceValue): Promise<ActiveSession | null> {
  const startedAtMs = Date.now();
  switch (source) {
    case "camera": {
      const media = await startMediaCapture({ video: true, audio: true });
      return { kind: "media", source, mediaSession: media, startedAtMs };
    }
    case "screen-mic": {
      // Screen path via scap · mic via getUserMedia. In dev without a live
      // Tauri runtime `nativeCaptureStart` throws; we still start the mic
      // so the user can see feedback.
      const media = await startMediaCapture({ video: false, audio: true });
      try {
        const sessionId = `rec_${Date.now().toString(36)}`;
        await nativeCaptureStart(sessionId);
        return { kind: "media", source, mediaSession: media, nativeSessionId: sessionId, startedAtMs };
      } catch {
        return { kind: "media", source, mediaSession: media, startedAtMs };
      }
    }
    case "screen-audio":
    case "display":
    case "window": {
      const sessionId = `rec_${Date.now().toString(36)}`;
      await nativeCaptureStart(sessionId);
      return { kind: "native", source, nativeSessionId: sessionId, startedAtMs };
    }
    case "tutorial":
      return { kind: "tutorial", source, startedAtMs };
    default:
      return null;
  }
}

async function stopSession(session: ActiveSession): Promise<{ previewUrl?: string; durationMs: number; outputPath?: string }> {
  const durationMs = Date.now() - session.startedAtMs;
  // 2026-07-19 · IG-COMPOSER-TUT · tutorial session uses the sidecar
  // screen_recording_stop RPC (matches screen_recording_start on start).
  // Single-lane so no MediaRecorder blob to preview · consumers get the
  // output path via the composer:tutorial-recorded bus event fired by
  // the caller after this promise resolves.
  if (session.kind === "tutorial" && session.nativeSessionId) {
    try {
      const stop = await sidecarCall<{
        session_id: string;
        output_path: string;
        size_bytes: number;
        duration_ms: number;
        exit_code: number;
      }>("screen_recording_stop", { session_id: session.nativeSessionId });
      return { durationMs, outputPath: stop.output_path };
    } catch {
      // Best-effort cleanup · caller still gets duration.
      return { durationMs };
    }
  }
  if (session.mediaSession) {
    try {
      const recording = await session.mediaSession.stop();
      const url = URL.createObjectURL(recording.blob);
      // Native session tag-along for screen-mic — best-effort stop.
      if (session.nativeSessionId) {
        try {
          await nativeCaptureStop(session.nativeSessionId);
        } catch { /* ignore · dev mock */ }
      }
      return { previewUrl: url, durationMs };
    } catch {
      return { durationMs };
    }
  }
  if (session.nativeSessionId) {
    try {
      await nativeCaptureStop(session.nativeSessionId);
    } catch { /* ignore */ }
  }
  return { durationMs };
}

export function RecordPanel(props: ParamPanelProps): ReactElement {
  const { visible, onPick } = props;
  const { settings } = useCockpit();
  const [cycleIdx, setCycleIdx] = useState<number>(0);
  const [resolved, setResolved] = useState<SourceValue | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [reaction, setReaction] = useState<ReactionRecordSession | null>(null);
  const [reactionElapsedMs, setReactionElapsedMs] = useState<number>(0);
  const [audioInputs, setAudioInputs] = useState<MediaInputDevice[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; source: SourceValue } | null>(null);
  const cycleTimer = useRef<number | null>(null);

  // Enumerate audio inputs once on mount so the Reaction tile can show
  // the picker. Labels are hidden by the browser until the user grants
  // mic permission at least once — that's a WebRTC privacy default.
  useEffect(() => {
    void enumerateMediaInputs().then(({ audio }) => {
      setAudioInputs(audio);
    });
  }, []);

  // Broadcast the reaction preview state so the Composer canvas can
  // mount ReactionRecordPreview (screen tile + live camera) live.
  useEffect(() => {
    bus.emit("composer:reaction-preview", {
      active: !!reaction,
      layout: reaction?.layout ?? "top-bottom",
      stream: reaction?.camera.stream ?? null,
      elapsedMs: reactionElapsedMs,
    });
  }, [reaction, reactionElapsedMs]);

  // Cycle through tiles on mount · lands on "tutorial" after ~1.2s
  useEffect(() => {
    if (!visible) {
      if (cycleTimer.current) window.clearInterval(cycleTimer.current);
      setCycleIdx(0);
      setResolved(null);
      return;
    }
    let step = 0;
    cycleTimer.current = window.setInterval(() => {
      step += 1;
      setCycleIdx((prev) => (prev + 1) % SOURCES.length);
      if (step >= 6) {
        if (cycleTimer.current) window.clearInterval(cycleTimer.current);
        cycleTimer.current = null;
        setResolved("tutorial");
        setCycleIdx(0);
      }
    }, 160);
    return () => {
      if (cycleTimer.current) window.clearInterval(cycleTimer.current);
      cycleTimer.current = null;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    bus.emit("kade:speak", {
      title: "Record",
      body: "Tutorial pays double · pick your surface.",
      severity: "info",
    });
  }, [visible]);

  // Cleanup any active session when the panel is hidden or unmounted.
  useEffect(() => {
    return () => {
      if (active) {
        void stopSession(active).then((result) => {
          if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickSource = async (source: SourceValue): Promise<void> => {
    setError(null);
    setResolved(source);
    onPick("source", source);
    if (active) {
      const result = await stopSession(active);
      if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
      setActive(null);
    }
    if (reaction) {
      try { await reaction.cancel(); } catch { /* ignore */ }
      setReaction(null);
      setReactionElapsedMs(0);
    }
    if (source === "tutorial") {
      // ═══════════════════════════════════════════════════════════════
      // IRON GATE IG-COMPOSER-TUT · Tutorial recording contract (F2)
      // ─────────────────────────────────────────────────────────────
      // 2026-07-19 · wires the "Tool IS the content" flywheel per the
      // locked memory `liquid_clips_tool_is_the_content_flywheel.md`.
      // Clippers record their session with Kade visible + on-screen
      // watermark → post to TikTok → paid twice (bounty + affiliate MRR).
      //
      // Single-lane: screen only, NO camera (that's the Reaction path).
      // Sidecar `screen_recording_start` writes an ffmpeg avfoundation
      // MP4 to `screenOutputPath`. On stop, `screen_recording_stop`
      // finalises the file and emits `composer:tutorial-recorded` with
      // the output path. Downstream consumers (auto-suggest 3 clips
      // via `pick_more_clips` · post-process watermark burn) hang off
      // that event.
      //
      // On-screen watermark packaging (Kade visible, affiliate URL
      // rendered in-frame) is emitted via `bus.emit("tutorial:active", …)`
      // which the AppShell subscribes to and mounts a corner watermark
      // overlay when active. Zero UI change when inactive.
      // ═══════════════════════════════════════════════════════════════
      setPending(true);
      try {
        const stamp = Date.now();
        const screenOutputPath = `${
          typeof window !== "undefined" && (window as unknown as { __LC_TMP__?: string }).__LC_TMP__
            ? (window as unknown as { __LC_TMP__: string }).__LC_TMP__
            : "/tmp"
        }/lc-tutorial-${stamp}.mp4`;
        const tutorialSession = await sidecarCall<{
          session_id: string;
          output_path: string;
          started_at_ms: number;
        }>("screen_recording_start", {
          output_path: screenOutputPath,
          screen_index: 1,
          audio_index: null, // silent screen record · mic handled by other tiles if needed
          fps: 30,
        });
        setActive({
          kind: "tutorial",
          source,
          nativeSessionId: tutorialSession.session_id,
          startedAtMs: tutorialSession.started_at_ms,
        });
        // Fires the on-screen watermark overlay + Kade-visible mode.
        bus.emit("tutorial:active", {
          active: true,
          output_path: tutorialSession.output_path,
        });
        onPick("tutorial-recording", { output_path: tutorialSession.output_path });
        bus.emit("kade:speak", {
          title: "Recording",
          body: "Rolling · Kade stays visible for the flywheel.",
          severity: "info",
        });
      } catch (err) {
        if (isSidecarUnavailable(err)) {
          setError("tutorial.sidecar_unavailable");
        } else {
          setError(err instanceof Error ? err.message : "tutorial.start_failed");
        }
      } finally {
        setPending(false);
      }
      return;
    }
    if (source === "reaction") {
      setPending(true);
      try {
        const layout = toReactionLayout(settings.reaction.layout);
        const stamp = Date.now();
        const screenOutputPath = `${
          typeof window !== "undefined" && (window as unknown as { __LC_TMP__?: string }).__LC_TMP__
            ? (window as unknown as { __LC_TMP__: string }).__LC_TMP__
            : "/tmp"
        }/lc-reaction-${stamp}.mp4`;
        const session = await startReactionRecording({
          layout,
          audioDeviceId: selectedAudioDeviceId || undefined,
          screenOutputPath,
          onTick: (ms) => setReactionElapsedMs(ms),
        });
        setReaction(session);
        onPick("reaction-recording", { layout, screenOutputPath });
        bus.emit("kade:speak", {
          title: "React",
          body: "Rolling · screen + camera live.",
          severity: "info",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "reaction.start_failed");
      } finally {
        setPending(false);
      }
      return;
    }
    setPending(true);
    try {
      const session = await startForSource(source);
      if (session) setActive(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "record.start_failed");
    } finally {
      setPending(false);
    }
  };

  const onStop = async (): Promise<void> => {
    if (reaction) {
      setPending(true);
      try {
        const result = await reaction.stop();
        // Camera-only URL for the raw take preview until merge finishes.
        const rawUrl = URL.createObjectURL(result.cameraBlob);
        setPreview({ url: rawUrl, source: "reaction" });
        onPick("reaction-recording-stop", {
          layout: reaction.layout,
          durationMs: result.durationMs,
          screenPath: result.screenPath,
        });
        bus.emit("kade:speak", {
          title: "React",
          body: "Cut. Ready to merge.",
          severity: "info",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "reaction.stop_failed");
      } finally {
        setReaction(null);
        setReactionElapsedMs(0);
        setPending(false);
      }
      return;
    }
    if (!active) return;
    setPending(true);
    try {
      const result = await stopSession(active);
      if (result.previewUrl) {
        setPreview({ url: result.previewUrl, source: active.source });
      }
      // IG-COMPOSER-TUT · dedicated bus event + on-screen watermark
      // teardown for the tutorial lane. Consumers (auto-suggest 3 clips
      // via pick_more_clips · marketing pipeline) subscribe to
      // `composer:tutorial-recorded` for the output path. Others get
      // the existing `recording` onPick call for backward compat.
      if (active.kind === "tutorial") {
        bus.emit("tutorial:active", { active: false, output_path: result.outputPath ?? null });
        bus.emit("composer:tutorial-recorded", {
          output_path: result.outputPath ?? null,
          duration_ms: result.durationMs,
        });
        bus.emit("kade:speak", {
          title: "Cut",
          body: result.outputPath
            ? "Tutorial saved · post it to earn double."
            : "Tutorial ended · nothing to post yet.",
          severity: "info",
        });
      }
      onPick("recording", {
        source: active.source,
        durationMs: result.durationMs,
        previewUrl: result.previewUrl ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "record.stop_failed");
    } finally {
      setActive(null);
      setPending(false);
    }
  };

  return (
    <div className="param-panel" data-visible={visible ? "true" : "false"}>
      <div className="param-panel-header">
        <span className="param-panel-eb">F8</span>
        <span className="param-panel-title">Record · Source</span>
        {(active || reaction) && (
          <span
            className="param-rec-pill"
            data-testid="composer-record-pill"
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#ff1a8c",
              color: "#0b0a0f",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0.4,
            }}
          >
            ● REC
            {reaction && (
              <span style={{ marginLeft: 6, fontFamily: "Geist Mono, ui-monospace, monospace" }}>
                {Math.floor(reactionElapsedMs / 60000)}:
                {Math.floor((reactionElapsedMs % 60000) / 1000)
                  .toString()
                  .padStart(2, "0")}
              </span>
            )}
          </span>
        )}
      </div>

      {audioInputs.length > 0 && (
        <div className="param-section">
          <div className="param-section-label">Audio input</div>
          <select
            className="param-input"
            data-testid="composer-record-audio-device"
            value={selectedAudioDeviceId}
            onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
            disabled={pending || !!reaction}
          >
            <option value="">System default</option>
            {audioInputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="param-section">
        <div className="param-section-label">Pick source</div>
        <div className="param-grid">
          {SOURCES.map((s, i) => {
            const picked = resolved === s.value || (resolved == null && cycleIdx === i);
            const activeHere = active?.source === s.value;
            return (
              <button
                key={s.value}
                type="button"
                className={s.wide ? "param-tile param-tile-wide" : "param-tile"}
                data-picked={picked ? "true" : "false"}
                data-active={activeHere ? "true" : "false"}
                data-testid={`composer-record-${s.value}`}
                disabled={pending}
                onClick={() => void pickSource(s.value)}
              >
                {s.label}
                {s.earn ? <span className="param-tile-badge">EARN</span> : null}
              </button>
            );
          })}
        </div>
        {error && (
          <div className="param-record-error" style={{ color: "#ffbe2e", fontSize: 11, marginTop: 6 }}>
            {error}
          </div>
        )}
      </div>

      {(active || reaction) && (
        <div className="param-section">
          <button
            type="button"
            className="param-tile param-tile-wide"
            data-testid="composer-record-stop"
            onClick={() => void onStop()}
            disabled={pending}
            style={{ background: "#0b0a0f", color: "#f4f1ea" }}
          >
            Stop recording
          </button>
        </div>
      )}

      {preview && (
        <div className="param-section">
          <div className="param-section-label">Last take · {preview.source}</div>
          <video
            data-testid="composer-record-preview"
            src={preview.url}
            controls
            style={{ width: "100%", borderRadius: 8 }}
          />
        </div>
      )}
    </div>
  );
}

export default RecordPanel;
