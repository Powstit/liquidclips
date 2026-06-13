// v0.7.57 — Clerk primary swap. Customer auth lives at the bare apex
// (liquidclips.app/sign-in, /dashboard, /upgrade etc.) via marketing-edge
// rewrites in next.config.ts. accountUrl + appUrl point at the apex so any
// outbound link from marketing copy reads `liquidclips.app` end-to-end.
// partnerUrl is owned by Whop and stays on the jnremployee domain (Whop's
// dashboard configuration, not a Clerk-auth surface).
export const accountUrl = "https://liquidclips.app";
export const appUrl = "https://liquidclips.app";
export const partnerUrl = "https://partner.jnremployee.com";
export const supportEmail = "hello@liquidclips.app";

// v0.7.49 hotfix — Removed the NEXT_PUBLIC_DOWNLOAD_DMG_URL env-var fallback.
// That env var was set to the OLD Jnr-employee/v0.6.44 URL months ago and
// turned into a footgun: visitors who clicked the homepage Hero button were
// served a stale, dead-repo build (Ryan hit this on 2026-06-11, Liquid Clips
// 0.6.44 dmg got served, Gatekeeper rejected it). The /download page already
// reads from getLatestRelease() (src/lib/latest-release.ts) which polls the
// live GitHub release. Every download button now routes through that one
// dynamic source — no stale env-var override possible.
export const downloadUrl = "https://liquidclips.app/download";

export const navLinks = [
  { href: "/#how", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
  { href: "/help", label: "Help" },
  { href: "/privacy", label: "Privacy" },
];
