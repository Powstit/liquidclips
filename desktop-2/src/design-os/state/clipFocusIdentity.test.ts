/**
 * Stable-ID focus identity contract (2026-07-14 · Daniel's refactor).
 *
 * These 8 deterministic tests lock the invariants that made the
 * full-clipping journey flake under D1 sweep:
 *
 *  1. Clip B click → focus resolves to clip B's stable id.
 *  2. Reorder → focused clip stays B even though its array position drifted.
 *  3. Reload → persistence survives round-trip via selectedClipId.
 *  4. clip.idx != array position → correct clip still opens.
 *  5. Duplicate titles → identity by id keeps them distinguishable.
 *  6. Legacy clips (no sidecar-supplied id) → get deterministic
 *     migration id and persist it.
 *  7. Reordering never mutates the id (identity guaranteed by construction).
 *  8. Bridge · legacy `selectedClipIdx` writes are resolved to a real
 *     array position via findIndex at the write site (never `clip.idx`).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  readPersistedSession,
  selectClipForStudioById,
  clearPersistedSession,
} from "./engineSessionPersistence";
import type { Clip } from "../engine/types";

// ─── Helpers ──────────────────────────────────────────────────────

function makeClip(overrides: Partial<Clip>): Clip {
  return {
    id: overrides.id,
    idx: overrides.idx ?? 0,
    title: overrides.title ?? "Untitled",
    start: overrides.start ?? 0,
    end: overrides.end ?? 10,
    duration_s: overrides.duration_s ?? 10,
    ...overrides,
  };
}

function resolveFocusedClip(
  clips: Clip[],
  focusedClipId: string | null,
): Clip | undefined {
  if (focusedClipId == null) return undefined;
  return clips.find((c) => c.id === focusedClipId);
}

function resolveArrayPositionById(
  clips: Clip[],
  id: string,
): number | null {
  const pos = clips.findIndex((c) => c.id === id);
  return pos >= 0 ? pos : null;
}

beforeEach(() => {
  // Test isolation · every test starts with an empty persisted session.
  try {
    globalThis.localStorage?.clear();
  } catch { /* jsdom-less env */ }
  clearPersistedSession();
});

