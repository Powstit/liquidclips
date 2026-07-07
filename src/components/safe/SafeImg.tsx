/**
 * SafeImg · <img> primitive with mandatory error + loading handling.
 *
 * 2026-07-05 · CM-T5 codemod target. bug-hunt-lens flagged 24 <img>
 * sites in production paths with NO onError fallback. When the source
 * 404s (asset moved, CDN blip, network hiccup), the browser renders
 * the alt text with a broken-image icon — jarring on a brand surface.
 *
 * SafeImg handles four states explicitly:
 *   loading  · while the image request is in flight (subtle skeleton)
 *   loaded   · normal render
 *   error    · 404 / decode failure → fallback (image, node, "hide")
 *   fallback-error · fallback image ALSO failed → last-resort dash
 *
 * Migration pattern:
 *
 *   Before:
 *     <img src={url} alt="Clip cover" className="foo" />
 *
 *   After:
 *     <SafeImg src={url} alt="Clip cover" className="foo" />
 *
 * All standard <img> props pass through. `fallback` is optional; when
 * omitted a subtle dashed dash "—" is rendered so the layout footprint
 * survives (never `display: none` unless `fallback="hide"`).
 *
 * Zero eslint disables. Zero raw error leaks (no console.log). Zero
 * external deps.
 */

import { useCallback, useState } from "react";
import type { ImgHTMLAttributes, ReactNode } from "react";

export type SafeImgFallback = string | ReactNode | "hide";

export interface SafeImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "onError"> {
  /**
   * What to render when the primary `src` fails. Options:
   *   - `string` (URL) — render another <img> with this URL. If THAT
   *     also fails, we render the last-resort dash.
   *   - React node — render this node in place.
   *   - `"hide"` — remove the element from the layout (returns null).
   *   - `undefined` (default) — render a subtle dashed dash so the
   *     surrounding layout still gets its width/height allocation.
   */
  fallback?: SafeImgFallback;
  /**
   * Show a subtle skeleton while loading. Default: false. Enable for
   * hero images or hover cards where the load time is user-visible.
   */
  showLoading?: boolean;
}

type State = "loading" | "loaded" | "error" | "fallback-error";

export function SafeImg({
  src,
  alt = "",
  fallback,
  showLoading = false,
  className,
  style,
  ...rest
}: SafeImgProps) {
  const [state, setState] = useState<State>("loading");

  const handleError = useCallback(() => {
    setState((prev) => (prev === "loading" || prev === "loaded" ? "error" : "fallback-error"));
  }, []);

  const handleLoad = useCallback(() => {
    setState("loaded");
  }, []);

  // Error state · pick the right fallback
  if (state === "error") {
    if (fallback === "hide") return null;
    if (typeof fallback === "string") {
      return (
        <img
          {...rest}
          src={fallback}
          alt={alt}
          className={className}
          style={style}
          onError={handleError}
        />
      );
    }
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    // Default: dashed dash placeholder — preserves layout footprint
    return (
      <span
        className={className}
        style={{
          ...style,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-ink-soft, #9aa0a6)",
          fontSize: "0.75rem",
        }}
        aria-label={alt || "Image unavailable"}
        role="img"
      >
        —
      </span>
    );
  }

  // Fallback-error · last resort dash
  if (state === "fallback-error") {
    return (
      <span
        className={className}
        style={{
          ...style,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-ink-soft, #9aa0a6)",
          fontSize: "0.75rem",
        }}
        aria-label={alt || "Image unavailable"}
        role="img"
      >
        —
      </span>
    );
  }

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={className}
      style={{
        ...style,
        opacity: showLoading && state === "loading" ? 0.35 : 1,
        transition: "opacity 180ms ease-out",
      }}
      onError={handleError}
      onLoad={handleLoad}
    />
  );
}
