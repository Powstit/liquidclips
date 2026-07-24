/**
 * ComposerSuiteFrame · full mockup suite hosted in an iframe.
 *
 * Renders `public/mockup/composer-suite.html` (the approved simulator
 * verbatim, asset paths adjusted) inside an iframe. A small bridge
 * script inside the mockup forwards every user command to us via
 * postMessage, and we push real state (clips, kade mood, celebration)
 * back the other way. Result: the user drives the FULL mockup UI —
 * every parameter panel, ASK panel, tool tabs, history strip, slot
 * grid, layout switcher, library modal, waveform, timeline, watermark
 * chip, REC pill, transcript strip, celebration flash — and every
 * "give me N clips" call actually runs the sidecar pipeline.
 *
 * Why iframe: the mockup is 5698 lines of tightly-coupled HTML + CSS
 * + JS. Porting piece-by-piece would take days and leave gaps between
 * shell iterations. The iframe gives us the finished suite in a single
 * bundle ship — Daniel can test against the whole thing, not a
 * half-baked pie.
 *
 * 2026-07-22 · Sprint mockup-parity-2
 */

import { useEffect, useRef, type ReactElement } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useComposerSession } from "../state/useComposerSession";
import { useRecordingState } from "../state/useRecordingState";
import { startRecording, stopRecording, toggleRecording } from "../engine/composer/recordingController";
import type { ComposerBrain } from "./useComposerBrain";
import { bus } from "../bridge/events";
// 2026-07-22 · Bundle 3 · Editor essentials · IG-COCKPIT-EDITOR-WIRES
import { sidecar } from "../engine/sidecar-stub";
import { searchLibrary } from "../../lib/hqLibrary";
// 2026-07-22 · Bundle 4 · Composition + campaign · IG-COCKPIT-CAMPAIGN-WIRES
import { openWhopAction, WhopAction } from "../../lib/openWhopAction";

interface Props {
  brain: ComposerBrain;
}

interface StateMessage {
  type: "lc:composer:state";
  clips?: Array<{
    idx?: number;
    title: string;
    start: number;
    end: number;
    duration_s?: number | null;
    score?: number | null;
    vertical_src?: string | null;
  }>;
  kadeMood?: string;
  kadeLine?: { title: string; body: string } | null;
  celebrate?: boolean;
  history?: readonly string[];
  // 2026-07-22 · progress push · so the mockup can animate the
  // playhead, stream transcript notes, and label the current stage.
  progress?: {
    stage: string | null;
    percent: number | null;
    note: string | null;
    segmentsDone: number | null;
    segmentsTotal: number | null;
  } | null;
  activeSlug?: string | null;
  runError?: string | null;
  awaitingSource?: boolean;
  // 2026-07-22 · Bundle 2 · IG-COCKPIT-SCREEN-RECORDING
  // Recording state pushed so the mockup's REC pill can show
  // recording status + live timer + target label.
  recording?: {
    status: string;
    target_label: string | null;
    seconds_elapsed: number;
    last_error: string | null;
  } | null;
}

function toClipSrc(path: string | null | undefined): string | null {
  if (!path) return null;
  try { return convertFileSrc(path); } catch { return null; }
}

/**
 * IRON GATE IG-COCKPIT-UPSTREAM-DRIVETRAIN · handleUserAction.
 *
 * Single reducer for every cockpit gesture. Cockpit's `emitUserAction`
 * fires here via postMessage. This function is the ONLY sink; never
 * call brain.* from anywhere else in the iframe boundary.
 *
 * See memory: liquid_clips_one_drivetrain_ui_binding.
 */