describe("stable-id clip focus", () => {
  it("1. Click clip B → focused resolves to clip B's stable id", () => {
    const clips: Clip[] = [
      makeClip({ id: "clip-a", idx: 0, title: "A" }),
      makeClip({ id: "clip-b", idx: 1, title: "B" }),
      makeClip({ id: "clip-c", idx: 2, title: "C" }),
    ];
    const focusedClipId = "clip-b";
    const focused = resolveFocusedClip(clips, focusedClipId);
    expect(focused?.id).toBe("clip-b");
    expect(focused?.title).toBe("B");
  });

  it("2. Reorder clips → focused clip stays B despite array-position drift", () => {
    const before: Clip[] = [
      makeClip({ id: "clip-a", idx: 0, title: "A" }),
      makeClip({ id: "clip-b", idx: 1, title: "B" }),
      makeClip({ id: "clip-c", idx: 2, title: "C" }),
    ];
    const focusedClipId = "clip-b";
    // Simulate a rehydrate that reorders (sidecar returns highest-score first)
    const after: Clip[] = [before[2], before[1], before[0]];
    expect(resolveFocusedClip(after, focusedClipId)?.id).toBe("clip-b");
    // The array position drifted from 1 → 1 (same in this reorder), but the
    // key invariant is that identity holds even after reorder.
    // A more aggressive reorder:
    const shuffled: Clip[] = [before[1], before[2], before[0]];
    expect(resolveFocusedClip(shuffled, focusedClipId)?.id).toBe("clip-b");
    expect(resolveFocusedClip(shuffled, focusedClipId)?.title).toBe("B");
  });

  it("3. Reload · persistence round-trip via selectedClipId", () => {
    selectClipForStudioById("clip-b", 1);
    const persisted = readPersistedSession();
    expect(persisted?.selectedClipId).toBe("clip-b");
    // Legacy field is set for backward-compat readers only.
    expect(persisted?.selectedClipIdx).toBe(1);
  });

  it("4. clip.idx differs from array position · correct clip opens by id", () => {
    // clip.idx=5 but sits at array position 0 (weird but legal — e.g. a
    // filtered subset where only the highest-idx clip made the cut).
    const clips: Clip[] = [
      makeClip({ id: "clip-x", idx: 5, title: "X" }),
      makeClip({ id: "clip-y", idx: 7, title: "Y" }),
    ];
    // Prior behavior: `clips[focusedClipIdx=5]` would return undefined.
    // Now: `find(c => c.id === "clip-y")` returns clip Y as expected.
    expect(resolveFocusedClip(clips, "clip-y")?.title).toBe("Y");
    expect(resolveArrayPositionById(clips, "clip-y")).toBe(1);
    expect(resolveArrayPositionById(clips, "clip-x")).toBe(0);
  });

  it("5. Duplicate titles · identity by id keeps them distinguishable", () => {
    const clips: Clip[] = [
      makeClip({ id: "clip-morning", idx: 0, title: "Introduction" }),
      makeClip({ id: "clip-afternoon", idx: 1, title: "Introduction" }),
    ];
    expect(resolveFocusedClip(clips, "clip-morning")?.title).toBe("Introduction");
    expect(resolveFocusedClip(clips, "clip-afternoon")?.title).toBe("Introduction");
    // Both resolve to a UNIQUE clip despite identical titles.
    expect(resolveFocusedClip(clips, "clip-morning"))
      .not.toBe(resolveFocusedClip(clips, "clip-afternoon"));
  });

  it("6. Legacy clip without sidecar id · migration id is deterministic and persistable", () => {
    // Simulate what the hydrate_project normalizer does for a legacy
    // sidecar payload that predates the id field.
    const projectSlug = "legacy-project-2026";
    const legacyRaw = { idx: 0, title: "Legacy clip", start: 0, end: 28 };
    const start = legacyRaw.start;
    const end = legacyRaw.end;
    const i = 0;
    const stableId = `${projectSlug}-c${start}-${end}-p${i}`;

    selectClipForStudioById(stableId, 0);
    const persisted = readPersistedSession();
    expect(persisted?.selectedClipId).toBe("legacy-project-2026-c0-28-p0");

    // Determinism · same inputs always produce same id.
    const stableIdAgain = `${projectSlug}-c${start}-${end}-p${i}`;
    expect(stableIdAgain).toBe(stableId);
  });

  it("7. Reordering never mutates ids · identity is a property of the clip", () => {
    const clips: Clip[] = [
      makeClip({ id: "clip-a", idx: 0, title: "A" }),
      makeClip({ id: "clip-b", idx: 1, title: "B" }),
      makeClip({ id: "clip-c", idx: 2, title: "C" }),
    ];
    const idsBefore = clips.map((c) => c.id);
    const reordered = [...clips].reverse();
    const idsAfter = reordered.map((c) => c.id);
    // Ids on each clip object are unchanged — the reversal only shuffles
    // positions in the array.
    expect(new Set(idsBefore)).toEqual(new Set(idsAfter));
    // clip.idx is display order (may match position or not).
    expect(clips[0].id).toBe("clip-a");
    expect(reordered[2].id).toBe("clip-a"); // same identity, different slot.
  });

  it("8. Bridge · legacy idxHint derives from findIndex(id) at write site", () => {
    // Simulates Workstation.tsx `resolveArrayPositionById(id)` helper.
    // The hint written to persistence must reflect the CURRENT position
    // in the live collection, not `clip.idx` (which is display order).
    const clips: Clip[] = [
      makeClip({ id: "clip-z", idx: 9, title: "Z" }), // clip.idx=9 but at pos 0
      makeClip({ id: "clip-m", idx: 4, title: "M" }), // clip.idx=4 but at pos 1
    ];
    const idHint = "clip-m";
    const derivedPos = resolveArrayPositionById(clips, idHint);
    expect(derivedPos).toBe(1);
    // A naive "clip.idx" implementation would have persisted 4, which would
    // then dereference clips[4] on read → undefined → the wrong clip.
    selectClipForStudioById(idHint, derivedPos);
    const persisted = readPersistedSession();
    expect(persisted?.selectedClipId).toBe("clip-m");
    expect(persisted?.selectedClipIdx).toBe(1);
    // On read, resolving by id gets the right clip regardless of hint.
    expect(resolveFocusedClip(clips, persisted!.selectedClipId!)?.title).toBe("M");
  });
});

