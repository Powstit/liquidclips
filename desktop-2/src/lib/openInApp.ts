/**
 * openInApp · Universal browser handoff router.
 *
 * The goal Daniel set: never leave the app for http(s) URLs. The in-app
 * BrowseOverlay is globally mounted (App.tsx), so any web URL routes into
 * it instead of macOS Safari.
 *
 * Routing:
 *   • http(s) URL   → useBrowseOverlay.getState().openWith(url) · in-app
 *   • mailto: / tel: → openSmart · last-resort system handler (no in-app
 *                       equivalent for Mail / Phone)
 *   • filesystem path / asset:// → openSmart · Finder / opener plugin
 *
 * Call sites should prefer this helper over `openSmart` for user-visible
 * navigations (Whop checkouts, wallet onboarding, campaign links, referral
 * shares). Filesystem reveals ("Show in Finder", "Open folder") stay on
 * `openSmart` directly since that's the correct OS handler.
 */
import { openSmart } from "./openSmart";
import { useBrowseOverlay } from "../state/browseOverlay";
import type { BrowseIntent } from "../state/browseOverlay";

const HTTP_URL = /^https?:/i;
const MAILTO_TEL = /^(mailto|tel):/i;

export interface OpenInAppOpts {
  /** Optional tag surfaced by the overlay + toast for context. */
  title?: string;
  /** Browse intent · defaults to "browse-external" so the overlay
   *  chrome distinguishes user-driven browsing from campaign flows. */
  intent?: BrowseIntent;
}

export async function openInApp(url: string, opts: OpenInAppOpts = {}): Promise<void> {
  if (!url) return;
  if (HTTP_URL.test(url)) {
    // In-app overlay wins — no macOS Safari, no focus theft.
    useBrowseOverlay.getState().openWith(url, opts.intent ?? "browse-campaign");
    return;
  }
  if (MAILTO_TEL.test(url)) {
    // Mail / phone must reach the OS handler — no in-app equivalent.
    await openSmart(url);
    return;
  }
  // Filesystem path or asset:// URL — Finder / opener plugin.
  await openSmart(url);
}
