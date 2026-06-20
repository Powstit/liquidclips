import Image from "next/image";
import type { ReactNode } from "react";

/**
 * KadeHead · slim announcer row at the top of every IC panel.
 *
 * Kade portrait on the left, the panel's eyebrow / headline / sub copy
 * on the right. Each panel passes a Kade pose chosen to *visually*
 * explain what the panel is about before the reader scans the words.
 *
 * Layout collapses to a smaller portrait + tighter gap on narrow widths.
 */
export function KadeHead({
  src,
  alt,
  children,
}: {
  src: string;
  alt: string;
  children: ReactNode;
}) {
  return (
    <header className="lc-ic-kadehead">
      <div className="lc-ic-kadehead-portrait" aria-hidden="true">
        <span className="lc-ic-kadehead-bloom" />
        <Image
          src={src}
          alt={alt}
          width={360}
          height={360}
          className="lc-ic-kadehead-img"
          priority
        />
      </div>
      <div className="lc-ic-kadehead-copy">{children}</div>
    </header>
  );
}
