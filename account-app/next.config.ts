import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  async headers() {
    return [
      // Embed surfaces are loaded inside the desktop app's Tauri child webview
      // — they need to be frame-presentable. Frame-deny goes on EVERYTHING
      // ELSE via the `missing` cookie negation trick: the catch-all only
      // matches paths that DON'T start with /embed/. v0.7.54 P0-001: prior
      // version applied both rules in cascade (Next.js merges headers across
      // matching sources, it does not pick the most-specific), so /embed/earn
      // ended up with frame-ancestors 'none' AND frame-ancestors * — DENY
      // won. Now: explicit non-embed source list keeps the deny global without
      // touching the embed cascade.
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        // Match everything that isn't /embed/* (and isn't the Sentry tunnel
        // route — leaving the deny off /monitoring stays a non-issue because
        // Sentry never returns HTML). Negative lookahead via a regex-source
        // rule, which Next.js supports for top-level header sources.
        source: "/((?!embed/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

// withSentryConfig wraps the build to upload source maps, register the tunnel
// route (so ad-blockers don't drop our error events), and inject release info.
// Source map upload needs SENTRY_AUTH_TOKEN at build time
// (create at sentry.io/settings/auth-tokens/).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  // Proxy errors through /monitoring to bypass ad-blockers that strip Sentry.
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
