// Marketing site robots.txt · Next.js metadata route
// Disallows /api/* so Google doesn't index waitlist / referral / preview
// endpoints. Public pages stay crawlable for SEO.
//
// Added 2026-07-04 · P1 security audit finding · marketing had no robots.
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/preview/",  // per-lead cinematic pages · lc_id embedded · not for indexing
          "/admin/",
          "/_next/",
        ],
      },
    ],
    sitemap: "https://liquidclips.app/sitemap.xml",
    host: "https://liquidclips.app",
  };
}
