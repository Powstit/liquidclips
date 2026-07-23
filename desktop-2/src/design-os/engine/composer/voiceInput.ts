/**
 * voiceInput · Composer Sprint 3 E6 · mic → command bar transcription.
 *
 * ⚠ IRON GATE IG-COMPOSER-V · Voice input contract.
 *
 * Two-lane transcription:
 *   1. Primary · Web Speech API (window.SpeechRecognition) · native to
 *      the Tauri webview · zero sidecar round-trip · streams partial
 *      results as the user speaks.
 *   2. Fallback · MediaRecorder → Blob → sidecar faster-whisper-tiny
 *      RPC (TODO: `sidecar_transcribe_blob`). Fires only when Web
 *      Speech is unavailable OR the caller opts into forceSidecar.
 *
 * The hook does NOT own the command bar text — it hands the final
 * transcript to the caller's onTranscribed handler so the parent
 * (Composer.tsx) inserts / submits as it sees fit.
 *
 * Master plan reference: COMPOSER_MASTER_PLAN.md § 5 Class E row E6.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceInputState = "idle" | "listening" | "transcribing" | "error";

export interface UseVoiceInputOpts {
  onTranscribed: (text: string) => void;
  /** Force the sidecar Whisper path even when Web Speech is available.
   *  Useful for tests + for accuracy-critical retakes. */
  forceSidecar?: boolean;
}

export interface UseVoiceInputReturn {
  state: VoiceInputState;
  supported: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/** Runtime check: is the Web Speech API available in this webview? */
export function isWebSpeechAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as typeof window & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

interface MinimalSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

function newRecognition(): MinimalSpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    SpeechRecognition?: new () => MinimalSpeechRecognition;
    webkitSpeechRecognition?: new () => MinimalSpeechRecognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  return new Ctor();
}

/**
 * 2026-07-22 · IG-COCKPIT-EDITOR-WIRES · one-shot voice capture.
 *
 * Fire-and-forget helper used by the ComposerSuiteFrame's
 * `voice.toggle` upstream case. Starts recognition, calls `onResult`
 * with the final transcript, then auto-stops. Safe to call in
 * environments without Web Speech (silently returns false).
 */
export function beginOneShotVoiceCapture(onResult: (transcript: string) => void): boolean {
  const rec = newRecognition();
  if (!rec) return false;
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = "en-US";
  rec.onresult = (evt) => {
    try {
      const t = readTranscript(evt);
      if (t) onResult(t);
    } catch { /* silent */ }
  };
  rec.onerror = () => { try { rec.stop(); } catch { /* silent */ } };
  rec.onend = () => { /* auto-stop · nothing to clean up */ };
  try { rec.start(); return true; } catch { return false; }
}

/** Extract the concatenated transcript from a Web Speech result event. */
export function readTranscript(event: unknown): string {
  if (event === null || event === undefined || typeof event !== "object") return "";
  const e = event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> };
  const results = e.results;
  if (!results) return "";
  let out = "";
  for (let i = 0; i < results.length; i++) {
    const first = results[i]?.[0];
    if (first?.transcript) out += first.transcript;
  }
  return out.trim();
}

export function useVoiceInput(opts: UseVoiceInputOpts): UseVoiceInputReturn {
  const [state, setState] = useState<VoiceInputState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const supported = isWebSpeechAvailable() || !opts.forceSidecar;

  const onTranscribedRef = useRef(opts.onTranscribed);
  useEffect(() => {
    onTranscribedRef.current = opts.onTranscribed;
  }, [opts.onTranscribed]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* rec may already be stopped */
      }
      recognitionRef.current = null;
    }
    setState("idle");
  }, []);

  const start = useCallback(() => {
    setError(null);
    if (opts.forceSidecar || !isWebSpeechAvailable()) {
      // Fallback lane · sidecar Whisper RPC. Not yet wired — surface a
      // recoverable error so the caller can flip back to keyboard.
      setState("error");
      setError("sidecar transcription not yet wired · type instead");
      return;
    }
    const rec = newRecognition();
    if (!rec) {
      setState("error");
      setError("voice input unavailable in this browser");
      return;
    }
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (event) => {
      const text = readTranscript(event);
      if (text.length > 0) {
        onTranscribedRef.current(text);
      }
      setState("idle");
    };
    rec.onerror = (event) => {
      const errObj = event as { error?: string };
      setState("error");
      setError(errObj.error ?? "voice input error");
    };
    rec.onend = () => {
      setState((prev) => (prev === "listening" ? "idle" : prev));
    };
    recognitionRef.current = rec;
    setState("listening");
    try {
      rec.start();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "voice input start failed");
    }
  }, [opts.forceSidecar]);

  useEffect(() => {
    // Cleanup on unmount · don't leak an active recognition session.
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return { state, supported, error, start, stop };
}
