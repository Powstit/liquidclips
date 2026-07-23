/**
 * CompletionChime · Web Audio "clips are ready" payoff.
 *
 * Listens on the bus for `composer:celebrate` (fired by useComposerBrain
 * when the pipeline finishes) and plays a satisfying two-note chime.
 * Also listens on `engine:progress` and plays a subtle "tick" on stage
 * transitions so the user hears the bus moving between stops.
 *
 * All tones are synthesised via Web Audio API — no audio asset shipped,
 * no external dependency, no autoplay-block on user-gesture-required
 * browsers because the sound only plays after a user submits a command.
 *
 * 2026-07-22 · Sprint mockup-parity-1 · added at Daniel's request
 * ("add sound also") so the golden path has an audible completion
 * signal, not just visible ones.
 */

import { useEffect, useRef } from "react";
import { useEvent } from "../bridge/useEvent";

const MUTE_KEY = "lc.composer.mute";

function shouldPlay(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) !== "1";
  } catch {
    return true;
  }
}

/** Ensure we have a resumed AudioContext (browsers block until user gesture). */
async function getContext(ref: { current: AudioContext | null }): Promise<AudioContext | null> {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") return null;
  if (!ref.current) ref.current = new AudioContext();
  if (ref.current.state === "suspended") {
    try { await ref.current.resume(); } catch { /* silent */ }
  }
  return ref.current;
}

/** Play a single tone via a fresh oscillator + gain envelope. */
function tone(ctx: AudioContext, freq: number, startOffset: number, dur: number, gain: number): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t = ctx.currentTime + startOffset;
  // Linear attack-then-exponential-release envelope so tones sound like
  // a soft mallet strike, not a square-wave beep.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

async function playCelebrationChime(ref: { current: AudioContext | null }): Promise<void> {
  if (!shouldPlay()) return;
  const ctx = await getContext(ref);
  if (!ctx) return;
  // C6 → E6 → G6 · classic "success" arpeggio.
  tone(ctx, 1046.5, 0.00, 0.34, 0.16);
  tone(ctx, 1318.5, 0.10, 0.34, 0.16);
  tone(ctx, 1568.0, 0.20, 0.44, 0.18);
}

async function playStageTick(ref: { current: AudioContext | null }): Promise<void> {
  if (!shouldPlay()) return;
  const ctx = await getContext(ref);
  if (!ctx) return;
  // Single soft high-frequency tick — audible but non-intrusive.
  tone(ctx, 1760.0, 0, 0.08, 0.05);
}

export function CompletionChime(): null {
  const ctxRef = useRef<AudioContext | null>(null);
  const lastStageRef = useRef<string | null>(null);

  // Celebration chime on pipeline complete.
  useEvent("composer:celebrate", () => {
    void playCelebrationChime(ctxRef);
  });

  // Subtle tick when the pipeline advances to a new stage.
  useEvent("engine:progress", (payload: { stage?: string } | null | undefined) => {
    const stage = payload?.stage;
    if (!stage) return;
    if (stage !== lastStageRef.current) {
      lastStageRef.current = stage;
      void playStageTick(ctxRef);
    }
  });

  useEffect(() => {
    // Prime the AudioContext on first user gesture in the window so the
    // celebration chime doesn't have to await context-resume mid-play.
    // Suspends until the first click/keydown — safe against autoplay
    // policy on Chromium + WebView2 + Tauri WebView.
    const prime = () => {
      void getContext(ctxRef);
      window.removeEventListener("click", prime);
      window.removeEventListener("keydown", prime);
    };
    window.addEventListener("click", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("click", prime);
      window.removeEventListener("keydown", prime);
      // Best-effort cleanup on unmount — helps HMR + route swaps.
      const c = ctxRef.current;
      if (c && c.state !== "closed") void c.close().catch(() => { /* silent */ });
      ctxRef.current = null;
    };
  }, []);

  // Silence any future emissions before unmount so the next composer
  // mount starts with a fresh stage tracker.
  useEffect(() => () => { lastStageRef.current = null; }, []);

  return null;
}

/** Toggle sound on/off. Callers persist to localStorage; the next
 *  chime attempt reads it. Returns the new muted state. */
export function toggleComposerMute(): boolean {
  try {
    const cur = window.localStorage.getItem(MUTE_KEY) === "1";
    const next = !cur;
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    return next;
  } catch {
    return false;
  }
}
export function isComposerMuted(): boolean {
  try { return window.localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export default CompletionChime;
