# Repair-Priority Graph · regenerated post-Wave-1

**Regenerated:** 2026-07-12 post-Wave-1 merge (`cc6784c7`).
**Supersedes:** `lcos/reports/REPAIR_PLAN_P1.md` (frozen · pre-Wave-1 ranking).
**Purpose:** rank remaining bugs by golden-paths-unblocked × business consequence × recurrence-risk × class-elimination leverage.

---

## Post-Wave-1 rank

### Rank 1 · Cluster 2 · Whop CTA visibility (Wave 2)

- **Members:** BUG-004 (P1), BUG-014 (P1)
- **Class elimination target:** BC-002 (multi-source-of-truth · Whop connection status has no persistent chip)
- **Mission fingerprint:** M2 (Revenue) DEGRADED
- **Business consequence peak:** `Revenue HIGH · Conversion HIGH`
- **Blocks funnel:** unlinked user → Whop → MRR
- **Recurrence risk:** LOW (UI addition to specific mount sites)
- **Implementation risk:** LOW-MEDIUM · component design + 2 mount sites + 2 tests
- **Ready:** yes · file ownership disjoint from any pending work
- **Estimated size:** ~400 lines · 3 files touched · 1 new component · 2 tests

### Rank 2 · Cluster 3 · Tier propagation sweep (Wave 2 piggyback)

- **Members:** BUG-008 (P1)
- **Class elimination target:** BC-002 · BC-005 (prop-carried tier defaults survived earlier state-drift trifecta in 3 components)
- **Mission fingerprint:** M2 (Revenue) DEGRADED (agency users don't get preset unlocks)
- **Recurrence risk:** MEDIUM (same pattern will resurface without regression test naming the pattern)
- **Implementation risk:** LOW · localized · same pattern as state-drift-fixed P1-B
- **Ready:** yes · can bundle with Cluster 2 or run standalone

### Rank 3 · Cluster 4 · Runtime version drift (Wave 3)

- **Members:** BUG-006 (P1), BUG-007 (P2)
- **Class elimination target:** BC-002 (single source of truth for "which bundle is rendering")
- **Mission fingerprint:** M3 (Trust) DEGRADED (every promoted bundle displays stale shell version)
- **Support consequence:** HIGH · customer reports can't be triaged by version
- **BLOCKED ON:** Daniel decision · native Rust patch vs runtime-only workaround (DECISION-0003 exemption question)
- **Recurrence risk:** LOW once source of truth fixed
- **Implementation risk:** LOW (runtime workaround) · MEDIUM (native under freeze)

### Rank 4 · Cluster 5 · Runtime observability (Wave 4)

- **Members:** BUG-001 (P1), BUG-012 (P1)
- **Class elimination target:** BC-005 (no boot event proves which bundle rendered) · potentially BC-003 (hot-swap Cmd+R behavior may reveal a dev-only path)
- **No direct customer impact** but blocks Phase-2 perf optimization + all future runtime debugging
- **Blocked on Cluster 4 partially** (need runtime version to be correct for boot event to be useful)
- **Recurrence risk:** HIGH · this is a recurring source of confusion (three thread instances)
- **Implementation risk:** MEDIUM · Cmd+R behavior may need native investigation

### Standalone bugs · later

- **BUG-005 (P2 · Notifications badge)** — needs product decision (a wire `/notifications` or b explicit `Local · not synced` chip). Not scheduled until decision.
- **BUG-009 (P2 · UpdateBeacon 404)** — backend + frontend patch · low priority · schedule after Wave 4.
- **BUG-010 (P2 · Learn nav)** — verification only · run in Wave 5 Journey QA walk.

## Parallelisation eligibility

Waves 2 clusters share zero files with Waves 3-4. Waves 2 subclusters share zero files with each other. **Wave 2 could dispatch two implementers in parallel** IF Daniel greenlights, since Cluster 2 (Whop chip · CommandRoom · WalletDetail · Settings · AffiliateWidget) and Cluster 3 (ExportPanel · OverlayTemplateGallery · ReactionControls) are file-disjoint.

But per DECISION-0009 single-agent-per-cluster remains the default until canonical ownership for each cluster is proven. Recommend one Wave 2 agent per cluster.

## Wave 2 eligibility gate

Per DECISION-0009 post-wave-lands regeneration barrier, Wave 2 dispatch is now eligible IF:

- ✅ Wave 1 landed on `integration/cold-entry-mode-b` (merge commit `cc6784c7`)
- ✅ All 4 LCOS graphs regenerated (this file + `dependency.md` + `impact.md` + `bugs.json` schema-2)
- ✅ Post-merge Impact Report written
- ⏸ Daniel greenlight required for dispatch
- ⏸ Ledger retrofit for Wave 2 cluster rows (currently `audit-owed`) recommended before dispatch

## What's ranked #1 for reasons

Cluster 2 (Whop CTA) beats Cluster 3 (Tier propagation) for #1 because:
- Cluster 2 fingerprint delta is M2 direct (Revenue path)
- Cluster 3 is a Class-BC-002 sibling sweep with lower customer surface
- Bundle them together in Wave 2 for maximum class-elimination leverage on BC-002 in a single wave

Cluster 4 · 5 sit behind Cluster 2 · 3 because they're M3 (Trust) not M2 (Revenue) and one is blocked on a Daniel decision.

Standalone bugs stay standalone because their canonical-owner + class-elimination pattern is unclear without upstream product decisions.
