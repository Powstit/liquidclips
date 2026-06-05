export const accountUrl = "https://account.liquidclips.app";
export const appUrl = "https://app.liquidclips.app";
export const partnerUrl = "https://partner.liquidclips.app";
export const supportEmail = "hello@liquidclips.app";

// v0.6.11 — Default points at the brand /download page. The previous default
// was a `https://github.com/Powstit/Jnr-employee/releases/latest` URL which
// (a) leaked the old "Jnr-employee" brand, (b) exposed the source repo to
// customers, and (c) showed draft/CI artifacts. Set NEXT_PUBLIC_DOWNLOAD_DMG_URL
// on Vercel to the canonical signed DMG URL once a public release is hosted —
// then every Download button on the marketing site points at the real file.
export const downloadUrl =
  process.env.NEXT_PUBLIC_DOWNLOAD_DMG_URL ??
  "https://liquidclips.app/download";

export const navLinks = [
  { href: "/#how", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
  { href: "/help", label: "Help" },
  { href: "/privacy", label: "Privacy" },
];
