/**
 * TutorialWatermarkOverlay · IG-COMPOSER-TUT · Tool-IS-the-content flywheel
 *
 * Renders a fixed-position `liquidclips.app/r/{whop_username}` badge in
 * the bottom-right corner while the user is running a Tutorial-mode
 * recording. The user's screencapture picks it up as pixels — so any
 * clip they post to TikTok already carries their affiliate link
 * without any post-process step. Zero UI when not recording.
 *
 * Locked memory: `liquid_clips_tool_is_the_content_flywheel.md`
 *   "Watermark stays visible in-frame · don't hide Kade during recording ·
 *    auto-suggest 3 clips from every Kade session."
 *
 * This component ONLY handles the watermark. The other two rules
 * (Kade stays visible; auto-suggest 3 clips) live elsewhere:
 *   - Kade visibility · StickyKade / KadeIgnition — no hide-during-
 *     recording branch exists, so it stays visible by default.
 *   - Auto-suggest 3 clips · downstream consumer of
 *     `composer:tutorial-recorded` bus event · not wired in this batch.
 */

import { useEffect, useState, type ReactElement } from "react";
import { bus } from "../bridge";
import { useMe } from "../state/useMe";

export function TutorialWatermarkOverlay(): ReactElement | null {
  const [active, setActive] = useState<boolean>(false);
  const me = useMe();

  useEffect(() => {
    const off = bus.on("tutorial:active", (p) => {
      setActive(!!p?.active);
    });
    return () => { try { off(); } catch { /* noop */ } };
  }, []);

  if (!active) return null;

  // Prefer Whop username / handle from the me snapshot. Fall back to a
  // generic prefix so the badge never renders `undefined`. The clipper
  // hasn't set a handle yet? The URL still resolves at the marketing
  // site to the Agency signup flow — better than a broken watermark.
  const handle = me.snapshot?.handle ?? "join";
  const referralUrl = `liquidclips.app/r/${handle}`;

  return (
    <div
      className="lc-tutorial-watermark"
      data-testid="tutorial-watermark-overlay"
      role="img"
      aria-label={`Liquid Clips referral watermark · ${referralUrl}`}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 999999,
        // Semi-transparent slab so screencapture picks up crisp text
        // over dark AND light backgrounds. No motion — motion is a red
        // flag on screencaptured content (users assume it's an ad).
        background: "rgba(11, 11, 22, 0.72)",
        color: "#f4f1ea",
        padding: "8px 14px",
        borderRadius: 999,
        fontFamily: '"Geist Mono", ui-monospace, "SF Mono", monospace',
        fontSize: 12,
        letterSpacing: "0.06em",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid rgba(255, 26, 140, 0.4)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
        // High contrast · never accidentally invisible on the wrong
        // Composer backdrop. `pointer-events: none` so the badge never
        // steals clicks from the user's screencapture path.
        pointerEvents: "none",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#ff1a8c",
          boxShadow: "0 0 6px #ff1a8c",
        }}
        aria-hidden
      />
      <span>{referralUrl}</span>
    </div>
  );
}
