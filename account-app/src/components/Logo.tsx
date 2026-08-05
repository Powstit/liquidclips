// The liquid/clips mark — pixel-invader landmark + fuchsia pill + wordmark.
// Brand-consistency-audit P1 #12 (2026-06-25): aligned with marketing's
// invader-first pattern so the brand mark reads identically across hosts.
//
// 2026-08-05 — was rendering `/brand/logo-monogram.png`, a 1024×1024 raster
// export with an opaque dark glow baked into the background (never made
// transparent). At the 20×20 badge size that painted the icon slot as a
// near-solid dark square with the pink invader barely visible — confirmed
// live on the /upgrade checkout page. Replaced with PixelInvader, the same
// path data as desktop's canonical IG-012 brand primitive — genuinely
// transparent, crisp at any size, no raster asset needed.
import Link from "next/link";
import { PixelInvader } from "./PixelInvader";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-[9px] bg-fuchsia px-[14px] py-[9px] pl-[9px] font-mono text-[16px] font-bold leading-none text-paper transition-colors hover:bg-ink"
      aria-label="Liquid Clips home"
    >
      <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md bg-paper">
        <PixelInvader size={20} />
      </span>
      <span>
        liquid<span className="text-ink">/</span>clips
      </span>
    </Link>
  );
}
