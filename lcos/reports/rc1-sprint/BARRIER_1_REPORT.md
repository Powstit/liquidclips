# RC1 Sprint · Barrier 1 · Post-Train-A

**Barrier commit:** all three trains merged into `integration/cold-entry-mode-b` with `--no-ff`, followed by reconciliation commit.
**Time:** 2026-07-12

---

## Trains merged

| Train | Branch | SHA | Bugs → FIXED_UNPROVEN | Path deviation resolved |
|---|---|---|---|---|
| A1 | `wave-a1/identity-hydration` | `e53dd2a1` | BUG-015 · BUG-016 | `useAuth.ts` → `src/lib/useAuth.ts` |
| A2 | `wave-a2/whop-tier` | `5bdaf940` | BUG-004 · BUG-014 · BUG-008 | `rooms/`→`routes/` · `overlays/`+`reactions/`→`studio/` |
| A3 | `wave-a3/referral-journey` | `74914e96` | BUG-017 | `design-os/wallet/`→`routes/wallet-detail/` |

Zero merge conflicts on any file. All three agents modified `09_BUG_LEDGER.md` + `bugs.json` but on disjoint bug rows — git resolved automatically.

## Gates post-merge

| Gate | Result |
|---|---|
| tsc --noEmit | clean |
| vitest | 389/389 (43 files) |
| pytest | 391/391 |
| ship-lens | deferred to Barrier 2 (Train A did not change any ship-lens-tracked visual surface beyond expected) |

## Fixes applied at the barrier

1. **`test_desktop_auth_hardening.py` fixture bug.** Golden Path walk had wiped SQLite dev DB. TestClient(app) does not trigger lifespan; `desktop_auth_codes` table therefore missing. Added idempotent module-scope autouse fixture that pins the schema. Pytest back to 391/391.
2. **`bugs.json` totals reconciled.** Post-merge counter showed `{open: 10, fixed_unproven: 7}` (A2's stale snapshot). Corrected to `{open: 7, fixed_unproven: 10}` matching row-level truth.

## Path-deviation learnings (feed Train B ownership matrix)

Canonical current-repo layout learned this barrier:
- Hooks that shipped before 2026-07-11: `desktop-2/src/lib/*.ts` (e.g. `useAuth.ts`)
- Hooks added during / after 2026-07-11: `desktop-2/src/design-os/state/*.ts` (e.g. `useMe.ts`)
- Top-level route views: `desktop-2/src/routes/**/*.tsx` (e.g. `wallet-detail`, `CommandRoom`)
- Design-system + studio components: `desktop-2/src/design-os/**/*.tsx`
- Studio-tier components: `desktop-2/src/design-os/studio/*.tsx` (`ExportPanel`, `OverlayTemplateGallery`, `ReactionControls`)
- Components: `desktop-2/src/design-os/components/*.tsx`

Train B ownership matrix must use these paths verbatim. Any doubt → grep the repo before dispatching.

## Bugs.json state

```
totals: { open: 7, in_progress: 0, fixed_unproven: 10, closed: 0 }

FIXED_UNPROVEN (10):
  BUG-002 · BUG-003 · BUG-011 · BUG-013 (Wave 1)
  BUG-004 · BUG-008 · BUG-014 (Train A2 · BC-002 sweep)
  BUG-015 · BUG-016 (Train A1 · BC-002 + BC-001)
  BUG-017 (Train A3 · BC-004)

OPEN (7):
  BUG-001 · BUG-005 · BUG-006 · BUG-007 · BUG-009 · BUG-010 · BUG-012
```

## Class-elimination progress this barrier

| Bug class | Instances known | Instances eliminated · Train A | Status |
|---|---|---|---|
| BC-001 · Multi-writer state | 3 visible | 1 (auth writer self-heal · BUG-016) | in-progress |
| BC-002 · Multi-source-of-truth | 5 visible | 4 (identity kind · Whop CTA · tier propagation ×3 · BUG-015+004+008+014) | in-progress |
| BC-003 · Dev shortcut in prod path | 1 visible | 0 this barrier (closed by prior auth hardening) | closed-instance-1 |
| BC-004 · Journey no owner | 15 canonical | 1 (j010-referral authored · BUG-017) | in-progress |
| BC-005 · UI reading divergent stores | 2+ visible | 0 this barrier (closed by Wave 1) | in-progress |

## What's next

Barrier 2 · Trains B1 (runtime version), B2 (nav telemetry + perf), B3 (HQ persistence). Dispatch immediately follows this barrier commit.

## Deliverables (this barrier)

- Merged commits: A1 · A2 · A3 (three `--no-ff` merges)
- Fixture fix + totals reconcile: single follow-up commit
- This report

No push. No deploy. No shell touches. Bugs remain FIXED_UNPROVEN.
