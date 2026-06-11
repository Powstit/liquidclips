// v0.7.32 — PlatformBadge using brand-official solid glyphs.
//
// Previously rendered lucide-react outline icons (Youtube/Instagram/Twitter
// stroke-based glyphs) at 28×28. Drifted from docs/clip-dashboard-demo.html
// L107-111 + L850-854 SOCIAL_SVG block which specifies:
//   - 34×34 rounded square (border-radius 10px)
//   - solid brand SVGs filled white (camera silhouette for IG, music note for
//     TT, play box for YT, X wordmark for X)
//   - IG gradient background, TT/X solid #000, YT solid #FF0000
//   - 1.5px solid rgba(255,255,255,0.22) border + soft shadow
//
// This file is now the single source of truth for the badge visual. Used by
// ClipCard, ClipWindow, and PlatformBadgePicker. No lucide-react dependency.
import type { ChannelStatus } from "../lib/backend";
import { ConnectionDot } from "./platforms/ConnectionDot";

export type PlatformId = "youtube" | "tiktok" | "instagram" | "x" | "linkedin" | "facebook" | "threads";

// Brand background per the mockup. IG is a gradient (corner-to-corner Instagram
// brand pattern); the rest are solid hex.
const BRAND_BG: Record<PlatformId, string> = {
  youtube: "#FF0000",
  tiktok: "#000000",
  instagram: "linear-gradient(135deg, #FED373, #F15245 50%, #D92E7F)",
  x: "#000000",
  linkedin: "#0A66C2",
  facebook: "#1877F2",
  threads: "#000000",
};

const BRAND_LABEL: Record<PlatformId, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  threads: "Threads",
};

// Solid brand glyphs — copied verbatim from clip-dashboard-demo.html L850-854.
// Every path is `fill="currentColor"` so the parent controls color (we always
// pass white via the inline style on the wrapper). viewBox is 24×24.
export function PlatformGlyph({ id, className }: { id: PlatformId; className?: string }) {
  switch (id) {
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden className={className}>
          <path d="M12 2c2.717 0 3.056.01 4.122.06 1.065.05 1.79.217 2.428.465.66.254 1.216.598 1.772 1.153a4.908 4.908 0 0 1 1.153 1.772c.247.637.415 1.363.465 2.428.047 1.066.06 1.405.06 4.122 0 2.717-.01 3.056-.06 4.122-.05 1.065-.218 1.79-.465 2.428a4.883 4.883 0 0 1-1.153 1.772 4.915 4.915 0 0 1-1.772 1.153c-.637.247-1.363.415-2.428.465-1.066.047-1.405.06-4.122.06-2.717 0-3.056-.01-4.122-.06-1.065-.05-1.79-.218-2.428-.465a4.89 4.89 0 0 1-1.772-1.153 4.904 4.904 0 0 1-1.153-1.772c-.248-.637-.415-1.363-.465-2.428C2.013 15.056 2 14.717 2 12c0-2.717.01-3.056.06-4.122.05-1.066.217-1.79.465-2.428a4.88 4.88 0 0 1 1.153-1.772A4.897 4.897 0 0 1 5.45 2.525c.638-.248 1.362-.415 2.428-.465C8.944 2.013 9.283 2 12 2zm0 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm6.5-.25a1.25 1.25 0 0 0-2.5 0 1.25 1.25 0 0 0 2.5 0zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden className={className}>
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z" />
        </svg>
      );
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden className={className}>
          <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.13C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.52A3.02 3.02 0 0 0 .5 6.2C0 8.07 0 12 0 12s0 3.93.5 5.8a3.02 3.02 0 0 0 2.12 2.13c1.88.52 9.38.52 9.38.52s7.5 0 9.38-.52a3.02 3.02 0 0 0 2.12-2.13c.5-1.87.5-5.8.5-5.8s0-3.93-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden className={className}>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden>
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" aria-hidden>
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
  }
}

interface PlatformBadgeProps {
  platforms: PlatformId[];
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  /** v0.7.45 — When provided, each badge renders as a clickable button that
   *  calls onClick with the platform id. Used by ClipCard to route to
   *  Schedule → Channels. */
  onClick?: (platform: PlatformId) => void;
  /** v0.8.0 — Connection state per platform. Shows a dot overlay. */
  connectionStatus?: Partial<Record<PlatformId, ChannelStatus | "no-channel" | "loading">>;
}

