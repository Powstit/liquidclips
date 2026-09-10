/**
 * Settings · Advanced · Contacts referral card copy
 *
 * 2026-09-09: "Connect Google →" → "Connect Google Contacts →".
 * 2026-09-10: UI-only relabel of the same card to the native Apple/macOS
 *   Contacts direction — "Google" → "Apple Contacts",
 *   "Connect Google Contacts →" → "Connect Apple Contacts →". The button
 *   still calls the UNCHANGED handleOpenOutreachRoute; Google OAuth / the
 *   F5 scanner are untouched.
 *
 * SettingsRoute pulls in CursorGlow/StickyKade/AppShell effects that crash
 * under jsdom (canvas/animation APIs Settings.tsx has no control over) —
 * mounting the full 1800-line route isn't practical for a copy change and
 * would mean stubbing unrelated infrastructure just to reach this row.
 * Verifying at the source level instead: the new label is present, the old
 * one is gone, and the click-handler wiring — including
 * handleOpenOutreachRoute's own body — is untouched.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Settings.tsx"),
  "utf8",
);

describe("Settings · Advanced · Contacts referral card", () => {
  it('the card is labelled "Apple Contacts" with the native-Contacts referral copy', () => {
    expect(SOURCE).toContain(
      '<span className="lc-settings-provider-name">Apple Contacts</span>',
    );
    expect(SOURCE).toContain(
      "Pick contacts directly from your Mac to invite creators and",
    );
    expect(SOURCE).toContain("earn 50% of their subscription.");
  });

  it('the primary button reads "Connect Apple Contacts →"', () => {
    expect(SOURCE).toContain("Connect Apple Contacts →");
  });

  it("no longer surfaces the old Google-facing copy on this card", () => {
    expect(SOURCE).not.toContain("Connect Google Contacts →");
    expect(SOURCE).not.toContain("Connect Google →");
    expect(SOURCE).not.toContain(
      '<span className="lc-settings-provider-name">Google</span>',
    );
  });

  it("the button is still wired to the unchanged handleOpenOutreachRoute handler", () => {
    const idx = SOURCE.indexOf("Connect Apple Contacts →");
    expect(idx).toBeGreaterThan(-1);
    const preceding = SOURCE.slice(Math.max(0, idx - 400), idx);
    expect(preceding).toContain("onClick={handleOpenOutreachRoute}");
  });

  it("handleOpenOutreachRoute itself is unchanged (still navigates to #/outreach)", () => {
    expect(SOURCE).toMatch(
      /const handleOpenOutreachRoute = \(\) => \{\s*if \(typeof window === "undefined"\) return;\s*window\.location\.hash = "#\/outreach";\s*\};/,
    );
  });
});
