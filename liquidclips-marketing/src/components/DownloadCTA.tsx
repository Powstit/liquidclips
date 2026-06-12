"use client";

import { useEffect, useMemo, useState } from "react";
import { supportEmail } from "@/lib/site";

type Platform = "mac-arm" | "mac-intel" | "mac-universal" | "windows" | "linux" | "unknown";

type ArtifactMap = {
  macUniversal?: string;
  macArm?: string;
  macIntel?: string;
  windows?: string;
  linux?: string;
};

const RELEASES_URL = "https://github.com/Powstit/liquidclips/releases";

// v0.7.49 hotfix — Removed the NEXT_PUBLIC_DOWNLOAD_DMG_URL legacy fallback.
// The env var on Vercel was still pointing to Jnr-employee/v0.6.44 and was
// being served as a stale .dmg button on 2026-06-11. Primary path stays
// getLatestRelease() via the `artifacts` prop. Per-platform env vars (if a
// future use case needs them) still work, but no stale all-Mac fallback.
function loadArtifacts(): ArtifactMap {
  return {
    macUniversal: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_UNIVERSAL_URL,
    macArm: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_ARM_URL,
    macIntel: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_INTEL_URL,
    windows: process.env.NEXT_PUBLIC_DOWNLOAD_WINDOWS_URL,
    linux: process.env.NEXT_PUBLIC_DOWNLOAD_LINUX_URL,
  };
}

function detectPlatform(): Platform {
  if (typeof window === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  const isMac = /Mac/.test(plat) || /Mac OS X|Macintosh/.test(ua);
  if (isMac) {
    // Apple Silicon detection: navigator.userAgent on Safari/Chrome on M-series
    // still reports x86_64 — Apple does this deliberately so x86 web fingerprints
    // don't break on M-series. The only reliable signal client-side is the WebGL
    // unmasked renderer (returns "Apple Mx GPU" on Apple Silicon). We fall back
    // to the user override link below for the cases this misses.
    if (/Apple\s?M\d|arm64|aarch64/i.test(ua)) return "mac-arm";
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl");
      if (gl) {
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
          if (/Apple/.test(renderer)) return "mac-arm";
        }
      }
    } catch { /* ignore */ }
    return "mac-arm";
  }
  if (/Win/.test(plat) || /Windows/.test(ua)) return "windows";
  if (/Linux/.test(plat) || /Linux/.test(ua)) return "linux";
  return "unknown";
}

function pickArtifact(p: Platform, a: ArtifactMap): string | null {
  switch (p) {
    case "mac-arm":
      return a.macArm ?? a.macUniversal ?? null;
    case "mac-intel":
      return a.macIntel ?? null;
    case "mac-universal":
      return a.macArm ?? a.macUniversal ?? a.macIntel ?? null;
    case "windows":
      return a.windows ?? null;
    case "linux":
      return a.linux ?? null;
    default:
      return null;
  }
}

function ctaLabel(p: Platform): string {
  switch (p) {
    case "mac-arm":
      return "Download for Apple Silicon";
    case "mac-universal":
      return "Download for Mac";
    case "mac-intel":
      return "Download for Intel Mac";
    case "windows":
      return "Download for Windows";
    case "linux":
      return "Download for Linux";
    default:
      return "Download";
  }
}

