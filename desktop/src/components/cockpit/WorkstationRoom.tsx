// v0.7.78 — Workstation room (LC 9.6 Studio Home pivot).
//
// The empty-view surface that App.tsx mounts inside RoomShell. Studio
// Home (../workspace/StudioHome) now owns the header + four-tile intent
// router per the LC 9.6 directive. WorkstationRoom continues to own
// everything that does NOT belong inside Studio Home: the sponsored
// carousel below the tiles, the inline drop-error toast, the
// drag-hover full-room overlay, and the IG-008 BottomCockpit clearance
// contract.
//
// Public API (props) is preserved verbatim so App.tsx mounts unchanged.
// Props that no longer drive rendering (`displayName`, `isCold`,
// `onProjects`, `projectsCount`) are kept on the type for back-compat
// and renamed in destructure with a leading underscore to satisfy
// `noUnusedParameters: true`. They can be dropped from the public API
// in a follow-up pass once App.tsx stops passing them.

import { motion, AnimatePresence } from "motion/react";
import { SponsoredBannerCarousel } from "../earn/SponsoredBannerCarousel";
import { StudioHome } from "../workspace/StudioHome";

export function WorkstationRoom({
  onCreate,
  onImport,
  onThumbnails,
  onScript,
  onProjects: _onProjects,
  projectsCount: _projectsCount = null,
  dragHoverActive = false,
  dropError = null,
  userTier = null,
  remainingExports = null,
  importing = false,
  displayName: _displayName = null,
  isCold: _isCold = false,
}: {
  /** Single-click Create: opens the compact URL/file portal. The portal
   *  auto-focuses its URL input — no second click to start typing. */
  onCreate: () => void;
  /** Single-click Import: fires the OS file picker directly. No modal in
   *  between — the picker IS the next surface. */
  onImport: () => void;
  /** Opens the ThumbnailStudio modal when wired by the parent (App.tsx). */
  onThumbnails?: () => void;
  /** v0.7.78 — kept for back-compat with App.tsx; Projects is reached via
   *  the side nav only in LC 9.6. Not rendered as a central tile. */
  onProjects?: () => void;
  /** v0.7.78 — kept for back-compat; no longer surfaced. */
  projectsCount?: number | null;
  /** Opens the lift_transcript pipeline when wired by the parent. */
  onScript?: () => void;
  /** P0 #5 — driven by App.tsx's tauri://drag-enter/leave listeners. When
   *  true, the room renders a dashed cyan drop affordance with a "Drop a
   *  video to start" hint so the user has a visible target. */
  dragHoverActive?: boolean;
  /** P0 #6 — ephemeral error from a rejected drop (e.g. unsupported file
   *  type). Auto-cleared by App.tsx after 4s. */
  dropError?: string | null;
  /** Drives the SponsoredBannerCarousel mounted below the tiles — tier
   *  controls which campaigns show as locked vs unlocked. */
  userTier?: "free" | "solo" | "pro" | "agency" | null;
  /** P1 — free/paid quota surface. `null` means paid/unlimited; a number is
   *  the free user's remaining exports. Used to render the quota pill. */
  remainingExports?: number | null;
  /** ship-lens v0.7.13 T1.3 — true while handleImportDirect is in flight
   *  (OS file picker open OR sidecar.importReadyClips running). Forwarded
   *  to StudioHome so the Import tile dims + shows a "preparing…" pill. */
  importing?: boolean;
  /** v0.7.78 — kept for back-compat; LC 9.6 locked the headline to
   *  "Studio's open." for everyone, so personalisation no longer drives
   *  the hero copy. */
  displayName?: string | null;
  /** v0.7.78 — kept for back-compat; same reason as displayName. */
  isCold?: boolean;
}) {
  return (
    // ───── IRON GATE IG-008 (v0.7.43) — see docs/IRON_GATES.md ─────
    // pb-48 (192px) is the BottomCockpit clearance. BottomCockpit is fixed
    // at bottom-0 (IG-005/006) and overlays anything below this padding.
    // Without pb-48, the lower content (StudioHome drop hint, sponsored
    // carousel) sits underneath the cockpit chrome and becomes unreachable.
    // Do not reduce below pb-40 without measuring the live cockpit height
    // on the smallest supported window.
    <div className="workstation-room flex w-full flex-col items-center justify-center gap-12 pt-12 pb-48">
      <StudioHome
        onCreate={onCreate}
        onImport={onImport}
        onThumbnails={onThumbnails}
        onScript={onScript}
        importing={importing}
        userTier={userTier}
        remainingExports={remainingExports}
      />

      {/* v0.7.1 — Sponsored rewards banners surface on the home screen
          too, not just the Earn page. Reads campaigns from the live
          backend; renders skeleton on load + an honest retry tile on
          failure. Tier prop gates which banners show as locked. */}
      <div className="w-full max-w-[1080px] px-4">
        <SponsoredBannerCarousel tier={userTier} />
      </div>

      {/* P0 #6 — inline ephemeral error for rejected drops. Mounted under
          the tiles so it doesn't push the centered layout around. */}
      <AnimatePresence>
        {dropError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            role="alert"
            className="rounded-full border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-2 font-mono text-[11px] text-[var(--color-danger)]"
          >
            {dropError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* P0 #5 — Visible drop affordance. Mounted as a full-room overlay so a
          user dragging a file from Finder sees an explicit target instead of
          a blank surface. Cyan dashed border (cockpit accent), centered hint,
          and the Invader sprite as the "drop here" landmark.
          pointer-events-none so it never steals clicks from the tiles when a
          ghost drag event lingers. */}
      <AnimatePresence>
        {dragHoverActive && (
          <motion.div
            data-drop-target="workstation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="pointer-events-none fixed inset-4 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed border-cyan-400 bg-cyan-400/5 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              {/* Invader sprite as the landmark — simple inline SVG so we
                  don't have to plumb the canvas/sprite asset over from the
                  invaders module. Matches the splash game's geometric
                  invader look. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 16"
                className="h-10 w-14 fill-cyan-400 drop-shadow-[0_0_18px_rgba(34,211,238,0.65)]"
              >
                <rect x="3" y="2" width="2" height="2" />
                <rect x="19" y="2" width="2" height="2" />
                <rect x="5" y="4" width="14" height="2" />
                <rect x="3" y="6" width="2" height="2" />
                <rect x="7" y="6" width="2" height="2" />
                <rect x="15" y="6" width="2" height="2" />
                <rect x="19" y="6" width="2" height="2" />
                <rect x="3" y="8" width="18" height="2" />
                <rect x="5" y="10" width="2" height="2" />
                <rect x="9" y="10" width="6" height="2" />
                <rect x="17" y="10" width="2" height="2" />
                <rect x="1" y="12" width="2" height="2" />
                <rect x="7" y="12" width="2" height="2" />
                <rect x="15" y="12" width="2" height="2" />
                <rect x="21" y="12" width="2" height="2" />
              </svg>
              <span className="font-mono text-[12px] uppercase tracking-[0.24em] text-cyan-300">
                Drop a video to start
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/70">
                MP4 · MOV · MKV · WEBM · AVI · M4V · MP3 · M4A · WAV
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
