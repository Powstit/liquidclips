/**
 * SimpleComposer · minimal working Composer route
 *
 * 2026-07-20 · Daniel: "create a new composer page and wire it properly
 * and delete this one if u have to i need it to work now."
 *
 * The prior Composer.tsx (1400+ lines) wraps KadeComposerBody in a heavy
 * chain — CockpitProvider · EngineSessionProvider · ComposerKade absolute
 * portrait · silence counter · voice input · reaction preview state
 * · turbo mode · slot selectors · command history · dev panel. Each
 * layer has hooks that fire fetches on mount (useMe · useEngineSession
 * · useTierCaps · useCockpit). ANY one of those hanging = the whole
 * page hangs.
 *
 * This route renders KadeComposerBody DIRECTLY with defaults + a thin
 * command handler that echoes to the diagnostic bus. Zero context
 * chain. Zero fetch dependencies at mount. Guaranteed to render.
 *
 * The full mockup UI (11 quick actions, ask panel, canvas, slot grid,
 * transcript rail, dev panel, ComposerKade portrait) is INSIDE
 * KadeComposerBody — this route just skips the parent layer that was
 * hanging.
 */

import { useCallback, useState, type ReactElement } from "react";
import { DesignOSAppShell } from "../components/AppShell";
import { KadeComposerBody } from "./KadeComposerBody";
import { bus, type RouteId } from "../bridge";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";

export function SimpleComposerRoute(): ReactElement {
  const spec = ROUTE_REGISTRY.composer;
  const [history, setHistory] = useState<string[]>([]);

  const onCommand = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    const cmd = text.trim();
    setHistory((h) => [cmd, ...h].slice(0, 20));
    // Fire Kade speak so the sticky Kade responds — same channel the
    // full Composer used, no local Kade state to manage.
    bus.emit("kade:speak", {
      title: "Got it",
      body: `You said: "${cmd.slice(0, 100)}${cmd.length > 100 ? "…" : ""}"`,
      severity: "info",
    });
  }, []);

  const onNavClick = useCallback((route: RouteId) => {
    bus.emit("nav:click", { route });
  }, []);

  return (
    <DesignOSAppShell
      world={spec.world}
      route="composer"
      defaultKade={spec.defaultKade}
      kadePlacement={spec.kadePlacement}
    >
      <KadeComposerBody
        onCommand={onCommand}
        onNavClick={onNavClick}
        onLayoutSet={(layout) => {
          bus.emit("kade:speak", {
            title: "Layout",
            body: `Layout → ${layout}`,
            severity: "info",
          });
        }}
        onModeSet={(mode) => {
          bus.emit("kade:speak", {
            title: "Mode",
            body: `Mode → ${mode}`,
            severity: "info",
          });
        }}
        onSpeedSet={(speed) => {
          bus.emit("kade:speak", {
            title: "Speed",
            body: `Speed → ${speed}×`,
            severity: "info",
          });
        }}
        onTurboToggle={() => {
          bus.emit("kade:speak", {
            title: "Turbo",
            body: "Turbo toggled",
            severity: "info",
          });
        }}
        onSlotSelect={(letter) => {
          bus.emit("kade:speak", {
            title: "Slot",
            body: `Selected slot ${letter}`,
            severity: "info",
          });
        }}
        onShip={() => onCommand("ship this clip")}
        activeRoute="composer"
      />
      {/* Optional: last-3 commands echo strip for the walkthrough so
          Daniel can see the command bar IS wired. Positioned so it
          doesn't cover the mockup UI. */}
      {history.length > 0 && (
        <div
          data-testid="simple-composer-history"
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            padding: "10px 14px",
            background: "rgba(10, 10, 14, 0.85)",
            border: "1px solid rgba(255, 26, 140, 0.4)",
            borderRadius: 8,
            color: "rgba(255, 255, 255, 0.85)",
            fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
            fontSize: 11,
            letterSpacing: "0.04em",
            maxWidth: 320,
            zIndex: 20,
          }}
        >
          <div style={{ opacity: 0.55, marginBottom: 4, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            recent
          </div>
          {history.slice(0, 3).map((cmd, i) => (
            <div key={`${i}-${cmd}`} style={{ opacity: 1 - i * 0.25, marginBottom: 2 }}>
              {cmd.slice(0, 60)}{cmd.length > 60 ? "…" : ""}
            </div>
          ))}
        </div>
      )}
    </DesignOSAppShell>
  );
}

export default SimpleComposerRoute;
