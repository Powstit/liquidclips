// The liquid/clips mark — pixel-invader landmark + fuchsia pill + wordmark.
// Brand-consistency-audit P1 #12 (2026-06-25): aligned with marketing's
// invader-first pattern so the brand mark reads identically across hosts.
// Invader monogram (`/brand/logo-monogram.png`) is the same asset HQ admin
// uses for AdminBrandHeader, keeping the invader landmark consistent.
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-[9px] bg-fuchsia px-[14px] py-[9px] pl-[9px] font-mono text-[16px] font-bold leading-none text-paper transition-colors hover:bg-ink"
      aria-label="Liquid Clips home"
    >
      <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md bg-paper">
        <img
          src="/brand/logo-monogram.png"
          alt=""
          width={20}
          height={20}
          style={{ imageRendering: "pixelated" }}
        />
      </span>
      <span>
        liquid<span className="text-ink">/</span>clips
      </span>
    </Link>
  );
}
