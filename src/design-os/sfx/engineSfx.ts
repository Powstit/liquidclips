/**
 * engineSfx · BUG-029.1
 *
 * Three SFX hooks bound to the engine bus events:
 *   1. clip-generation-started — engine:progress with stage=ingest, percent
 *      ≈ 0 (first emit per session).
 *   2. clip-batch-complete    — engine:complete with kind=bake or pick
 *      (the moment Workstation flips to "complete").
 *   3. export-complete/error  — engine:complete kind=export / engine:error
 *      kind=export.
 *
 * Pure Web Audio synth — no external assets, no native bridge. Lazily
 * creates the AudioContext on first event so we don't trip autoplay
 * gates before user interaction. Gated by `localStorage.lc-sfx-muted`
 * so the user can silence the cockpit without a server round-trip.
 *
 * No engine, Python, or sidecar changes — listens to bus events that
 * already exist (BUG-026, BUG-027 emit paths). UI-only.
 */

import { bus } from "../bridge";

let ctx: AudioContext | null = null;
let lastStartedAt = 0;

function isMuted(): boolean {
  try {
    return window.localStorage.getItem("lc-sfx-muted") === "1";
  } catch {
    return false;
  }
}

function ac(): AudioContext | null {
  if (isMuted()) return null;
  if (!ctx) {
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Play a sequence of (freq, durationMs, startOffsetMs, peakGain) tones. */
function playSequence(
  notes: ReadonlyArray<{ f: number; ms: number; t: number; g?: number }>,
  type: OscillatorType = "sine",
): void {
  const a = ac();
  if (!a) return;
  const now = a.currentTime;
  for (const n of notes) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(n.f, now + n.t / 1000);
    const peak = n.g ?? 0.18;
    gain.gain.setValueAtTime(0.0001, now + n.t / 1000);
    gain.gain.exponentialRampToValueAtTime(peak, now + n.t / 1000 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (n.t + n.ms) / 1000);
    osc.connect(gain).connect(a.destination);
    osc.start(now + n.t / 1000);
    osc.stop(now + (n.t + n.ms) / 1000 + 0.04);
  }
}

function playGenerationStarted(): void {
  playSequence(
    [
      { f: 523.25, ms: 120, t: 0 },
      { f: 783.99, ms: 180, t: 90 },
    ],
    "triangle",
  );
}

function playBatchComplete(): void {
  playSequence(
    [
      { f: 523.25, ms: 140, t: 0 },
      { f: 659.25, ms: 140, t: 100 },
      { f: 783.99, ms: 220, t: 200 },
      { f: 1046.5, ms: 320, t: 320, g: 0.22 },
    ],
    "triangle",
  );
}

function playExportComplete(): void {
  playSequence(
    [
      { f: 880.0, ms: 90, t: 0 },
      { f: 1318.5, ms: 280, t: 60, g: 0.22 },
    ],
    "sine",
  );
}

function playExportError(): void {
  playSequence(
    [
      { f: 220, ms: 180, t: 0, g: 0.22 },
      { f: 165, ms: 260, t: 140, g: 0.22 },
    ],
    "sawtooth",
  );
}

/**
 * Mount this once near the top of the Workstation route. Returns an
 * unsubscribe so React's useEffect can clean it up on unmount.
 */
export function attachEngineSfx(): () => void {
  const offProgress = bus.on("engine:progress", (p) => {
    // First emit of a new run: stage=ingest with percent close to 0.
    // Debounce so we don't double-fire on rapid heartbeats.
    const elapsed = Date.now() - lastStartedAt;
    if (p.stage === "ingest" && elapsed > 4_000) {
      lastStartedAt = Date.now();
      playGenerationStarted();
    }
  });
  const offComplete = bus.on("engine:complete", (p) => {
    if (p.kind === "bake" || p.kind === "pick") playBatchComplete();
    else if (p.kind === "export") playExportComplete();
  });
  const offError = bus.on("engine:error", (p) => {
    if (p.kind === "export") playExportError();
  });

  return () => {
    offProgress();
    offComplete();
    offError();
  };
}
