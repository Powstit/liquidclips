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
        <h1 className="lc-visually-hidden" data-route-title="Community" data-kade-anchor>
          Community
        </h1>
        <EngineErrorBoundary route="community" component="CommunityChatHome">
          <CommunityChatHome />
        </EngineErrorBoundary>
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
