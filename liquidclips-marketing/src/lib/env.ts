/**
 * Single source for outward-facing URLs and identity values.
 *
 * Every production URL on the marketing site reads through this module
 * so a domain change is one env var, not a 14-file find-and-replace.
 *
 * NEXT_PUBLIC_* keys are baked into the client bundle. Server-only
 * config (auth secrets, DB URLs) lives elsewhere — those don't belong
 * here.
 *
 * Each export has a defensible default so local dev / preview builds
 * never crash when an env var is missing.
 */

const trim = (s: string | undefined) => (s ?? "").trim().replace(/\/+$/, "");

export const SITE_URL =
  trim(process.env.NEXT_PUBLIC_SITE_URL) || "https://liquidclips.app";

export const SUPPORT_EMAIL =
  trim(process.env.NEXT_PUBLIC_SUPPORT_EMAIL) || "hello@liquidclips.app";

export const PRODUCT_HUNT_URL =
  trim(process.env.NEXT_PUBLIC_PRODUCT_HUNT_URL) ||
  "https://www.producthunt.com/posts/liquid-clips";

/** owner/repo for the desktop app — used by latest-release.ts and the
 *  "view all releases" download fallback. */
export const GITHUB_REPO =
  trim(process.env.NEXT_PUBLIC_GITHUB_REPO) || "Powstit/liquidclips";

export const GITHUB_RELEASES_API =
  `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export const GITHUB_RELEASES_PAGE =
  `https://github.com/${GITHUB_REPO}/releases`;

/** Partner / Whop URL is owned by the Whop dashboard config, not Clerk-auth.
 *  Kept here so partner links also flow through env. */
export const PARTNER_URL =
  trim(process.env.NEXT_PUBLIC_PARTNER_URL) ||
  "https://partner.liquidclips.app";
