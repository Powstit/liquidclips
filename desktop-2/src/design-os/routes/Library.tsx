/**
 * LibraryRoute · BUG-042 honest-stub
 *
 * The Library route previously rendered a separate `fakeClips` fixture
 * grid that could not actually open into the editor — divergent source
 * of truth vs. Workstation's canonical `session.project.clips` grid,
 * AND a broken handoff (tile click fired a toast + nav with no clip
 * identity).
 *
 * The canonical "My Clips" surface for the customer is the Workstation
 * grid (already harness-locked by `full_clipping`, `export_clip`,
 * `trim_clip`, `caption_editing`, `reaction_editing`, `watermark_proof`,
 * `style_journey`, `home_dashboard`, `generate_create`). The Home tile
 * "My Clips" already routes there.
 *
 * This route is now a thin honest-stub that:
 *   - tells the customer where their real clips live today
 *   - one-clicks to Workstation
 *   - does NOT pretend to render clips that can't actually open
 *   - is honest about Library-as-a-separate-archive being COMING SOON
 *
 * No fake-toast lies. No divergent source. No invented data.
 */

import { motion as fm } from "framer-motion";
import { DesignOSAppShell } from "../components/AppShell";
import { EngineSessionProvider, useEngineSession } from "../state/useEngineSession";
import { useKadeFromSession } from "../state/useKadeFromSession";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { ROUTE_HERO } from "../copy/copyMap";
import { presets } from "../motion";
import { bus } from "../bridge";
import "./SimPage.css";
import "./Library.css";

function LibraryBody() {
  const session = useEngineSession();
  useKadeFromSession("library");

  const spec = ROUTE_REGISTRY["library"];
  const hero = ROUTE_HERO["library"];

  const goWorkstation = () => bus.emit("nav:click", { route: "workstation" });
  const goCreate = () => bus.emit("nav:click", { route: "create" });

  // BUG-042 · honest signal · how many clips the customer has RIGHT NOW
  // in the canonical source (session.project.clips). Surface this so
  // the visible promise reflects real data, not a fixture.
  const liveClipCount = session.project?.clips.length ?? 0;

  return (
    <DesignOSAppShell
      world="cockpit-home"
      route="library"
      defaultKade={session.kade}
      kadePlacement={spec.kadePlacement}
    >
      <fm.div
        className="sim-stage"
        data-testid="library-stage"
        data-library-state="coming-soon"
        variants={presets.routeEnter}
        initial="initial"
        animate="animate"
      >
        <fm.div
          className="sim-welcome"
          data-kade-anchor
          variants={presets.staggerContainer}
          initial="initial"
          animate="animate"
        >
          <fm.span className="sim-eb" variants={presets.staggerItem}>
            {hero.eyebrow}
            <span
              data-testid="library-coming-soon-badge"
              className="lc-runtime-tag"
              title="Library archive lives in My Clips today. A standalone Library surface lands once /me/clips is wired."
              style={{ textTransform: "uppercase", letterSpacing: ".15em" }}
            >
              Library · coming soon
            </span>
          </fm.span>
          <fm.h1 className="sim-h1" variants={presets.staggerItem}>
            Your clips live in My Clips today
          </fm.h1>
          <fm.p
            className="sim-sub"
            data-testid="library-coming-soon-copy"
            variants={presets.staggerItem}
          >
            The standalone Library archive is coming soon. For now, your
            generated clips live in the Workstation grid — open My Clips to
            edit, trim, react, caption, and export.
          </fm.p>
        </fm.div>

        <div className="lc-library-empty" data-testid="library-redirect-block">
          {liveClipCount > 0 ? (
            <>
              <p
                className="lc-library-empty-title"
                data-testid="library-live-clip-count"
                data-clip-count={String(liveClipCount)}
              >
                {liveClipCount} clip{liveClipCount === 1 ? "" : "s"} ready in My Clips
              </p>
              <p className="lc-library-empty-sub">
                Open the Workstation grid to edit, trim, react, caption, and export.
              </p>
              <button
                type="button"
                data-testid="library-open-my-clips"
                className="lc-library-empty-cta"
                onClick={goWorkstation}
              >
                Open My Clips →
              </button>
            </>
          ) : (
            <>
              <p
                className="lc-library-empty-title"
                data-testid="library-no-clips"
              >
                No clips yet
              </p>
              <p className="lc-library-empty-sub">
                Drop a video in Create — the engine cuts a few candidate clips you can review and edit in My Clips.
              </p>
              <button
                type="button"
                data-testid="library-go-create"
                className="lc-library-empty-cta"
                onClick={goCreate}
              >
                Cut your first clip →
              </button>
            </>
          )}
        </div>
      </fm.div>
    </DesignOSAppShell>
  );
}

export function LibraryRoute() {
  return (
    <EngineSessionProvider resetOnRouteEnter>
      <LibraryBody />
    </EngineSessionProvider>
  );
}
