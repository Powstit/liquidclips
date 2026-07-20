import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
  },
  turbopack: {
    root: __dirname,
  },
  // v0.7.59 — Customer-facing auth routes (/sign-in, /sign-up,
  // /connect-desktop) are now NATIVE in marketing. The prior cross-app
  // rewrite to account-app served the page HTML through liquidclips.app
  // but 404'd every /_next/static/* asset, leaving users on a white
  // unstyled "Activating Liquid Clips on this device…" page. See
  // desktop/docs/auth-keychain-invariant.md + commit notes for context.
  //
  // Account-app still owns /dashboard, /upgrade, /checkout, /payouts.
  // Those redirect to account.liquidclips.app rather than proxy — that
  // way the URL bar honestly reflects who renders the page (no broken
  // asset chain) and the user can bookmark the post-auth surface.
  //
  // The /api/desktop/* proxy stays — it's a server-side fetch with no
  // CSS/JS asset graph, so the rewrite works fine there.
  //
  // Everything not listed serves from marketing: /, /download, /how,
  // /pricing, /privacy, /help, /eula, /terms, /refunds, /refer,
  // /support, /lift, /start, /cookies, /account-deletion.
  async rewrites() {
    const target = "https://account.liquidclips.app";
    return [
      { source: "/api/desktop/:path*", destination: `${target}/api/desktop/:path*` },
    ];
  },
  async redirects() {
    const target = "https://account.liquidclips.app";
    return [
      { source: "/dashboard",        destination: `${target}/dashboard`,         permanent: false },
      { source: "/dashboard/:path*", destination: `${target}/dashboard/:path*`,  permanent: false },
      { source: "/upgrade",          destination: `${target}/upgrade`,           permanent: false },
      { source: "/upgrade/:path*",   destination: `${target}/upgrade/:path*`,    permanent: false },
      { source: "/checkout",         destination: `${target}/checkout`,          permanent: false },
      { source: "/checkout/:path*",  destination: `${target}/checkout/:path*`,   permanent: false },
      { source: "/payouts",          destination: `${target}/payouts`,           permanent: false },
      { source: "/payouts/:path*",   destination: `${target}/payouts/:path*`,    permanent: false },
      // IRON GATE IG-COMPOSER-R · Watermark attribution redirect.
      // The desktop app burns `liquidclips.app/r/{handle}` into every
      // clip (see desktop-2/src/lib/referralUrl.ts). This redirect closes
      // the loop by handing the click off to Whop's affiliate checkout,
      // which credits the {handle} via `?a=` per
      // liquid_clips_whop_affiliate_system.md. Removing this line 404s
      // every watermarked clip in the wild.
      { source: "/r/:handle",        destination: "https://whop.com/checkout/studio?a=:handle", permanent: false },
    ];
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
