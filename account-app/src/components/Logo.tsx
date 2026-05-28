// The liquid/clips mark — fuchsia pill, white tile, ink slash.
// Mirrors partner-app/src/components/Logo.tsx exactly so brand reads the same
// across every surface (marketing, partner dashboard, account dashboard).
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-[9px] bg-fuchsia px-[14px] py-[9px] pl-[9px] font-mono text-[16px] font-bold leading-none text-paper transition-colors hover:bg-ink"
    >
      <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md bg-paper font-mono text-[15px] font-bold leading-none text-fuchsia">
        /
      </span>
      <span>
        liquid<span className="text-ink">/</span>clips
      </span>
    </Link>
  );
}