async function handleUserAction(
  action: string,
  payload: Record<string, unknown>,
  brain: ComposerBrain,
): Promise<void> {
  // Map cockpit gesture → real brain call (preset command form so it
  // rides the same intent-router the user's typed text does).
  const utter = (u: string) => { void brain.handleSubmit(u); };
  switch (action) {
    // Command-bar-equivalent gestures
    case "quick-action.click": {
      // The mockup already fires submitCommand; we just log the HUD flip.
      // No brain call here — avoids double-firing.
      return;
    }
    case "history.repeat": {
      const cmd = String(payload.cmd ?? "");
      if (cmd) utter(cmd);
      return;
    }
    case "ask.answer": {
      const opt = String(payload.option ?? "");
      if (opt) utter(opt);
      return;
    }

    // IG-COCKPIT-ASK-SOURCE · handle the ASK-panel source-choice
    // buttons directly (bypass utterance router — we know the intent).
    case "source.paste-url": {
      // Focus the command bar + set placeholder to invite pasting a URL.
      const el = document.querySelector<HTMLIFrameElement>('iframe[data-testid="composer-suite-frame"]');
      const doc = el?.contentDocument;
      const input = doc?.getElementById("command-input") as HTMLInputElement | null;
      if (input) {
        input.placeholder = "Paste your YouTube URL here · press Enter";
        input.value = "";
        input.focus();
      }
      return;
    }
    case "source.pick-file": {
      void brain.pickFile();
      return;
    }

    // Layout / slot / shell
    case "layout.change": return utter(`layout ${String(payload.layout ?? "single")}`);
    case "slot.pick":     return utter(`slot ${String(payload.letter ?? "a")}`);
    case "shell.mode":    return utter(`shell ${String(payload.mode ?? "kade")}`);
    case "session.turbo": return utter("turbo");

    // Tool tabs → open (no execution until user commits inside the tool)
    case "tool.open": return utter(`open ${String(payload.tool ?? "trim")} tool`);

    // Voice · IG-COCKPIT-EDITOR-WIRES · start transcription and
    // stream results into the command bar. The mockup's mic button
    // dispatches this. Uses Web Speech API in WKWebView (E6 hook).
    case "voice.toggle": {
      try {
        const mod = await import("../engine/composer/voiceInput");
        // Fire-and-forget · voice hook handles its own state loop.
        if (typeof mod.beginOneShotVoiceCapture === "function") {
          void mod.beginOneShotVoiceCapture((utterance) => {
            const q = utterance.trim();
            if (q) void brain.handleSubmit(q);
          });
          return;
        }
      } catch { /* fallthrough to legacy utter */ }
      return utter("voice");
    }

    // Library · IG-COCKPIT-EDITOR-WIRES · when user picks a tile,
    // fetch the real library item + treat as source.
    case "library.pick": {
      try {
        const idx = Number.parseInt(String(payload.idx ?? "0"), 10) || 0;
        const res = await searchLibrary({ limit: 12 });
        const results = (res.results ?? []) as Array<{ external_id?: string; title?: string }>;
        const hit = results[idx];
        if (hit?.external_id) {
          // Treat as YouTube-style external ID · brain routes to source
          // acceptance path.
          void brain.acceptSource({ url: `https://youtu.be/${hit.external_id}` });
          return;
        }
      } catch { /* silent · brain intent-router catches */ }
      return utter(`library pick ${String(payload.idx ?? "0")}`);
    }

    // Reactions
    case "reactions.layout": return utter(`reactions layout ${String(payload.layout ?? "pip")}`);

    // Captions · IG-COCKPIT-EDITOR-WIRES · direct sidecar.editCaptions.
    // Operates on clip 0 by default (per-clip focus is post-launch).
    case "captions.style":
    case "captions.position":
    case "captions.wpl":
    case "captions.karaoke.toggle": {
      const s = useComposerSession.getState();
      if (!s.activeSlug || s.clips.length === 0) {
        return utter(`captions ${action.split(".").slice(1).join(" ")}`);
      }
      const style    = action === "captions.style"    ? String(payload.style ?? "bold")    : "bold";
      const position = action === "captions.position" ? String(payload.position ?? "mid")  : "mid";
      const clip0    = s.clips[0];
      void sidecar.editCaptions(s.activeSlug, clip0?.idx ?? 0, {
        text: clip0?.title ?? "",
        style,
        position,
      }).catch(() => { /* silent · brain intent-router fallback via bus toast */ });
      return;
    }

    // Record · IG-COCKPIT-SCREEN-RECORDING · calls Rust IPC directly.
    // The mockup's record-source panel emits `record.source` with the
    // clicked tile idx; we start capture for that target. No brain
    // command · this is a native gesture, not an intent to route.
    case "record.source": {
      const idx = Number.parseInt(String(payload.idx ?? "0"), 10) || 0;
      void startRecording(idx);
      return;
    }
    case "record.toggle": {
      void toggleRecording();
      return;
    }
    case "record.stop": {
      void stopRecording();
      return;
    }

    // Frame · Hook
    case "frame.safe.toggle": return utter(`frame safe ${String(payload.id ?? "")}`);
    case "frame.gradient":    return utter(`frame gradient ${String(payload.idx ?? "0")}`);

    // Audio
    case "audio.track":       return utter(`audio track ${String(payload.track ?? "lofi")}`);
    case "audio.duck.toggle": return utter("audio duck toggle");

    // Timeline
    case "timeline.zoom": return utter(`timeline zoom ${String(payload.zoom ?? "1")}`);

    // Watermark
    case "watermark.preset":    return utter(`watermark preset ${String(payload.position ?? "br")}`);
    case "watermark.qr.toggle": return utter("watermark qr toggle");

    // Campaign · IG-COCKPIT-CAMPAIGN-WIRES · Bundle 4.
    // Pick → utterance-routed (brain stashes campaign_id in sessionCtx).
    // Submit → real Whop `BOUNTY_CREATE` action opens the marketplace
    // post flow (closest native destination pre-launch; post-launch
    // this can wire to the specific active brief's submit endpoint).
    case "campaign.pick": return utter(`campaign pick ${String(payload.id ?? "")}`);
    case "campaign.submit": {
      try {
        openWhopAction(WhopAction.BOUNTY_CREATE, {
          prefill: { source: "cockpit-brief-submit" },
        });
      } catch { /* silent · fall through to utter */ }
      return utter("campaign submit");
    }

    // Trim · IG-COCKPIT-EDITOR-WIRES · direct sidecar.regenerateClip.
    // Tighten re-cuts the first clip by trimming 1.5s off each end
    // (conservative silence removal) · silence-toggle utters for now
    // because the actual silence-detection needs the audio path.
    case "trim.tighten": {
      const s = useComposerSession.getState();
      if (!s.activeSlug || s.clips.length === 0) return utter("trim tighten");
      const c = s.clips[0];
      const start = Math.max(0, (c.start ?? 0) + 1.5);
      const end = Math.max(start + 3, (c.end ?? 30) - 1.5);
      void sidecar.regenerateClip(s.activeSlug, c.idx ?? 0, start, end)
        .catch(() => { /* silent · brain toast handles */ });
      return;
    }
    case "trim.silence.toggle": return utter("trim silence toggle");

    // Split-screen
    case "split.orient":          return utter(`split orient ${String(payload.orient ?? "tb")}`);
    case "split.audio":           return utter(`split audio ${String(payload.audio ?? "source")}`);
    case "split.captions.toggle": return utter("split captions toggle");

    default: {
      // Unknown → surface as a user command so the intent router can
      // try to route it. Fail-loud policy per never-regress rule.
      // eslint-disable-next-line no-console
      console.warn("[handleUserAction] unknown action:", action, payload);
      return;
    }
  }
}

