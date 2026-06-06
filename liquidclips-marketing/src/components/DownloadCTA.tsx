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
    // still reports x86_64; the most reliable signal is the WebGL renderer or
    // the `Apple M` substring in newer Chrome 113+ on Sonoma. We do a coarse
    // check — fall back to the universal DMG which works on both.
    if (/Apple\s?M\d|arm64|aarch64/i.test(ua)) return "mac-arm";
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
    case "mac-universal":
      return "Download for Mac";
    case "mac-intel":
      return "Download for Mac (Intel)";
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
}: {
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  className?: string;
}) {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const artifacts = useMemo(loadArtifacts, []);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const href = pickArtifact(platform, artifacts);
  const waitlistHref = `mailto:${supportEmail}?subject=${encodeURIComponent("Let me know when Liquid Clips is ready")}`;

  const cls = [
    variant === "primary" ? "button-primary" : "button-secondary",
    size === "md" ? "" : "",
    className,
  ].filter(Boolean).join(" ");

  if (!href) {
    return (
      <a href={waitlistHref} className={cls} data-platform={platform} data-state="waitlist">
        Get notified when ready
      </a>
    );
  }

  return (
    <a
      href={href}
      className={cls}
      data-platform={platform}
      data-state="ready"
      // Hint the browser to download rather than navigate.
      download
    >
      {ctaLabel(platform)}
    </a>
  );
}

export function DownloadMeta() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);
  if (platform === "unknown") {
    return (
      <p className="microcopy">Universal macOS DMG · Apple Silicon &amp; Intel · notarized by Apple.</p>
    );
  }
  if (platform === "windows" || platform === "linux") {
    return (
      <p className="microcopy">
        Detected {platform === "windows" ? "Windows" : "Linux"} — public build is macOS first. Email us and we&apos;ll
        notify you when the {platform === "windows" ? "Windows" : "Linux"} build is ready.
      </p>
    );
  }
  return (
    <p className="microcopy">
      Universal macOS DMG · Apple Silicon &amp; Intel · signed &amp; notarized.
    </p>
  );
}