export function DownloadCTA({
  variant = "primary",
  size = "lg",
  className = "",
  showPicker = true,
  artifacts: artifactsProp,
  version,
  label,
}: {
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  className?: string;
  showPicker?: boolean;
  /** Server-side artifact URLs from getLatestRelease(). When provided,
   *  these win over env-var fallbacks. Lets parent pages drive the
   *  download URL set without per-version Vercel env-var bumps. */
  artifacts?: ArtifactMap;
  /** Public release version from getLatestRelease(). Surfaced in the
   *  post-click "didn't start" helper so users see exactly which DMG
   *  is wired up. */
  version?: string;
  /** Optional label override. The homepage hero uses `"Download Desktop"`
   *  for value-prop framing; the /download page keeps the platform-
   *  specific dynamic label ("Download for Apple Silicon" etc.). */
  label?: string;
}) {
  // SSR fallback: assume Mac. Liquid Clips is a Mac-only desktop app — even
  // if a Windows/Linux visitor lands here, the eventual client-side override
  // link still works. The point of this default is to AVOID the visible
  // "Get notified when ready" flash during the SSR → hydration window, which
  // looks like the app is unreleased to anyone watching a demo recording.
  const [detected, setDetected] = useState<Platform>("mac-arm");
  const [override, setOverride] = useState<Platform | null>(null);
  // v0.7.56 — post-click helper. After the primary button is clicked we
  // show a small "If your download didn't start, click here" link with
  // the direct asset URL. Defends against browsers blocking the auto-
  // download from a top-level <a download>.
  //
  // The `?show-fallback=1` query forces the fallback visible without a
  // click — used for snapshot proof and for support links that need to
  // walk a user to the manual download.
  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("show-fallback") === "1") setClicked(true);
  }, []);
  const artifacts = useMemo(() => {
    // Server-provided artifacts win; merge any missing entries from env-var
    // fallbacks so we never go dead even if the GH API call failed.
    if (artifactsProp) {
      const fallback = loadArtifacts();
      return {
        macUniversal: artifactsProp.macUniversal ?? fallback.macUniversal,
        macArm: artifactsProp.macArm ?? fallback.macArm,
        macIntel: artifactsProp.macIntel ?? fallback.macIntel,
        windows: artifactsProp.windows ?? fallback.windows,
        linux: artifactsProp.linux ?? fallback.linux,
      };
    }
    return loadArtifacts();
  }, [artifactsProp]);

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  const platform = override ?? detected;
  const href = pickArtifact(platform, artifacts);
  const intelReady = Boolean(artifacts.macIntel);
  const waitlistHref = `mailto:${supportEmail}?subject=${encodeURIComponent("Let me know when Liquid Clips is ready")}`;

  const cls = [
    variant === "primary" ? "button-primary" : "button-secondary",
    size === "md" ? "" : "",
    className,
  ].filter(Boolean).join(" ");

  const isMacContext = platform === "mac-arm" || platform === "mac-intel" || platform === "mac-universal" || platform === "unknown";

  return (
    <div className="download-cta-stack">
      {!href ? (
        // Failure mode: GH API + env-var fallbacks both empty. Never goes
        // dead — sends the user to the full GitHub releases page so they
        // can grab the DMG directly, with mailto as a last resort.
        <a href={RELEASES_URL} className={cls} data-platform={platform} data-state="releases-fallback" target="_blank" rel="noopener noreferrer">
          View all releases on GitHub
        </a>
      ) : (
        <a
          href={href}
          className={cls}
          data-platform={platform}
          data-state="ready"
          download
          onClick={() => setClicked(true)}
        >
          {label ?? ctaLabel(platform)}
        </a>
      )}

      {showPicker && isMacContext && (
        <div className="download-picker" role="group" aria-label="Mac chip selector">
          <button
            type="button"
            className={`download-pick ${platform === "mac-arm" || platform === "mac-universal" ? "is-active" : ""}`}
            onClick={() => setOverride("mac-arm")}
            aria-pressed={platform === "mac-arm" || platform === "mac-universal"}
          >
            Apple Silicon
          </button>
          <span className="download-pick-sep">·</span>
          <button
            type="button"
            className={`download-pick ${platform === "mac-intel" ? "is-active" : ""}`}
            onClick={() => setOverride("mac-intel")}
            disabled={!intelReady}
            aria-pressed={platform === "mac-intel"}
            title={intelReady ? "Download Intel Mac build" : "Intel build is not available in the current release"}
          >
            Intel
          </button>
          <span className="download-pick-sep">·</span>
          <a
            className="download-pick"
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-cta="view-all-releases"
          >
            View all releases
          </a>
        </div>
      )}

      {clicked && href && (
        // Post-click safety net. The auto-download from <a download> can
        // be silently blocked by some browsers (Safari ITP, popup blockers,
        // overly-aggressive download managers). This persistent link gives
        // the user a manual route to the exact same asset without
        // re-detecting platform or refreshing.
        <p className="microcopy download-fallback" data-state="post-click">
          If your download didn&apos;t start,{" "}
          <a href={href} download>
            click here
          </a>
          {version ? ` to grab v${version} directly` : " to grab the DMG directly"}.
          Or{" "}
          <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
            view all releases
          </a>
          .
        </p>
      )}

      {!href && (
        <p className="microcopy">
          Trouble downloading? <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
        </p>
      )}
      {/* Keep mailto reachable in the failure mode even though waitlistHref
          is no longer the primary fallback. */}
      <span hidden>{waitlistHref}</span>
    </div>
  );
}

export function DownloadMeta({ version }: { version?: string } = {}) {
  const [platform, setPlatform] = useState<Platform>("unknown");
  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);
  const versionTag = version ? ` · v${version}` : "";
  if (platform === "unknown") {
    return (
      <p className="microcopy">Apple Silicon DMG · signed &amp; notarized{versionTag}.</p>
    );
  }
  if (platform === "windows" || platform === "linux") {
    return (
      <p className="microcopy">
        Detected {platform === "windows" ? "Windows" : "Linux"} — public build is Mac only for now. Email us and we&apos;ll
        notify you when the {platform === "windows" ? "Windows" : "Linux"} build is ready.
      </p>
    );
  }
  return (
    <p className="microcopy">
      {platform === "mac-arm" ? "Apple Silicon DMG" : platform === "mac-intel" ? "Intel DMG" : "Mac DMG"} · signed &amp; notarized · ~150MB{versionTag}
    </p>
  );
}
