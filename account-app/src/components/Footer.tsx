// Brand footer — Brand-consistency-audit P1 #10 (2026-06-25).
// Mirrors marketing's footer pattern (invader landmark + brand sign-off
// + utility links) so the brand survives below the fold on signed-in
// surfaces. Minimal by design: logo + invader, 3 utility links, copyright.
import Link from "next/link";
import { Logo } from "./Logo";

const LINKS = [
  { href: "https://liquidclips.app/refund", label: "Refunds" },
  { href: "https://liquidclips.app/privacy", label: "Privacy" },
  { href: "https://liquidclips.app/terms", label: "Terms" },
];

export function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-paper px-8 py-10">
      <div className="mx-auto flex max-w-[1240px] flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Logo />
          <img
            src="/brand/logo-monogram.png"
            alt=""
            width={28}
            height={28}
            style={{ imageRendering: "pixelated" }}
            className="opacity-70"
            aria-hidden
          />
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary">
          © 2026 Liquid Clips · MADE BY A CLIPPER
        </p>
      </div>
    </footer>
  );
}
