// Splash-stage avatar · `imageSrc` first (PixelLab pixel-art portrait) +
// initials-in-coloured-circle fallback. Same component shape as the
// TopHud avatar pill so the leaderboard reads as part of the same
// surface. The imageSrc fallback path means a future user model with
// `avatarUrl` can drop in without touching call sites.

type AvatarProps = {
  name: string;
  size?: number;
  imageSrc?: string;
};

const HUES = [
  "#FF1A8C",
  "#00E5FF",
  "#FF66B8",
  "#9333EA",
  "#22D3EE",
  "#F472B6",
  "#8B5CF6",
  "#06B6D4",
];

function hueFromName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s_\-/]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const camel = trimmed.match(/[A-Z][a-z]*/g);
  if (camel && camel.length >= 2) return (camel[0][0] + camel[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export function Avatar({ name, size = 28, imageSrc }: AvatarProps) {
  if (imageSrc) {
    return (
      <img
        className="splash-avatar splash-avatar-img"
        data-testid="splash-avatar"
        src={imageSrc}
        alt={name}
        aria-label={name}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          background: "rgba(255,255,255,0.04)",
          imageRendering: "pixelated",
          flexShrink: 0,
          userSelect: "none",
        }}
      />
    );
  }
  const bg = hueFromName(name);
  return (
    <div
      className="splash-avatar"
      data-testid="splash-avatar"
      aria-label={name}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#FFFFFF",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.4),
        fontWeight: 700,
        fontFamily: "sans-serif",
        userSelect: "none",
        flexShrink: 0,
        letterSpacing: "0.02em",
      }}
    >
      {initials(name)}
    </div>
  );
}
