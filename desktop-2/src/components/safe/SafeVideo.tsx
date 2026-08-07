/**
 * SafeVideo · <video> primitive with mandatory error + poster fallback.
 *
 * 2026-07-05 · CM-T5 codemod target. bug-hunt-lens flagged 19 <video>
 * sites with NO onError handler. When the source 404s or the codec
 * can't be decoded, users see a black rectangle or a broken-media
 * placeholder. Two documented incidents this session:
 *   1. IntroSplash.tsx · 28.5s black screen when intro video missing
 *   2. WalletDetail.tsx · founder-wallet.mp4 404 shows empty coach block
 *
 * SafeVideo handles three states explicitly:
 *   loading  · while metadata loads (fires `onLoadedMetadata`)
 *   loaded   · normal playback
 *   error    · source 404 / decode failure → poster or fallback node
 *
 * Migration pattern:
 *
 *   Before:
 *     <video src={url} autoPlay muted playsInline />
 *
 *   After:
 *     <SafeVideo src={url} poster={posterUrl} autoPlay muted playsInline />
 *
 * All standard <video> props pass through. `poster` is used as the
 * visible fallback when the video fails. If NO poster is provided
 * either, `fallback` (React node) is rendered.
 */

import { forwardRef, useCallback, useState } from "react";
import type { ReactNode, VideoHTMLAttributes } from "react";

export interface SafeVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, "onError"> {
  /**
   * Poster image URL. When the video source fails to load or decode,
   * this poster stays visible as the fallback. Best UX pattern: pair
   * every SafeVideo with a poster.
   */
  poster?: string;
  /**
   * React node to render in place of the video when BOTH the video
   * source AND the poster fail. Falls back to a subtle placeholder
   * card when omitted.
   */
  fallback?: ReactNode;
}

type State = "loading" | "loaded" | "error";

export const SafeVideo = forwardRef<HTMLVideoElement, SafeVideoProps>(function SafeVideo(
  { src, poster, fallback, className, style, ...rest },
  ref,
) {
  const [state, setState] = useState<State>("loading");
  const [posterFailed, setPosterFailed] = useState<boolean>(false);

  const handleError = useCallback(() => {
    setState("error");
  }, []);

  const handleLoaded = useCallback(() => {
    setState("loaded");
  }, []);

  const handlePosterError = useCallback(() => {
    setPosterFailed(true);
  }, []);

  // Error state · prefer poster, then fallback node, then placeholder
  if (state === "error") {
    if (poster && !posterFailed) {
      return (
        <img
          src={poster}
          alt=""
          className={className}
          style={style}
          onError={handlePosterError}
        />
      );
    }
    if (fallback) {
      return <>{fallback}</>;
    }
    // 2026-08-07 — this text fallback used to be sized for a normal
    // rectangular video slot. In small/circular hosts (e.g. WalletDetail's
    // 76px round founder-video thumb) "VIDEO UNAVAILABLE" doesn't fit and
    // the host's overflow:hidden clips it into unreadable, overlap-looking
    // fragments. Sized to survive down to ~48px: no letter-spacing/uppercase
    // (both widen the string), tiny font, tight padding, real wrapping.
    return (
      <div
        className={className}
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "4px",
          overflow: "hidden",
          background: "rgba(20, 12, 22, 0.35)",
          border: "1px solid var(--color-line, rgba(255,255,255,0.08))",
          borderRadius: style?.borderRadius ?? 12,
          color: "var(--color-ink-soft, #9aa0a6)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 8,
          lineHeight: 1.25,
          whiteSpace: "normal",
          wordBreak: "break-word",
        }}
        role="img"
        aria-label="Video unavailable"
      >
        no video
      </div>
    );
  }

  return (
    <video
      {...rest}
      ref={ref}
      src={src}
      poster={poster}
      className={className}
      style={style}
      onError={handleError}
      onLoadedMetadata={handleLoaded}
    />
  );
});
