# Impact Report Template · Wave Contract

Every commit inside a wave branch produces an Impact Report at:

`lcos/reports/impact/<branch>/<commit-sha>.md`

Doctor Lite can auto-generate a draft; the wave owner must review + supplement before commit.

---

## Commit Impact Report

**Branch:** `wave-<N>/<cluster-slug>`
**Commit SHA:** `<sha>`
**Author (LCOS wave owner):** `<agent | human>`
**Cluster:** `<cluster.id>` (e.g. `cluster-1.identity-ladder`)
**Bugs targeted:** `[BUG-XXX, ...]`
**Time:** `<UTC>`

---

### 1. Files changed

| File | Change type (add / edit / delete) | Owner (LCOS) | Line-range |
|---|---|---|---|
| `<path>` | | | |

### 2. Canonical owner change

**Before:** `<state.id · owner · writers[]>`
**After:** `<state.id · owner · writers[]>`
**Duplicate writers removed:** `[...]`
**Duplicate writers preserved (with justification):** `[...]`

> **Wave contract rule:** if this section shows synchronisation between two writers instead of removal, the wave must STOP and report to Daniel.

### 3. Chain-link updates

| Layer | Before | After | Delta |
|---|---|---|---|
| Mission fingerprint | `[M1..M4]` | | |
| Capability | | | |
| Feature | | | |
| Journey | | | |
| Station | | | |
| Canonical state | | | |

### 4. Journeys affected

| Journey ID | Before status | After status (predicted) | Verification method |
|---|---|---|---|
| `j001-...` | GREEN/AMBER/RED | | Doctor Lite / manual walk / test |

### 5. Golden paths affected

| Path | Impact |
|---|---|

### 6. Business capabilities affected

| Capability | Impact | Mission fingerprint delta |
|---|---|---|

### 7. Telemetry

**Topics added or changed:**
| Topic | Payload | Consumer | Persistence (stdout · HQ) |
|---|---|---|---|

**Topics deleted:**
| Topic | Reason | Backfill test |
|---|---|---|

### 8. Regression tests

**Added:**
| Test ID | File | Protects (node.id or edge) |
|---|---|---|

**Modified:**
| Test ID | Reason |
|---|---|

**Deleted:**
| Test ID | Justification |
|---|---|

### 9. Risk assessment

- **Risk level:** LOW / MEDIUM / HIGH / CRITICAL
- **Blast radius:** [downstream nodes affected]
- **Shell impact:** none / runtime / native (must be `none` unless DECISION-0003 exemption cited)
- **Ship-lens P0/P1 predicted:** [list]
- **Rollback complexity:** LOW / MEDIUM / HIGH

### 10. Rollback plan

**Pre-commit hash:** `<sha>`
**Rollback command:** `git revert <sha>` or `git reset --hard <pre-sha>`
**Data-migration reverse:** `[SQL or file operations if any]`
**Telemetry cleanup on rollback:** `[topics to remove from consumers]`
**Verification after rollback:** `[test to prove product returned to prior state]`

### 11. Bug status transitions (post-merge)

| Bug ID | Before | After | Blocks CLOSED on |
|---|---|---|---|
| `BUG-XXX` | OPEN | IN_PROGRESS / FIXED_UNPROVEN | `[Doctor Full assertions still owed]` |

> **Reminder:** No bug flips to CLOSED in an Impact Report. Only Doctor Full may CLOSED · after scanners.

### 12. Live customer walkthrough steps (for FIXED_UNPROVEN → CLOSED prep)

Ordered steps a human tester runs on the promoted bundle:

1. `<step>` → expected UI → expected telemetry
2. `<step>` → …

### 13. Doctor Lite verdict

Paste Doctor Lite output on this branch:

```
LCOS DOCTOR (LITE) · <utc> · source_sha <sha> · scanner_v <ver>
<paste full output>
```

### 14. Reviewer sign-off

- **Ship-lens:** PASS / HOLD (findings list)
- **Human reviewer:** `<name>` · verdict
- **Rollback rehearsed:** yes / no
- **Merged:** yes / no
- **If merged:** post-merge Doctor Lite re-run confirms:
  - graph freshness restored
  - no orphan nodes introduced
  - no new invariant violations
  - bug status transitions accepted

### 15. Bug class + class-elimination progress (DECISION-0011)

Per bug transitioned in this commit, cite:

| Bug ID | Bug class (BC-XXX) | Class-elimination pattern applied | Class instances eliminated by this commit | Class status after commit | Deferred class-elimination ticket (if symptom-only) |
|---|---|---|---|---|---|
| `BUG-XXX` | | | | open / in-progress / closed-app-wide | |

If a fix is symptom-only (no class-elimination pattern applied), the ledger row MUST cite the deferred class-elimination ticket. Symptom-only fixes are permitted only when class-level fix requires a larger wave; they are not permitted as the default.

### 16. Eight-question auto-answers per DECISION-0010

Per bug transitioned:

1. **Golden paths blocked (before → after):**
2. **Business capabilities degraded (before → after):**
3. **Canonical states affected:**
4. **Journeys that fail (before → after):**
5. **Telemetry that should have detected:**
6. **Tests that should have failed (before → after):**
7. **Sibling bugs by root cause:**
8. **Permanent architectural fix (referenced in §15):**

Unknown answers are permitted only as explicit gap flags (`gap:*`). Empty answers = merge blocked.

### 17. Provenance record

Every file changed in this commit must be traceable. Report:

| File | Origin (commit / session / author) | Reviewed? | Provenance verdict (permanent · isolated · deleted) |
|---|---|---|---|

Unknown provenance triggers investigation (see `WAVE_LIFECYCLE.md` step 3.5), never silent absorption.

---

## Rules

- Every field mandatory. Empty = incomplete report = merge blocked.
- Only Doctor Full may write `Status: CLOSED` in section 11.
- The wave contract (DECISION-0009) is enforced by ship-lens post-P11.
- Until ship-lens has the drift-enforcement hook, Impact Reports are honor-system + human review.
- §15 + §16 + §17 added 2026-07-12 per DECISION-0010 + DECISION-0011.
