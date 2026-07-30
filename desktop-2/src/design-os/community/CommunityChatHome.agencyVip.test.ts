/**
 * CommunityChatHome · agency-vip real-entitlement gate · regression guard.
 * 2026-07-30.
 *
 * junior-backend's chat.py fully supports "agency-vip" as a real
 * channel (in ALLOWED_CHANNELS, with a working _can_access gate:
 * `is_admin_email(user.email) or user.founder_flag or bool(user.whop_user_id)`).
 * The frontend's pendingRooms list hardcoded `locked: true`
 * unconditionally for it regardless of the signed-in user's real
 * entitlement — a genuine paying Agency member with a linked Whop
 * account could never actually use their own paid perk through
 * Community chat, because the room always rendered locked and
 * `chatEnabled = !activeRoom.locked` never fired.
 *
 * Source-file grep pattern — desktop-2 has no @testing-library/react
 * dependency; see CancellationIntercept / TopHud test files for the
 * same established convention.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = readFileSync(resolve(__dirname, "CommunityChatHome.tsx"), "utf-8");

describe("CommunityChatHome · agency-vip entitlement gate", () => {
  it("derives lock state from the real /me snapshot, not a hardcoded literal", () => {
    expect(SRC).toMatch(
      /const canAccessAgencyVip =\s*\n?\s*Boolean\(me\.snapshot\?\.whopUserId\)\s*\|\|\s*me\.snapshot\?\.adminOverride === true;/,
    );
  });

  it("the agency-vip pendingRooms entry uses the derived flag, not `locked: true`", () => {
    const roomBlock = SRC.match(
      /slug: "agency-vip",[\s\S]*?pending: true,\s*\n\s*\},/,
    );
    expect(roomBlock).not.toBeNull();
    expect(roomBlock![0]).toContain("locked: !canAccessAgencyVip");
    expect(roomBlock![0]).not.toContain("locked: true");
  });

  it("roomCapabilityMessage only shows the blocking pending copy when the room is ALSO locked", () => {
    // Regression: this used to key off `activeRoom.pending` alone, so
    // an entitled (unlocked) agency-vip room still showed "Agency
    // account required" forever.
    expect(SRC).toMatch(
      /const roomCapabilityMessage = activeRoom\.pending && activeRoom\.locked/,
    );
  });

  it("clippers-lounge (no backend channel exists for it at all) stays hard-locked", () => {
    const roomBlock = SRC.match(
      /slug: "clippers-lounge",[\s\S]*?pending: true,\s*\n\s*\},/,
    );
    expect(roomBlock).not.toBeNull();
    expect(roomBlock![0]).toContain("locked: true");
  });
});