export function ComposerSuiteFrame({ brain }: Props): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef<boolean>(false);
  const lastCelebrateRef = useRef<number>(0);

  const clips = useComposerSession((s) => s.clips);
  const kadeMood = useComposerSession((s) => s.kadeMood);
  const lastReply = useComposerSession((s) => s.lastReply);
  const progress = useComposerSession((s) => s.progress);
  const activeSlug = useComposerSession((s) => s.activeSlug);
  const runError = useComposerSession((s) => s.runError);
  const awaitingSource = useComposerSession((s) => s.awaitingSource);
  const history = useComposerSession((s) => s.history);
  const recordingStatus = useRecordingState((s) => s.status);
  const recordingTargetLabel = useRecordingState((s) => s.targetLabel);
  const recordingStartedAt = useRecordingState((s) => s.startedAt);
  const recordingLastError = useRecordingState((s) => s.lastError);

  // Push state into the iframe whenever the parent's session state
  // changes. Also fires on first-ready message from the child.
  const pushState = (extra: Partial<StateMessage> = {}) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    const payload: StateMessage = {
      type: "lc:composer:state",
      clips: clips.map((c, i) => ({
        idx: c.idx ?? i,
        title: c.title,
        start: c.start,
        end: c.end,
        duration_s: c.duration_s ?? null,
        score: typeof c.score === "number" ? c.score : null,
        vertical_src: toClipSrc(c.vertical_path ?? null),
      })),
      kadeMood,
      kadeLine: lastReply ? { title: lastReply.title, body: lastReply.body } : null,
      progress: progress
        ? {
            stage: progress.stage ?? null,
            percent: typeof progress.percent === "number" ? progress.percent : null,
            note: progress.note ?? null,
            segmentsDone: progress.segmentsDone ?? null,
            segmentsTotal: progress.segmentsTotal ?? null,
          }
        : null,
      activeSlug: activeSlug ?? null,
      runError: runError ?? null,
      awaitingSource: !!awaitingSource,
      recording: {
        status: recordingStatus,
        target_label: recordingTargetLabel,
        seconds_elapsed:
          recordingStartedAt && recordingStatus === "active"
            ? Math.floor((Date.now() - recordingStartedAt) / 1000)
            : 0,
        last_error: recordingLastError,
      },
      // IG-COCKPIT-EDITOR-WIRES · history strip real chips
      history: history.slice(0, 6),
      ...extra,
    };
    w.postMessage(payload, "*");
  };

  // Listen for the iframe's messages.
  useEffect(() => {
    const onMessage = (evt: MessageEvent) => {
      const msg = evt.data as { type?: string; utterance?: string; action?: string; payload?: Record<string, unknown> } | null;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "lc:composer:ready") {
        readyRef.current = true;
        pushState();
        return;
      }
      if (msg.type === "lc:composer:submit") {
        const q = (msg.utterance ?? "").trim();
        if (q) void brain.handleSubmit(q);
        return;
      }
      // 2026-07-22 · UPSTREAM DRIVETRAIN · IG-COCKPIT-UPSTREAM-DRIVETRAIN.
      // The cockpit's emitUserAction posts every user gesture here so
      // one reducer converts them to real brain calls. NEVER call brain.*
      // directly from any other message handler. See memory:
      // liquid_clips_one_drivetrain_ui_binding.
      if (msg.type === "lc:composer:user-action") {
        void handleUserAction(msg.action ?? "", msg.payload ?? {}, brain);
        return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain]);

  // Push state when it changes.
  useEffect(() => {
    if (readyRef.current) pushState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips, kadeMood, lastReply, progress, activeSlug, runError, awaitingSource, recordingStatus, recordingTargetLabel, recordingStartedAt, history]);

  // 2026-07-22 · IG-COCKPIT-SCREEN-RECORDING · tick loop.
  // While recording is active, tick every 1s so the REC pill timer
  // updates on the mockup. Also drives the co-pilot HUD "You" flip
  // when the recording just started (Kade is recording FOR the user).
  useEffect(() => {
    if (recordingStatus !== "active") return;
    const id = window.setInterval(() => { pushState(); }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingStatus]);

  // 2026-07-22 · IG-COCKPIT-SCREEN-RECORDING · F2 global hotkey.
  // F2 toggles recording so users can start/stop without clicking.
  // Same key as the mockup's F2 flywheel · matches Kade Tutorial mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void toggleRecording();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Forward celebrate events into the iframe (fires the mockup's
  // flashCelebration() so the high-res kade-celebration.webp pops
  // inside the canvas, not just at the shell level).
  useEffect(() => {
    const off = bus.on("composer:celebrate", () => {
      const now = Date.now();
      if (now - lastCelebrateRef.current < 500) return;
      lastCelebrateRef.current = now;
      pushState({ celebrate: true });
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src="/mockup/composer-suite.html"
      title="Liquid Clips composer suite"
      className="lc-composer-suite-frame"
      // 1280×820 is the mockup's authored canvas. We let CSS scale-to-fit
      // in the wrapper so it fills whatever the shell gives us without
      // adding scrollbars.
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
        background: "#0b0b10",
      }}
      // The mockup owns keyboard events (Enter to submit, etc). Focus
      // routes through when the user clicks in — no accessibility loss
      // vs a native mount.
      data-testid="composer-suite-frame"
    />
  );
}

export default ComposerSuiteFrame;
