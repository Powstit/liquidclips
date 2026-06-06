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

// Single source of truth for downloadable artifact URLs.
// Set on Vercel; missing entries fall through to the waitlist mailto.
// NEXT_PUBLIC_DOWNLOAD_DMG_URL is the legacy single-Mac-DMG var — if the
// per-arch vars aren't set, fall back to it for every Mac path so the
// existing v0.6.44 ARM DMG keeps serving.
function loadArtifacts(): ArtifactMap {
  const legacyDmg = process.env.NEXT_PUBLIC_DOWNLOAD_DMG_URL;
  return {
    macUniversal: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_UNIVERSAL_URL ?? legacyDmg,
    macArm: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_ARM_URL ?? legacyDmg,
    macIntel: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_INTEL_URL ?? legacyDmg,
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
    return "mac-universal";
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
      return a.macIntel ?? a.macUniversal ?? null;
    case "mac-universal":
      return a.macUniversal ?? a.macArm ?? a.macIntel ?? null;
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
}: {
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  className?: string;
  showPicker?: boolean;
}) {
  // SSR fallback: assume Mac. Liquid Clips is a Mac-only desktop app — even
  // if a Windows/Linux visitor lands here, the eventual client-side override
  // link still works. The point of this default is to AVOID the visible
  // "Get notified when ready" flash during the SSR → hydration window, which
  // looks like the app is unreleased to anyone watching a demo recording.
  const [detected, setDetected] = useState<Platform>("mac-universal");
  const [override, setOverride] = useState<Platform | null>(null);
  const artifacts = useMemo(loadArtifacts, []);

  useEffect(() => {
    setDetected(detectPlatform());
  }, []);

  const platform = override ?? detected;
  const href = pickArtifact(platform, artifacts);
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
        <a href={waitlistHref} className={cls} data-platform={platform} data-state="waitlist">
          Get notified when ready
        </a>
      ) : (
        <a href={href} className={cls} data-platform={platform} data-state="ready" download>
          {ctaLabel(platform)}
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
            aria-pressed={platform === "mac-intel"}
          >
            Intel
          </button>
        </div>
      )}
    </div>
  );
}

export function DownloadMeta() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);
  if (platform === "unknown") {
    return (
      <p className="microcopy">Mac DMG · Apple Silicon &amp; Intel builds · signed &amp; notarized.</p>
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
      {platform === "mac-arm" ? "Apple Silicon DMG" : platform === "mac-intel" ? "Intel DMG" : "Mac DMG"} · signed &amp; notarized · ~150MB
    </p>
  );
}
