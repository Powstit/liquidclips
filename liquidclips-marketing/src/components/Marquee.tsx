// Text ticker — arcade marquee that runs between sections.
// Default tokens: SUBMIT CLIP · DROP · CLIP · POST · EARN · REPEAT
export function Marquee({
  tokens = [
    "SUBMIT CLIP",
    "DROP VIDEO",
    "CLIP",
    "POST",
    "EARN",
    "REPEAT",
  ],
}: {
  tokens?: string[];
}) {
  const repeated = [...tokens, ...tokens, ...tokens, ...tokens];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {repeated.map((t, i) => (
          <span key={i}>
            <span className="accent">▸</span>
            <span>{t}</span>
            <span className="arrow">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Sprite-fleet marquee — marching pixel Invaders. Used as a visual divider
// alternating with the text Marquee for rhythm.
export function FleetMarquee({ count = 24, size = 28 }: { count?: number; size?: number }) {
  return (
    <div className="fleet-marquee" aria-hidden="true">
      <div className="fleet-track">
        {Array.from({ length: count }).map((_, i) => (
          <img
            key={i}
            src="/brand/invader.png"
            alt=""
            width={size}
            height={size}
            style={{ imageRendering: "pixelated", width: size, height: size }}
          />
        ))}
      </div>
      <div className="fleet-track" aria-hidden="true">
        {Array.from({ length: count }).map((_, i) => (
          <img
            key={i}
            src="/brand/invader.png"
            alt=""
            width={size}
            height={size}
            style={{ imageRendering: "pixelated", width: size, height: size }}
          />
        ))}
      </div>
    </div>
  );
}
