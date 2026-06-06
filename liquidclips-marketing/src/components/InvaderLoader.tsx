"use client";

// Multiplying-fleet loader — the brand-signature loading state.
// Starts with 1 Invader, spawns more in sequence à la 1978 attract mode.
// Used wherever the user waits: page transitions, /download OS-detect,
// FitScorer scoring, anywhere idle > ~200ms.
export function InvaderLoader({ count = 6, size = 18 }: { count?: number; size?: number }) {
  return (
    <span className="invader-loader" role="status" aria-live="polite" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <img
          key={i}
          src="/brand/invader.png"
          alt=""
          width={size}
          height={size}
          className="invader"
          style={{ imageRendering: "pixelated", width: size, height: size }}
        />
      ))}
    </span>
  );
}