export function PlatformBadge({ platforms, size = "sm", showLabel = false, onClick, connectionStatus }: PlatformBadgeProps) {
  if (!platforms || platforms.length === 0) return null;

  // sm = 34 matches the mockup's `.social-pip` (clip-dashboard-demo.html L107).
  // md/lg keep the same 50% glyph ratio.
  const sizeMap = { sm: 34, md: 40, lg: 46 };
  const s = sizeMap[size];
  const glyph = Math.round(s * 0.5);
  const radius = Math.round(s * 0.294); // ≈ 10px at 34px

  return (
    <div className="flex items-center gap-1.5">
      {platforms.map((p) => {
        const badge = (
          <div
            key={p}
            className="relative grid place-items-center shadow-[0_4px_14px_rgba(0,0,0,0.55)]"
            style={{
              width: s,
              height: s,
              borderRadius: radius,
              border: "1.5px solid rgba(255,255,255,0.22)",
              color: "white",
              ...(BRAND_BG[p].startsWith("linear-gradient")
                ? { background: BRAND_BG[p] }
                : { backgroundColor: BRAND_BG[p] }),
            }}
            title={BRAND_LABEL[p]}
          >
            <span style={{ width: glyph, height: glyph, display: "flex" }}>
              <PlatformGlyph id={p} />
            </span>
            {connectionStatus?.[p] && (
              <span className="absolute -top-0.5 -right-0.5">
                <ConnectionDot status={connectionStatus[p]} />
              </span>
            )}
          </div>
        );
        if (!onClick) return badge;
        return (
          <button
            key={p}
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick(p); }}
            className="grid place-items-center rounded-[10px] shadow-[0_4px_14px_rgba(0,0,0,0.55)] transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-fuchsia"
            style={{
              width: s,
              height: s,
              border: "1.5px solid rgba(255,255,255,0.22)",
              color: "white",
              ...(BRAND_BG[p].startsWith("linear-gradient")
                ? { background: BRAND_BG[p] }
                : { backgroundColor: BRAND_BG[p] }),
            }}
            title={`Route to ${BRAND_LABEL[p]}`}
            aria-label={`Route to ${BRAND_LABEL[p]}`}
          >
            <span style={{ width: glyph, height: glyph, display: "flex" }}>
              <PlatformGlyph id={p} />
            </span>
          </button>
        );
      })}
      {showLabel && platforms.length > 0 && (
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
          {platforms.length > 1 ? `${platforms.length} platforms` : BRAND_LABEL[platforms[0]]}
        </span>
      )}
    </div>
  );
}

/** PlatformBadgePicker — used in ClipPreview to assign platforms to a clip.
 *  Pill toggle list — selected platforms render with brand colour fill, others
 *  render as outlined chips. Matches mockup PILL spec but keeps the picker's
 *  multi-select affordance separate from the per-clip stack rendering. */
export function PlatformBadgePicker({
  selected,
  onToggle,
}: {
  selected: PlatformId[];
  onToggle: (p: PlatformId) => void;
}) {
  const all: PlatformId[] = ["youtube", "tiktok", "instagram", "x", "linkedin", "facebook"];

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
        Connected platforms
      </span>
      <div className="flex flex-wrap gap-2">
        {all.map((p) => {
          const isActive = selected.includes(p);
          return (
            <button
              key={p}
              onClick={() => onToggle(p)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-[12px] transition-all ${
                isActive ? "font-medium text-white shadow-sm" : "border border-line bg-transparent text-text-secondary hover:text-ink"
              }`}
              style={
                isActive
                  ? BRAND_BG[p].startsWith("linear-gradient")
                    ? { background: BRAND_BG[p] }
                    : { backgroundColor: BRAND_BG[p] }
                  : undefined
              }
            >
              <span
                style={{ display: "inline-flex", width: 14, height: 14, color: isActive ? "white" : "currentColor" }}
              >
                <PlatformGlyph id={p} />
              </span>
              {BRAND_LABEL[p]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

