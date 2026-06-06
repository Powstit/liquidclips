import Link from "next/link";

// Primary brand mark — pixel Invader sitting on a neon plate beside the
// LIQUID/CLIPS mono wordmark. Replaces the slash-glyph logo.
export function Logo() {
  return (
    <Link href="/" className="logo-plate" aria-label="Liquid Clips home">
      <img
        src="/brand/invader.png"
        alt=""
        width={24}
        height={24}
        style={{ imageRendering: "pixelated" }}
      />
      <span>
        liquid<span className="slash">/</span>clips
      </span>
    </Link>
  );
}
