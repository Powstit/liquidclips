/**
 * KadeSpeechBubble · troubleshooting affordance · 2026-06-30
 *
 * Mounts as a sibling of StickyKade inside DesignOSAppShell. Listens
 * to the kade:speak bus event and renders a fixed-position bubble
 * anchored near Kade's typical placement zones. Auto-dismisses after
 * 12s or on click; replaced in place by any fresh kade:speak payload.
 *
 * Mood is owned by StickyKade (kade:mood event). The bubble lives in
 * its own component so it can render conditionally without re-rendering
 * the Kade portrait every time a toast fires. AppShell mounts the
 * bubble alongside StickyKade behind the same hideStickyKade gate.
 *
 * Hard rules:
 *   - Never throws.
 *   - Never blocks input on the rest of the UI · pointer-events: auto
 *     ONLY on the bubble itself, the absolute layer below is none.
 *   - Self-dismisses · the user is never forced to interact.
 *   - In the v2.2.7 baseline the Workstation route hides StickyKade
 *     entirely (phase === "complete"). When Kade is hidden, the
 *     bubble must also stay hidden · enforced at the AppShell mount
 *     boundary, not here.
 */

import { useEffect, useState } from "react";
import { bus, useEvent } from "../bridge";
import "./KadeSpeechBubble.css";

type Severity = "info" | "warn" | "error";

interface Speech {
  title: string;
  body: string;
  severity: Severity;
  expiresAt: number;
}

const SPEECH_TTL_MS = 12_000;

export function KadeSpeechBubble(): React.ReactElement | null {
  const [speech, setSpeech] = useState<Speech | null>(null);

  useEvent("kade:speak", (p) => {
    setSpeech({
      title: p.title,
      body: p.body,
      severity: p.severity ?? "warn",
      expiresAt: Date.now() + SPEECH_TTL_MS,
    });
  });

  useEvent("kade:dismiss", () => {
    setSpeech(null);
  });

  /* Auto-dismiss timer · clears every time speech changes so a stale
   * timer never closes a fresh bubble. */
  useEffect(() => {
    if (!speech) return;
    const remaining = Math.max(0, speech.expiresAt - Date.now());
    const id = window.setTimeout(() => setSpeech(null), remaining);
    return () => window.clearTimeout(id);
  }, [speech]);

  if (!speech) return null;

  const onClick = () => {
    setSpeech(null);
    /* Reset Kade's mood back to idle so the alert outline + pulse stop
     * the moment the bubble closes. Speak + mood are decoupled · they
     * just usually co-emit from AppShell's error listener. */
    bus.emit("kade:mood", { mood: "idle" });
  };

  return (
    <div
      className={`lc-kade-bubble-layer lc-kade-bubble-${speech.severity}`}
      data-testid="kade-speech-bubble"
      data-severity={speech.severity}
    >
      <button
        type="button"
        className="lc-kade-bubble"
        onClick={onClick}
        aria-label={`Dismiss · ${speech.title}`}
      >
        <span className="lc-kade-bubble-eb">Kade · noticed something</span>
        <span className="lc-kade-bubble-title">{speech.title}</span>
        <span className="lc-kade-bubble-body">{speech.body}</span>
        <span className="lc-kade-bubble-foot">Tap to dismiss</span>
      </button>
    </div>
  );
}
