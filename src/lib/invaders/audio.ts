// Pink Invaders · WebAudio synth · v2.2.11
//
// All SFX synthesised at call time — zero audio assets, instant
// load, no licensing concerns. AudioContext lazy-creates on the
// first user gesture so autoplay-policy doesn't drop the first
// laser. Mute state persists in localStorage so the user's choice
// survives reload + replay.
//
// Wave choices:
//   laser    · sawtooth osc swept 880 → 110 Hz over 90 ms · light bandpass
//   hit      · short white-noise burst through lowpass · 140 ms total
//   death    · square 110 → 40 Hz over 320 ms · grunge with low-shelf boost
//   shield   · sine 80 Hz tap · 120 ms with quick attack/release envelope
//   wave_up  · two-tone sine arpeggio · 440 → 660 Hz, 220 ms
//
// Volumes intentionally low (≤ 0.18 peak gain) so the arcade doesn't
// blow ears next to the Liquid Clips workspace audio.

const MUTE_KEY = "lc.invaders.mute.v1";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(next: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* private mode · ignore */
  }
}

export function toggleMuted(): boolean {
  const next = !isMuted();
  setMuted(next);
  return next;
}

/** Prime the AudioContext on first user gesture. Required by Chrome
 *  autoplay policy — without this the first SFX after the page loads
 *  is dropped. Safe to call multiple times. */
export function primeAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") {
    void c.resume();
  }
}

function tone(opts: {
  freqStart: number;
  freqEnd: number;
  durationMs: number;
  type: OscillatorType;
  peakGain: number;
  filterType?: BiquadFilterType;
  filterFreq?: number;
}): void {
  if (isMuted()) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const dur = opts.durationMs / 1000;

  const osc = c.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(opts.freqEnd, 20),
    now + dur,
  );

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(opts.peakGain, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  let lastNode: AudioNode = osc;
  if (opts.filterType) {
    const filter = c.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(opts.filterFreq ?? 1200, now);
    filter.Q.value = 0.8;
    osc.connect(filter);
    lastNode = filter;
  }

  lastNode.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}

function noiseBurst(opts: {
  durationMs: number;
  filterFreq: number;
  peakGain: number;
}): void {
  if (isMuted()) return;
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const dur = opts.durationMs / 1000;
  const bufSize = Math.max(2, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(opts.filterFreq, now);
  filter.Q.value = 1;

  const gain = c.createGain();
  gain.gain.setValueAtTime(opts.peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  src.connect(filter).connect(gain).connect(c.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}

export function sfxLaser(): void {
  tone({
    freqStart: 880,
    freqEnd: 110,
    durationMs: 90,
    type: "sawtooth",
    peakGain: 0.12,
    filterType: "bandpass",
    filterFreq: 1400,
  });
}

export function sfxHit(): void {
  noiseBurst({ durationMs: 140, filterFreq: 1600, peakGain: 0.16 });
}

export function sfxDeath(): void {
  tone({
    freqStart: 110,
    freqEnd: 40,
    durationMs: 320,
    type: "square",
    peakGain: 0.18,
    filterType: "lowshelf",
    filterFreq: 200,
  });
  noiseBurst({ durationMs: 380, filterFreq: 600, peakGain: 0.14 });
}

export function sfxShieldThud(): void {
  tone({
    freqStart: 80,
    freqEnd: 60,
    durationMs: 120,
    type: "sine",
    peakGain: 0.16,
  });
}

export function sfxWaveUp(): void {
  tone({
    freqStart: 440,
    freqEnd: 660,
    durationMs: 110,
    type: "sine",
    peakGain: 0.12,
  });
  // Second tone scheduled 130 ms later for a rising arpeggio feel.
  window.setTimeout(() => {
    tone({
      freqStart: 660,
      freqEnd: 880,
      durationMs: 130,
      type: "sine",
      peakGain: 0.12,
    });
  }, 130);
}
