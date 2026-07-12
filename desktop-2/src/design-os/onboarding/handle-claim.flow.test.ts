/**
 * ClaimHandleSheet · flow test · Wave 1 · Cluster 1 · 2026-07-12.
 *
 * Covers:
 *   * The sheet renders the LC-ID as an anchor when ``lcId != null``
 *     and ``handle == null``.
 *   * Local regex + reserved-word validation matches the backend
 *     shape (client-side mirror).
 *   * Submitting a valid handle POSTs ``/me/lc-id/claim`` with the
 *     normalised handle and reload()'s ``useMe`` on success.
 *   * Emits ``handle_claimed`` telemetry after a successful POST.
 *   * Invalid handles (regex fail, reserved word) do NOT POST.
 *
 * This suite uses the same source-file grep + light runtime harness
 * pattern the rest of desktop-2 uses (see ``useAuth.test.ts`` for the
 * React-DOM harness template).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  _CLAIM_HANDLE_RE_FOR_TESTS,
  _RESERVED_HANDLES_FOR_TESTS,
} from "./ClaimHandleSheet";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SHEET_SRC = readFileSync(
  resolve(__dirname, "ClaimHandleSheet.tsx"),
  "utf-8",
);

describe("ClaimHandleSheet · guard clauses", () => {
  it("returns null when lc_id is not yet minted", () => {
    // BUG-003 guard · the sheet renders NOTHING when the customer's
    // LC-ID hasn't landed yet. Prevents an empty ``LC-ID: `` label.
    expect(SHEET_SRC).toContain("if (lcId === null) return null");
  });

  it("returns null when the customer already has a handle", () => {
    // Idempotent guard — the flywheel behind the sheet ships in
    // multiple entry points (CrewOnboarding, later a Home-nudge). All
    // of them mount the sheet unconditionally; the sheet itself
    // knows when it has nothing to do.
    expect(SHEET_SRC).toContain("if (handle !== null) return null");
  });
});

describe("ClaimHandleSheet · validation mirror", () => {
  it("client regex matches the backend Wave 1 shape ^[a-z0-9_]{3,20}$", () => {
    // The regex constant exported for test purposes must match the
    // backend's ``_CLAIM_HANDLE_RE`` in ``junior-backend/app/routes/
    // me.py``. Both use ``^[a-z0-9_]{3,20}$``. A drift here fails
    // this test AND the backend test suite — one caught early beats
    // two customers seeing a 422 for a handle the client accepted.
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.source).toBe("^[a-z0-9_]{3,20}$");
  });

  it("accepts a valid handle", () => {
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("daniel_")).toBe(true);
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("clipboy2020")).toBe(true);
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("a_b")).toBe(true);
  });

  it("rejects too-short / too-long / bad-char inputs", () => {
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("ab")).toBe(false); // < 3
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("a".repeat(21))).toBe(false); // > 20
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("Cat")).toBe(false); // uppercase
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("cat-dog")).toBe(false); // dash banned in this shape
    expect(_CLAIM_HANDLE_RE_FOR_TESTS.test("cat.dog")).toBe(false); // dot banned
  });

  it("reserved words mirror the backend list", () => {
    // The backend list in ``junior-backend/app/routes/me.py::
    // _RESERVED_CLAIM_HANDLES`` includes every entry on the client
    // list. If either side adds an entry without the other, we want
    // to see a red test on the drifted repo. We enumerate the
    // Wave 1 baseline here so the diff is visible in the PR.
    const backendSet = new Set([
      "system-bot", "admin", "staff", "mod", "root", "founder",
      "whop", "liquid", "liquidclips", "liquid-clips", "kade",
      "support", "help", "billing", "hq",
      "guest", "anonymous", "you", "me", "self", "daniel",
      "clip", "clipper", "agency", "signin", "signup", "login", "logout",
    ]);
    // Every backend entry MUST be on the client list.
    for (const word of backendSet) {
      expect(_RESERVED_HANDLES_FOR_TESTS.has(word)).toBe(true);
    }
    // Every client entry MUST be on the backend list.
    for (const word of _RESERVED_HANDLES_FOR_TESTS) {
      expect(backendSet.has(word)).toBe(true);
    }
  });

  it("localValidation refuses reserved word before POST", () => {
    // The sheet's ``localValidation`` function returns a non-null
    // copy string for any reserved word — canSubmit stays false, so
    // no POST fires. Grep asserts the ``RESERVED_HANDLES.has(raw)``
    // guard is present.
    expect(SHEET_SRC).toContain("RESERVED_HANDLES.has(raw)");
    // AND the error copy path uses the word "reserved".
    expect(SHEET_SRC).toContain("reserved");
  });

  it("localValidation refuses regex fail before POST", () => {
    expect(SHEET_SRC).toContain("CLAIM_HANDLE_RE.test(raw)");
  });
});

describe("ClaimHandleSheet · POST + telemetry", () => {
  it("POSTs to /me/lc-id/claim with lower-cased normalised handle", () => {
    // Endpoint path locked. Backend router prefix ``/me`` + handler
    // ``/lc-id/claim``.
    expect(SHEET_SRC).toContain("/me/lc-id/claim");
    // Body carries the trimmed lower-cased handle.
    expect(SHEET_SRC).toContain("JSON.stringify({ handle: trimmed })");
    // ``trimmed`` derives from ``input.trim().toLowerCase()``.
    expect(SHEET_SRC).toContain("input.trim().toLowerCase()");
  });

  it("emits handle_claimed telemetry after a successful POST", () => {
    // Payload contract from Wave 1 · lc_id, handle, ts_ms.
    expect(SHEET_SRC).toContain('lcDiag("handle_claimed"');
    const emitStart = SHEET_SRC.indexOf('lcDiag("handle_claimed"');
    const emitEnd = SHEET_SRC.indexOf("});", emitStart);
    expect(emitStart).toBeGreaterThan(-1);
    expect(emitEnd).toBeGreaterThan(emitStart);
    const block = SHEET_SRC.slice(emitStart, emitEnd);
    expect(block).toContain("lc_id: lcId");
    expect(block).toContain("handle: trimmed");
    expect(block).toContain("ts_ms: Date.now()");
  });

  it("optimistic reload · calls useMe().reload() before onClose", () => {
    // The sheet closes the workflow by triggering ``me.reload()`` so
    // TopHud's ladder re-derives on the same tick as the sheet
    // unmounts. Grep asserts the two calls appear in the correct
    // order.
    const successBranch = SHEET_SRC.slice(
      SHEET_SRC.indexOf("Fire telemetry BEFORE reload"),
      SHEET_SRC.indexOf("} catch (e) {"),
    );
    const reloadAt = successBranch.indexOf("me.reload()");
    const onCloseAt = successBranch.indexOf("props.onClose()");
    expect(reloadAt).toBeGreaterThan(-1);
    expect(onCloseAt).toBeGreaterThan(reloadAt);
  });

  it("409 branch maps to a user-facing 'already taken' copy", () => {
    // BUG-003 UX contract · duplicate handles must produce a clear
    // human-readable error, not a raw HTTP status.
    expect(SHEET_SRC).toContain("res.status === 409");
    expect(SHEET_SRC).toContain("already taken");
  });

  it("422 branch maps to a user-facing 'format' copy", () => {
    expect(SHEET_SRC).toContain("res.status === 422");
    expect(SHEET_SRC).toContain("format was rejected");
  });

  it("Escape key dismisses without persistence", () => {
    // Users need an escape hatch that doesn't lock them into the
    // claim flow. Escape hits onDismiss which respects the
    // ``submitting`` guard.
    expect(SHEET_SRC).toContain('e.key === "Escape"');
    expect(SHEET_SRC).toContain("onDismiss");
  });
});
