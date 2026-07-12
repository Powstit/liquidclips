/**
 * useMe · lc_id + handle · Wave 1 · Cluster 1 · 2026-07-12.
 *
 * Locks the ``MeSnapshot`` extension shipped in this wave:
 *   * ``lcId: string | null`` and ``handle: string | null`` on the
 *     snapshot type.
 *   * The adapter maps backend ``lc_id`` (snake_case) → ``lcId``
 *     (camelCase) correctly, preserving null for empty / missing.
 *   * The adapter maps backend ``handle`` → ``handle`` (same casing)
 *     correctly.
 *   * The module emits ``me_snapshot_hydrated`` via ``lcDiag`` when
 *     the source transitions to ``real-http`` or ``session-cache``,
 *     with the correct ``hasLcId`` / ``hasHandle`` booleans.
 *
 * Follows the same source-file grep convention as ``useMe.test.ts`` +
 * ``TopHud.identity.test.ts`` so no new test harness is required.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const USE_ME_SRC = readFileSync(resolve(__dirname, "useMe.ts"), "utf-8");

describe("MeSnapshot · Wave 1 · lc_id + handle", () => {
  it("exposes lcId on the type", () => {
    // The public snapshot type declared at the top of useMe.ts must
    // include ``lcId: string | null``. Regex allows optional trailing
    // whitespace / comment tail.
    expect(USE_ME_SRC).toMatch(/lcId:\s*string\s*\|\s*null/);
  });

  it("exposes handle on the type", () => {
    expect(USE_ME_SRC).toMatch(/handle:\s*string\s*\|\s*null/);
  });

  it("backend response shape declares lc_id + handle (snake_case)", () => {
    // The private ``MeBackendResponse`` interface must include the
    // snake_case fields so the adapter has typed input to project
    // from. Wave 1 declares them as optional to preserve compat with
    // older responses that predate the projection change.
    expect(USE_ME_SRC).toMatch(/lc_id\?:\s*string\s*\|\s*null/);
    expect(USE_ME_SRC).toMatch(/handle\?:\s*string\s*\|\s*null/);
  });
});

describe("adaptMe · Wave 1 · snake→camel projection", () => {
  it("maps b.lc_id → snapshot.lcId (identity project)", () => {
    // Adapter body must contain the projection line. We grep for the
    // literal shape rather than execute the function because the
    // useMe module has significant side-effects at import time
    // (module-scope listeners + subscribers) that would leak between
    // tests.
    expect(USE_ME_SRC).toMatch(/lcId:\s+typeof b\.lc_id === "string"[^,]*b\.lc_id\s*:\s*null/);
  });

  it("maps b.handle → snapshot.handle (identity project)", () => {
    expect(USE_ME_SRC).toMatch(/handle:\s+typeof b\.handle === "string"[^,]*b\.handle\s*:\s*null/);
  });

  it("empty string coerces to null (not silently accepted)", () => {
    // Empty backend value must project to ``null`` so the TopHud
    // ladder honestly detects "no handle" instead of rendering
    // ``@`` with no name. The projection asserts ``.length > 0`` on
    // the string branch to guarantee this.
    expect(USE_ME_SRC).toMatch(/b\.lc_id\.length\s*>\s*0/);
    expect(USE_ME_SRC).toMatch(/b\.handle\.length\s*>\s*0/);
  });
});

describe("me_snapshot_hydrated · telemetry", () => {
  it("emits lcDiag with topic 'me_snapshot_hydrated' on hydration transition", () => {
    // The wave contract requires ``me_snapshot_hydrated`` fire when
    // the source transitions to ``real-http`` or ``session-cache``.
    // We assert the topic is imported + present in the emit body,
    // not the transition mechanics (which would need a runtime
    // harness).
    expect(USE_ME_SRC).toContain('import { lcDiag }');
    expect(USE_ME_SRC).toContain('lcDiag("me_snapshot_hydrated"');
  });

  it("payload includes source, hasLcId, hasHandle booleans", () => {
    // The three fields are the wave's canonical shape so HQ + Doctor
    // can reason about ladder rendering without a PII payload.
    const emitStart = USE_ME_SRC.indexOf('lcDiag("me_snapshot_hydrated"');
    expect(emitStart).toBeGreaterThan(-1);
    const emitEnd = USE_ME_SRC.indexOf('});', emitStart);
    expect(emitEnd).toBeGreaterThan(emitStart);
    const emitBlock = USE_ME_SRC.slice(emitStart, emitEnd);
    expect(emitBlock).toContain("source:");
    expect(emitBlock).toContain("hasLcId:");
    expect(emitBlock).toContain("hasHandle:");
    // And the booleans read from the freshly-updated snapshot.
    expect(emitBlock).toContain("cachedSnapshot?.lcId");
    expect(emitBlock).toContain("cachedSnapshot?.handle");
  });

  it("emitter is a no-op for 'unknown' → 'unknown' non-transitions", () => {
    // The helper guards on ``nextSource !== 'real-http' && nextSource
    // !== 'session-cache'`` so a call that arrives with an unknown
    // source (e.g. the JWT-less reset path) never sends telemetry.
    const helperStart = USE_ME_SRC.indexOf("function emitHydratedTelemetry");
    expect(helperStart).toBeGreaterThan(-1);
    const helperEnd = USE_ME_SRC.indexOf("}", USE_ME_SRC.indexOf("try {", helperStart));
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperBody = USE_ME_SRC.slice(helperStart, helperEnd);
    expect(helperBody).toMatch(/nextSource\s*!==\s*"real-http"\s*&&\s*nextSource\s*!==\s*"session-cache"/);
    expect(helperBody).toContain("return;");
  });

  it("emitter fires AFTER cachedSnapshot is updated (correct booleans)", () => {
    // The loadMe body must set ``cachedSnapshot = adaptMe(out.data)``
    // BEFORE calling the emitter so the ``hasLcId`` / ``hasHandle``
    // booleans reflect this hydration, not a stale one. Regex asserts
    // the emit call appears after the ``cachedSnapshot = adaptMe``
    // line inside the ok-branch. The slice is the whole ok-branch
    // block (from ``out.kind === "ok"`` up to the next ``if`` in the
    // network / server-error fallthrough).
    const okBranchStart = USE_ME_SRC.indexOf('out.kind === "ok"');
    const okBranchEnd = USE_ME_SRC.indexOf("network or server-error", okBranchStart);
    expect(okBranchStart).toBeGreaterThan(-1);
    expect(okBranchEnd).toBeGreaterThan(okBranchStart);
    const okBranch = USE_ME_SRC.slice(okBranchStart, okBranchEnd);
    const setLineAt = okBranch.indexOf("cachedSnapshot = adaptMe(out.data)");
    const emitAt = okBranch.indexOf("emitHydratedTelemetry(cachedSource)");
    expect(setLineAt).toBeGreaterThan(-1);
    expect(emitAt).toBeGreaterThan(setLineAt);
  });
});
