/**
 * StopPagesRoute · honest beta stub
 *
 * 2026-06-20: not surfaced in ConsoleNav. Reachable only via deep-link
 * `#/stop-pages`. The "10 stop pages mapped" claim was a placeholder —
 * the real blocker-routing surface is post-beta scope.
 */

import { SimPage } from "./SimPage";

export function StopPagesRoute() {
  return (
    <SimPage
      route="home"
      world="cockpit-home"
      defaultKade="warning"
      heroOverride={{
        eyebrow: "Out of bounds",
        h1: "This room isn't in beta yet",
        sub: "Per-blocker stop pages (free cap · payment · Whop handoff · export · auth) ship after the engine port. Go Home to pick a real route.",
      }}
      keyPanel={{
        eyebrow: "Status",
        headline: "Not part of 0.8.0 beta",
        sub: "Use Home to navigate · use Inbox (bell, top-right) for messages.",
      }}
    />
  );
}
