/**
 * mediaCapture · Composer Class D · getUserMedia-backed camera + mic + preview.
 *
 * ⚠ IRON GATE IG-COMPOSER-FF · Media capture contract.
 *
 * Verified via WebFetch (2026-07-18) — Tauri 2 WKWebView on macOS
 * supports `navigator.mediaDevices.getUserMedia()` for camera + mic
 * (needs NSCameraUsageDescription + NSMicrophoneUsageDescription in
 * Info.plist). This module covers:
 *
 *   * D3 camera capture (getUserMedia({ video: true }))
 *   * D2 mic capture (getUserMedia({ audio: true }))
 *   * D4 countdown + live preview (client-side timer + <video>)
 *
 * D1 (screen), D2 (system audio), D5 (multi-monitor) require the Rust
 * scap crate — see src-tauri/src/screen_capture.rs + the client
 * wrapper in `nativeCapture.ts` (IG-COMPOSER-GG).
 *
 * Reference: Tauri issue #2338 confirms the display-share browser API
 * is broken on Tauri WKWebView / macOS; getUserMedia works.
 */

export interface MediaCaptureRecording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface StartRecordingOpts {
  video?: boolean;
  audio?: boolean;
  /** Preferred mime · defaults to a webm variant supported by MediaRecorder. */
  mimeType?: string;
  /** Optional preview <video> element the stream is piped into. */
  previewEl?: HTMLVideoElement | null;
}

export interface MediaCaptureSession {
  stream: MediaStream;
  stop: () => Promise<MediaCaptureRecording>;
  cancel: () => void;
}

/** Feature-detect the pieces we need. Returns `false` in node / SSR test
 *  environments where navigator + MediaRecorder are undefined. */
export function isMediaCaptureAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof MediaRecorder === "undefined") return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return false;
  }
  return true;
}

/** Best-effort mime pick · returns the first MediaRecorder-supported
 *  mime from a preference list. Fallback stays undefined so the
 *  browser picks its own default. */
export function pickMimeType(preferred?: string): string | undefined {
  if (typeof MediaRecorder === "undefined") return preferred;
  const candidates = [
    preferred,
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ].filter((m): m is string => !!m);
  for (const m of candidates) {
    if (typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return undefined;
}

/** Start a camera / mic capture session. Returns a stop() Promise that
 *  resolves to a Blob when recording finishes. Cancel discards without
 *  resolving the recording. */
export async function startMediaCapture(opts: StartRecordingOpts): Promise<MediaCaptureSession> {
  if (!isMediaCaptureAvailable()) {
    throw new Error("mediaCapture.unavailable");
  }
  const constraints: MediaStreamConstraints = {
    video: opts.video === false ? false : true,
    audio: opts.audio === false ? false : true,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  if (opts.previewEl) {
    opts.previewEl.srcObject = stream;
    opts.previewEl.muted = true;
    void opts.previewEl.play();
  }
  const mimeType = pickMimeType(opts.mimeType);
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  const startedAt = Date.now();
  recorder.addEventListener("dataavailable", (event) => {
    const anyEvent = event as unknown as { data?: Blob };
    if (anyEvent.data && anyEvent.data.size > 0) chunks.push(anyEvent.data);
  });
  recorder.start(250); // request a chunk every 250 ms so a mid-stream stop doesn't lose data

  let stopped = false;

  const stop = (): Promise<MediaCaptureRecording> =>
    new Promise((resolve, reject) => {
      if (stopped) return reject(new Error("mediaCapture.already_stopped"));
      stopped = true;
      recorder.addEventListener(
        "stop",
        () => {
          const type = recorder.mimeType || mimeType || "video/webm";
          const blob = new Blob(chunks, { type });
          stream.getTracks().forEach((t) => t.stop());
          if (opts.previewEl) {
            opts.previewEl.srcObject = null;
          }
          resolve({ blob, mimeType: type, durationMs: Date.now() - startedAt });
        },
        { once: true },
      );
      try {
        recorder.stop();
      } catch (err) {
        reject(err);
      }
    });

  const cancel = () => {
    if (stopped) return;
    stopped = true;
    try {
      recorder.stop();
    } catch { /* ignore */ }
    stream.getTracks().forEach((t) => t.stop());
    if (opts.previewEl) opts.previewEl.srcObject = null;
  };

  return { stream, stop, cancel };
}

/** Countdown before a recording starts. Returns a Promise that resolves
 *  when the countdown finishes (after `seconds` seconds). onTick fires
 *  each second with the remaining value (`seconds` → 1). Cancel via
 *  the returned cancel() to abort mid-count. */
export interface CountdownController {
  done: Promise<void>;
  cancel: () => void;
}

export function startCountdown(seconds: number, onTick: (remaining: number) => void): CountdownController {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reject_: (err: Error) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    reject_ = reject;
    let remaining = Math.max(0, Math.floor(seconds));
    const step = () => {
      if (cancelled) {
        reject(new Error("countdown.cancelled"));
        return;
      }
      if (remaining <= 0) {
        resolve();
        return;
      }
      onTick(remaining);
      remaining -= 1;
      timer = setTimeout(step, 1000);
    };
    step();
  });
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (timer) clearTimeout(timer);
    // Reject synchronously so callers awaiting done resolve without
    // waiting for the next scheduled step to detect the cancel flag.
    reject_(new Error("countdown.cancelled"));
  };
  return { done, cancel };
}
