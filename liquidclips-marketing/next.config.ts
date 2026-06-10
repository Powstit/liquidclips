import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
  },
  turbopack: {
    root: __dirname,
  },
};

// withSentryConfig wraps the build to upload source maps, register the tunnel
// route (so ad-blockers don't drop our error events), and inject release info.
// Org/project slugs come from the Sentry dashboard URL — set via env if you
// don't want to commit them. Source map upload needs SENTRY_AUTH_TOKEN at
// build time (create at sentry.io/settings/auth-tokens/).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Pull more client source files into the upload so production stack traces
  // resolve to the original source.
  widenClientFileUpload: true,
  // Proxy errors through /monitoring to bypass ad-blockers that strip Sentry.
  tunnelRoute: "/monitoring",
  // Quiet non-CI build output.
  silent: !process.env.CI,
});
