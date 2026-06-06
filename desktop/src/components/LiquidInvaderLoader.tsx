import invaderSrc from "../assets/icons/connections/library-bug.png";

// Liquid Invader loader — the brand-signature loading state.
//
// Renders the pixel Invader sprite as an alpha mask, with a fuchsia liquid
// that fills from the bottom in a 1.8s loop. Used wherever the user clicks
// a button and the next surface isn't instant (upload portal open, ingest
// kick-off, sidecar startup, settings probe, payout fetch).
//
// Why not the multiplying-fleet loader? That one signals "many things
// queuing." This one signals "the bug is filling up — about to spawn."
// Pick this for single-action "we heard you, hang on" moments.

export function LiquidInvaderLoader({
  size = 48,
  label,
  inline = false,
}: {
  size?: number;
  /** Optional caption shown under the loader. Mono, tracking-wide. */
  label?: string;
  /** Inline = horizontal compact (logo+label in a row). Default is stacked. */
  inline?: boolean;
}) {
  // CSS mask keeps the Invader silhouette as the only visible part of the
  // fuchsia fill — works in webview + Safari (mask-image needs both prefixes).
  const maskStyle: React.CSSProperties = {
    width: size,
    height: size,
    WebkitMaskImage: `url(${invaderSrc})`,
    maskImage: `url(${invaderSrc})`,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    position: "relative",
    overflow: "hidden",
    flexShrink: 0,
  };

  const Spinner = (
    <div style={maskStyle} role="img" aria-label={label || "Loading"}>
      {/* Dim empty silhouette behind the rising liquid so the user can see the
          Invader outline even at 0% fill. */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(255, 26, 140, 0.18)" }} />
      {/* Rising fuchsia fill — clip-path animates from bottom up, wobble adds the "liquid" feel. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, #ff66b8 0%, #ff1a8c 60%, #c70066 100%)",
          animation: "lc-liquid-rise 1.8s ease-in-out infinite",
          filter: "drop-shadow(0 0 8px rgba(255, 26, 140, 0.55))",
        }}
      />
      {/* Surface highlight — a tiny meniscus moving with the fill */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, transparent 80%, rgba(255, 143, 203, 0.9) 86%, transparent 92%)",
          animation: "lc-liquid-rise 1.8s ease-in-out infinite",
          mixBlendMode: "screen",
        }}
      />
      <style>{`
        @keyframes lc-liquid-rise {
          0%   { transform: translateY(100%); }
          15%  { transform: translateY(85%); }
          50%  { transform: translateY(12%); }
          85%  { transform: translateY(0%); }
          100% { transform: translateY(-12%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-loader="liquid-invader"] * { animation: none !important; }
        }
      `}</style>
    </div>
  );

  if (!label) return <span data-loader="liquid-invader">{Spinner}</span>;

  return (
    <span
      data-loader="liquid-invader"
      style={{
        display: "inline-flex",
        flexDirection: inline ? "row" : "column",
        alignItems: "center",
        gap: inline ? 10 : 12,
      }}
    >
      {Spinner}
      <span
        style={{
          fontFamily: "var(--font-mono, JetBrains Mono), monospace",
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary, #8a857e)",
        }}
      >
        {label}
      </span>
    </span>
  );
}
