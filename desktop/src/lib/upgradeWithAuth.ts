// v0.7.68 P0 — "Upgrade" CTA guard.
//
// Problem: several surfaces call openAuthPanel("upgrade") while the desktop
// has no LICENSE_JWT. The user can pay on the web but the desktop keychain
// stays empty, so they remain locked after purchase.
//
// Solution: check the in-memory JWT cache first. If present, open the upgrade
// panel directly. If absent, start the connect-desktop activation flow in the
// browser and automatically open the upgrade panel once the desktop receives
// the license JWT (lc:desktop-auth-ready).

import { getCachedLicenseJwt } from "./backend";
import { openAuthPanel } from "../components/auth/useAuthPanel";
import { startActivation } from "./activation";

const ACTIVATION_TIMEOUT_MS = 5 * 60_000;

let queuedUpgrade = false;

export function openUpgradeWhenSignedIn(): void {
  if (getCachedLicenseJwt()) {
    queuedUpgrade = false;
    openAuthPanel("upgrade");
    return;
  }

  // Already waiting for an activation to finish; don't stack duplicate
  // listeners or open multiple panels.
  if (queuedUpgrade) return;
  queuedUpgrade = true;

  void startActivation({ via: "browser" });

  const onReady = () => {
    window.removeEventListener("lc:desktop-auth-ready", onReady);
    queuedUpgrade = false;
    openAuthPanel("upgrade");
  };
  window.addEventListener("lc:desktop-auth-ready", onReady);

  // Safety valve: if activation fails/times out, clear the queue so the
  // user can retry the CTA. Matches activation.ts's 5-minute timeout.
  window.setTimeout(() => {
    window.removeEventListener("lc:desktop-auth-ready", onReady);
    queuedUpgrade = false;
  }, ACTIVATION_TIMEOUT_MS);
}
