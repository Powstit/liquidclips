/**
 * Settings · Google card button label (2026-09-09)
 *
 * Small, isolated copy fix: "Connect Google →" → "Connect Google Contacts →"
 * so the button doesn't read as a general Google-account connection.
 *
 * SettingsRoute pulls in CursorGlow/StickyKade/AppShell effects that crash
 * under jsdom (canvas/animation APIs Settings.tsx has no control over) —
 * mounting the full 1800-line route isn't practical for a one-line copy
 * change and would mean stubbing unrelated infrastructure just to reach
 * this row. Verifying at the source level instead: the new label is
 * present, the old one is gone, and the click handler wiring — including
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

describe("Settings · Google card button label", () => {
  it('contains "Connect Google Contacts →"', () => {
    expect(SOURCE).toContain("Connect Google Contacts →");
  });

  it('no longer contains the old "Connect Google →" label', () => {
    expect(SOURCE).not.toContain("Connect Google →");
  });

  it("the button is still wired to the unchanged handleOpenOutreachRoute handler", () => {
    const idx = SOURCE.indexOf("Connect Google Contacts →");
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
