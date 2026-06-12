import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname),
  },
  async headers() {
    return [
      // Embed surfaces are loaded inside the desktop app's Tauri child webview.
      // They intentionally need to be presentable in that hosted context, so
      // remove the blanket frame-deny for /embed/* while keeping it everywhere
      // else. (Tauri webviews are not frames, but some WebKit partitions still
      // consult these headers and a DENY can leave the surface blank.)
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
      {
        source: "/:path*",
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
