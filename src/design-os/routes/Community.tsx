/**
 * CommunityRoute · Kade-led native chat home.
 *
 * The route embeds the real `/chat/*` client instead of presenting a room-card
 * catalogue that jumps away to Whop. Unsupported room and presence contracts
 * are explicit capability states; no fixture messages, people, unread totals,
 * or online counts are painted as production data.
 */

import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineErrorBoundary } from "../components/EngineErrorBoundary";
import { presets } from "../motion";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { CommunityChatHome } from "../community/CommunityChatHome";
// ag-17 (2026-07-06) · Sovereign-Operator Protocol · wrap seeded-rooms
// list render so a mis-shaped room row (backend: seed_community_channels
// .py) can't take the Community route down.
import { Watchdog } from "../../lib/watchdog";
import "./SimPage.css";
import "./Community.css";

function CommunityBody() {
  const session = useEngineSession();
  useKadeFromSession("community");

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="community"
      defaultKade={session.kade}
      hideStickyKade
    >
      <fm.div
        className="sim-stage lc-community-stage"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        {/* 2026-07-05 · Wave 4 polish · route identity was previously in
            `lc-visually-hidden` so users landed here without a visible
            header telling them what screen they were on. Now visible +
            branded as `<h1 className="lc-section-title">`. Kept the
            data attributes so accessibility + kade anchoring keep
            working. */}
        <header className="lc-section-header">
          <span className="lc-section-eyebrow">
            <span className="lc-section-eyebrow-dot" /> chat · rooms · presence
          </span>
          <h1 className="lc-section-title" data-route-title="Community" data-kade-anchor>
            Community
          </h1>
          <p className="lc-section-subtitle">
            Live chat with clippers, agencies, and drop channels. No Discord tax.
          </p>
        </header>
        <Watchdog
          id="agency/ag-17/seeded-rooms"
          label="Community seeded rooms"
          cluster="agency"
          source="src/design-os/routes/Community.tsx:CommunityChatHome (backend seed_community_channels.py)"
        >
          <EngineErrorBoundary route="community" component="CommunityChatHome">
            <CommunityChatHome />
          </EngineErrorBoundary>
        </Watchdog>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function CommunityRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <CommunityBody />
    </EngineSessionProvider>
  );
}
