// Primitive: Avatar.
//
// Three render modes in priority order:
//   1. `avatarId` set → looks up the catalog entry from lib/avatars.ts and
//      renders the chosen tier glyph + tone (gamified unlock system)
//   2. `src` set → renders the remote image (Clerk image_url, Whop
//      profile_picture, GIF, etc) — handled by the native <img> so GIF
//      animation works natively; CSP permits https: img-src
//   3. neither → derives initials from `name`, falls back to "•"
//
// Resilience: if a remote `src` fails to load (404, CORS) we fall through
// to the initials fallback rather than showing a broken-image icon.

import { useState } from "react";
import { avatarById } from "../../lib/avatars";

type Size = "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-10 w-10 text-[12px]",
  lg: "h-14 w-14 text-[15px]",
};

const glyphSizes: Record<Size, number> = {
  sm: 14,
  md: 18,
  lg: 24,
};

export function Avatar({
  avatarId,
  src,
  name,
  size = "md",
  ring,
  className,
}: {
  avatarId?: string | null;
  src?: string | null;
  name?: string | null;
  size?: Size;
  ring?: boolean;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const catalogEntry = avatarById(avatarId);
  const showCatalog = !!catalogEntry;
  const showImage = !showCatalog && !!src && !errored;
  const initials = deriveInitials(name);

  return (
    <span
      className={[
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border font-mono uppercase tracking-[var(--tracking-eyebrow)]",
        sizes[size],
        // Catalog entries supply their own tone class; src + initials fall
        // back to a neutral paper-elev surface.
        showCatalog ? catalogEntry.tone : "bg-paper-elev border-line text-text-secondary",
        ring && "ring-2 ring-fuchsia/60 ring-offset-1 ring-offset-paper",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={catalogEntry?.label ?? name ?? "avatar"}
      title={catalogEntry?.label ?? name ?? undefined}
    >
      {showCatalog ? (
        catalogEntry.glyph({ size: glyphSizes[size] })
      ) : showImage ? (
        <img
          src={src!}
          alt={name ?? ""}
          loading="lazy"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

function deriveInitials(name?: string | null): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
