/**
 * MockComposer · pixel-1:1 mockup rendered as native React JSX (2026-07-19)
 *
 * Prior version embedded `/mockup-composer.html` inside an iframe and
 * relayed 8 event types over postMessage. That worked for a visual walk
 * but blocked React from feeding data INTO the mockup (transcript strip,
 * clip stack, reactions, video source, etc). Sprint 4 killed the iframe.
 *
 * Today MockComposer is a thin typed wrapper that:
 *   1. Forwards the same `MockComposerProps` interface downstream so
 *      `Composer.tsx` (L735-762) keeps its existing callback wiring —
 *      no changes needed at the call site.
 *   2. Adds `onNavClick` so navigation clicks can flow through the app's
 *      `bus.emit("nav:click", …)` from inside a single React tree
 *      (previously `postMessage` → `navLabelToRoute` handled it here;
 *      the label→RouteId map now lives inside `MockComposerBody`).
 *   3. Mounts `<MockComposerBody />` which owns the full mockup DOM +
 *      scoped `MockComposer.css`.
 *
 * The `/mockup-composer.html` file is retained as a backup reference for
 * the mockup design; no runtime code loads it any more.
 */

import { MockComposerBody } from "./MockComposerBody";
import type {
  MockComposerBrief,
  MockComposerCaptionStyle,
  MockComposerClipCard,
  MockComposerTranscriptWord,
} from "./MockComposerBody";
import type { RouteId } from "../bridge";

interface MockComposerProps {
  /** Called when the user submits a command in the mockup's input bar. */
  onCommand?: (text: string) => void;
  /**
   * Called when the user clicks a nav item (Home / Create / Clips / …).
   * Composer.tsx forwards this to `bus.emit("nav:click", { route })`.
   */
  onNavClick?: (route: RouteId) => void;
  /** Called when the user clicks a mockup layout button. */
  onLayoutSet?: (layout: string) => void;
  /** Called when the user clicks a mockup mode button. */
  onModeSet?: (mode: "kade" | "classic") => void;
  /** Called when the user clicks a mockup speed button (1× / 2× / 5×). */
  onSpeedSet?: (speed: 1 | 2 | 5) => void;
  /** Called when the user clicks the mockup turbo toggle. */
  onTurboToggle?: () => void;
  /**
   * Called when the user clicks an A/B/C/D slot letter inside `.slot-grid`.
   * The host runtime forwards this to `selectSlot(letter)`
   * (`desktop-2/src/design-os/engine/composer/SlotGrid.tsx`), which emits
   * the `composer:slot-select` bus event.
   */
  onSlotSelect?: (letter: "A" | "B" | "C" | "D") => void;
  /**
   * S5 · Called when the user clicks the SHIP button in the command area.
   * Composer.tsx wires this to `submitCommand("ship this clip")` so the
   * intent router owns the outcome.
   */
  onShip?: () => void;
  /**
   * S7 · Preview URL for the focused clip. When set, `.video-area`
   * renders a real `<video>` instead of the demo fixture.
   */
  videoSrc?: string | null;
  /**
   * S8 · Transcript words for the strip below the video. Falls back to
   * a demo fixture when null so the idle canvas stays theatrical.
   */
  transcriptWords?: MockComposerTranscriptWord[];
  /**
   * S9 · Clip cards for `.clip-stack`. Falls back to the demo fixture
   * when null.
   */
  clips?: MockComposerClipCard[];
  /**
   * S11 · Caption preview text, sourced from `settings.caption.text`.
   */
  captionText?: string;
  /**
   * S11 · Caption preview style, sourced from `settings.caption.style`.
   * Forwarded as `data-style` on `.fake-caption` so the mockup CSS
   * variant kicks in.
   */
  captionStyle?: MockComposerCaptionStyle;
  /**
   * S12 · Campaign brief. When set the `.brief-card` renders the real
   * tag/title/rules; null falls back to the demo fixture.
   */
  brief?: MockComposerBrief | null;
  /** Real canvas-loaded state · hides the idle greeting when true. */
  canvasLoaded?: boolean;
  /** Real aspect state. */
  canvasAspect?: "9:16" | "16:9" | "1:1";
  /** Real layout state. */
  canvasLayoutMode?: "single" | "split-vertical" | "split-horizontal" | "grid-2x2";
  /** Real active mode (Kade / Classic) — drives HUD mode-btn highlight. */
  activeMode?: "kade" | "classic";
  /** Real active speed (1× / 2× / 5×) — drives HUD speed-btn highlight. */
  activeSpeed?: 1 | 2 | 5;
  /** Real turbo on/off — drives HUD turbo highlight. */
  turboActive?: boolean;
  /** Current router route — drives nav-item highlight. */
  activeRoute?: RouteId;
}

export function MockComposer(props: MockComposerProps): JSX.Element {
  return <MockComposerBody {...props} />;
}
