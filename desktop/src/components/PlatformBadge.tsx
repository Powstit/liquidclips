// ship-lens v0.7.14: PlatformBadge
// Round icon badge showing connected social media platform(s) per clip.
// Used on ClipCard (bottom-right) and ClipWindow (top-right).

import { Youtube, Instagram, Twitter, Linkedin, Facebook } from "lucide-react";

export type PlatformId = "youtube" | "tiktok" | "instagram" | "x" | "linkedin" | "facebook";

const PLATFORM_META: Record<PlatformId, { icon: React.ComponentType<{ className?: string }>; color: string; label: string }> = {
  youtube: { icon: Youtube, color: "#FF0000", label: "YouTube" },
  tiktok: { icon: () => null, color: "#00f2ea", label: "TikTok" }, // TikTok has no Lucide icon, we use text
  instagram: { icon: Instagram, color: "#E1306C", label: "Instagram" },
  x: { icon: Twitter, color: "#000000", label: "X" },
  linkedin: { icon: Linkedin, color: "#0A66C2", label: "LinkedIn" },
  facebook: { icon: Facebook, color: "#1877F2", label: "Facebook" },
};

interface PlatformBadgeProps {
  platforms: PlatformId[];
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function PlatformBadge({ platforms, size = "sm", showLabel = false }: PlatformBadgeProps) {
  if (!platforms || platforms.length === 0) return null;

  const sizeMap = { sm: 18, md: 22, lg: 28 };
  const s = sizeMap[size];

  return (
    <div className="flex items-center gap-1">
      {platforms.map((p) => {
        const meta = PLATFORM_META[p];
        if (!meta) return null;
        const Icon = meta.icon;

        return (
          <div
            key={p}
            className="grid place-items-center rounded-full shadow-sm ring-1 ring-white/10"
            style={{
              width: s,
              height: s,
              backgroundColor: meta.color,
            }}
            title={meta.label}
          >
            {p === "tiktok" ? (
              <span className="font-display text-[8px] font-bold text-white">T</span>
            ) : (
              <span
                className="flex items-center justify-center text-white"
                style={{ width: s * 0.55, height: s * 0.55 }}
              >
                <Icon className="h-full w-full" />
              </span>
            )}
          </div>
        );
      })}
      {showLabel && platforms.length > 0 && (
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-tertiary">
          {platforms.length > 1 ? `${platforms.length} platforms` : PLATFORM_META[platforms[0]]?.label}
        </span>
      )}
    </div>
  );
}

/** PlatformBadgePicker — used in ClipPreview to assign platforms to a clip */
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
          const meta = PLATFORM_META[p];
          const isActive = selected.includes(p);
          const Icon = meta.icon;

          return (
            <button
              key={p}
              onClick={() => onToggle(p)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 font-sans text-[12px] transition-all ${
                isActive
                  ? "font-medium text-white shadow-sm"
                  : "border border-line bg-transparent text-text-secondary hover:text-ink"
              }`}
              style={isActive ? { backgroundColor: meta.color } : undefined}
            >
              {p === "tiktok" ? (
                <span className="font-display text-[10px] font-bold">T</span>
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
