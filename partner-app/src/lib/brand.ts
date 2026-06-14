export const brand = {
  name: "junior/employee",
  productName: "Junior",
  tagline: "Your AI editor. Lives on your computer.",
  // v0.7.68 P1 — canonical marketing domain is liquidclips.app. The env var
  // still wins so deploy previews / staging can override without a code change.
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://liquidclips.app",
  affiliateMarketingUrl: (process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://liquidclips.app") + "/affiliates",
} as const;
