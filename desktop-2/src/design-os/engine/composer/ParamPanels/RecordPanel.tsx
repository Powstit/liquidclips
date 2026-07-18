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
import { startMediaCapture, type MediaCaptureSession } from "../mediaCapture";
import { nativeCaptureStart, nativeCaptureStop } from "../nativeCapture";
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
  | "camera";

interface SourceTile {
  value: SourceValue;
  label: string;
  earn?: boolean;
  wide?: boolean;
}

const SOURCES: ReadonlyArray<SourceTile> = [
  { value: "tutorial", label: "Tutorial · demo Kade", earn: true, wide: true },
  { value: "display", label: "Full screen" },
  { value: "window", label: "Just window" },
  { value: "screen-mic", label: "Screen + mic" },
  { value: "screen-audio", label: "Screen + audio" },
  { value: "camera", label: "Camera only" },
];

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

async function stopSession(session: ActiveSession): Promise<{ previewUrl?: string; durationMs: number }> {
  const durationMs = Date.now() - session.startedAtMs;
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
  const [cycleIdx, setCycleIdx] = useState<number>(0);
  const [resolved, setResolved] = useState<SourceValue | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; source: SourceValue } | null>(null);
  const cycleTimer = useRef<number | null>(null);

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
      // Stop the existing session first so a fast pivot doesn't leak.
      const result = await stopSession(active);
      if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
      setActive(null);
    }
    if (source === "tutorial") {
      // Tutorial doesn't record — just carries intent.
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
    if (!active) return;
    setPending(true);
    try {
      const result = await stopSession(active);
      if (result.previewUrl) {
        setPreview({ url: result.previewUrl, source: active.source });
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
        {active && (
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
          </span>
        )}
      </div>

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

      {active && (
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
