/**
 * AssetRansomPaywallTestHook · SPRINT_FINAL §1H test seam
 * (Max · 2026-07-07)
 *
 * Dev-only. Playwright emits `test:open-ransom-paywall` via
 * `page.evaluate(() => window.__lcBus.emit("test:open-ransom-paywall",
 * { trigger: "clip-11-export" }))` · this component subscribes and
 * mounts a hidden AssetRansomPaywall with that trigger so the spec
 * can assert every trigger's headline + copy without walking through
 * a real user flow.
 *
 * Guarded by `import.meta.env.DEV` so the wrapper compiles out of
 * production bundles · zero runtime cost in installed builds.
 *
 * Mount at top-level in App.tsx alongside the AuthGate.
 */
import { useState, type ReactElement } from "react";
import { useEvent } from "../../design-os/bridge";
import { AssetRansomPaywall, type RansomTrigger } from "./AssetRansomPaywall";

export function AssetRansomPaywallTestHook(): ReactElement | null {
  // Never mount in production. Vite tree-shakes this component to
  // nothing when import.meta.env.DEV is false.
  if (!import.meta.env.DEV) return null;
  return <AssetRansomPaywallTestHookInner />;
}

function AssetRansomPaywallTestHookInner(): ReactElement | null {
  const [openTrigger, setOpenTrigger] = useState<RansomTrigger | null>(null);

  useEvent("test:open-ransom-paywall", (p) => {
    // Trust the string · union widening acceptable in dev-only surface.
    setOpenTrigger(p.trigger as RansomTrigger);
  });

  if (!openTrigger) return null;

  return (
    <AssetRansomPaywall
      trigger={openTrigger}
      assetPreview={{
        kind: "node",
        content: (
          <div style={{ padding: 40, color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}>
            test asset preview · trigger={openTrigger}
          </div>
        ),
      }}
      isOpen={true}
      onUnlocked={async () => {
        setOpenTrigger(null);
        // Broadcast so specs can assert the flow completed.
        try {
          (window as unknown as { __lc_test_ransom_unlocked?: (t: string) => void })
            .__lc_test_ransom_unlocked?.(openTrigger);
        } catch { /* non-fatal */ }
      }}
      onDismiss={() => setOpenTrigger(null)}
    />
  );
}
