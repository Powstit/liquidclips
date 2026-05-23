export const brand = {
  name: "junior/employee",
  productName: "Junior",
  tagline: "Your AI editor. Lives on your computer.",
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://jnremployee.com",
  affiliateMarketingUrl: (process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://jnremployee.com") + "/affiliate",
} as const;