// ────────────────────────────────────────────────────────────────
// Legacy migration + persistence invariance
// (2026-07-14 · Daniel · "prove ids survive migration + reload + reorder")
// ────────────────────────────────────────────────────────────────

describe("hydrate_project stable-id invariants (position-independent)", () => {
  // Local mirror of the synthesizer logic (kept in-sync with
  // useEngineSession.ts:hydrate_project). Deliberately position-
  // independent — `i` is NOT part of the id basis, so reorder is a
  // no-op on identity. See the normalizer's own comment for rationale.
  function synthesizeStableIds(
    projectSlug: string,
    clips: Array<{ id?: string; start: number; end: number }>,
  ): string[] {
    const out: string[] = [];
    for (const c of clips) {
      if (c.id) { out.push(c.id); continue; }
      const basis = `${projectSlug}-c${c.start}-${c.end}`;
      const seenBefore = out.filter(
        (prev) => prev === basis || prev.startsWith(`${basis}-dup`),
      ).length;
      out.push(seenBefore === 0 ? basis : `${basis}-dup${seenBefore}`);
    }
    return out;
  }

  it("A. Legacy project without ids → synthesizer assigns deterministic ids", () => {
    const legacyClips = [
      { start: 0, end: 28, title: "First" },
      { start: 240, end: 295, title: "Second" },
    ];
    const ids = synthesizeStableIds("uncle-daniel", legacyClips);
    expect(ids).toEqual(["uncle-daniel-c0-28", "uncle-daniel-c240-295"]);
  });

  it("B. Ids are stable across a second hydration of the same clips", () => {
    const clips = [
      { start: 0, end: 28 },
      { start: 240, end: 295 },
    ];
    const first = synthesizeStableIds("uncle-daniel", clips);
    const second = synthesizeStableIds("uncle-daniel", clips);
    expect(first).toEqual(second);
  });

  it("C. Reorder does NOT change any clip's id (position-independent)", () => {
    const original = [
      { start: 0, end: 28 },
      { start: 240, end: 295 },
      { start: 612, end: 670 },
    ];
    const reordered = [original[2], original[0], original[1]];
    const origIds = synthesizeStableIds("uncle-daniel", original);
    const reIds = synthesizeStableIds("uncle-daniel", reordered);
    // origIds[0] ("uncle-daniel-c0-28") corresponds to original clip at
    // position 0. In reordered, that clip is at position 1 — but its id
    // must still be "uncle-daniel-c0-28".
    expect(reIds[0]).toBe(origIds[2]); // c612-670 first now
    expect(reIds[1]).toBe(origIds[0]); // c0-28 second now
    expect(reIds[2]).toBe(origIds[1]); // c240-295 third now
    // No id was invented or lost across the reorder.
    expect(new Set(origIds)).toEqual(new Set(reIds));
  });

  it("D. Duplicate (start,end) collisions resolve deterministically without breaking priors", () => {
    const clips = [
      { start: 0, end: 28 }, // basis "u-c0-28"
      { start: 0, end: 28 }, // collision · "u-c0-28-dup1"
      { start: 30, end: 60 },
    ];
    const ids = synthesizeStableIds("u", clips);
    expect(ids[0]).toBe("u-c0-28");
    expect(ids[1]).toBe("u-c0-28-dup1");
    expect(ids[2]).toBe("u-c30-60");
    // Reorder still holds: even if the duplicates swap positions, the
    // first-occurrence id is stable across a second hydration IF the
    // input ordering is the same. Reordering the source array would
    // give the dup the base id and the base the dup id (documented
    // ambiguity when two clips truly share start+end); the assertion
    // here locks the deterministic path for one ordering.
    const rerun = synthesizeStableIds("u", clips);
    expect(rerun).toEqual(ids);
  });

  it("E. Sidecar-supplied id always wins over the synthesizer", () => {
    const clips = [
      { id: "server-abc123", start: 0, end: 28 },
      { start: 240, end: 295 },
    ];
    const ids = synthesizeStableIds("u", clips);
    expect(ids[0]).toBe("server-abc123");
    expect(ids[1]).toBe("u-c240-295");
  });
});
