// Customer auth + marketing share the same apex per the v0.7.57 swap.
// Source of truth for the URL is `SITE_URL` in src/lib/env.ts — change it
// there, not here. partnerUrl is Whop-owned so it stays on its own env
// fallback.
import { SITE_URL, SUPPORT_EMAIL, PARTNER_URL } from "@/lib/env";

export const accountUrl = SITE_URL;
export const appUrl = SITE_URL;
export const partnerUrl = PARTNER_URL;
export const supportEmail = SUPPORT_EMAIL;

// v0.7.49 hotfix — DMG URLs come from getLatestRelease() at runtime, not from
// an env-var. This constant stays as a stable "where to download" link.
export const downloadUrl = `${SITE_URL}/download`;

export const navLinks = [
  { href: "/#how", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
  { href: "/help", label: "Help" },
  { href: "/privacy", label: "Privacy" },
];
