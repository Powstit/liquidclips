/**
 * AgencyOverlay props · 2026-07-05
 *
 * Renders an alpha-channel WebM overlay to composite over an exported
 * clip via ffmpeg. Not a full-frame render — the compositor puts the
 * overlay ON TOP of the clip's actual video content.
 */

export type OverlayPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center-top"
  | "center-bottom";

export type OverlayMotion =
  | "static"          // no animation · logo shows for the whole clip
  | "fade-in-out"     // fades in over 0.6s · holds · fades out over 0.6s at end
  | "corner-pulse"    // stays in corner · gentle scale pulse every 3s
  | "slide-in-left"   // slides in from off-screen left · holds · slides out
  | "lower-third";    // slides up from bottom · shows text below logo · slides out

export interface AgencyOverlayProps {
  /** Public URL or absolute local path to the agency logo (PNG or SVG).
   *  When running via Remotion CLI the path can be a `file://` URL or a
   *  serve-relative URL. The composition uses staticFile() for paths
   *  under public/ · direct URLs otherwise. */
  logoUrl: string;

  /** Where the logo sits inside the 1080x1920 alpha frame. Vertical
   *  video is the desktop app's default output format · matches
   *  tiktok/reels/shorts. Horizontal exports use the same overlay
   *  centered per the caller's positioning. */
  position: OverlayPosition;

  /** Motion preset. Static = no animation (pure logo overlay). */
  motion: OverlayMotion;

  /** Optional text beneath the logo · shown by lower-third preset ·
   *  ignored by others. Usually the agency handle like "@atlas-clips". */
  text: string | null;

  /** Total overlay duration in frames · usually matches the underlying
   *  clip's frame count so the overlay covers the whole export. Defaults
   *  to 300 (10s @ 30fps) for local previews. */
  durationInFrames: number;
}

export const AGENCY_OVERLAY_DEFAULT_PROPS: AgencyOverlayProps = {
  logoUrl: "https://picsum.photos/seed/agency-logo/256/256",
  position: "bottom-right",
  motion: "corner-pulse",
  text: "@agency",
  durationInFrames: 300,
};
