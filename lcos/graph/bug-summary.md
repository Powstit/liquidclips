# Bug Summary · regenerated post-Wave-1

**Regenerated:** 2026-07-12 post-Wave-1 merge (`cc6784c7`).
**Companion to:** `bugs.json` (machine form) + `09_BUG_LEDGER.md` (long form).
**Purpose:** at-a-glance rollup for Doctor Lite + wave dispatch decisions.

---

## Totals

| Status | Count |
|---|---|
| OPEN | 10 |
| IN_PROGRESS | 0 |
| FIXED_UNPROVEN | 4 |
| CLOSED | **0** (per DECISION-0008 · only Doctor Full may close) |

## By class

| Class | Instances known | Instances eliminated by Wave 1 | Class status |
|---|---|---|---|
| BC-001 · Multi-writer state | 2 visible | 2 (handle writer + state-drift trifecta) | class-elimination-in-progress |
| BC-002 · Multi-source-of-truth | 3 visible · audit-owed | 1 (identity claim endpoint) | class-elimination-in-progress |
| BC-003 · Dev shortcut in prod path | 1 visible (auth audit today) | 1 | class-elimination-in-progress · pattern locked, application audit owed |
| BC-004 · Journey no canonical owner | 15 (all journeys) | 0 | open · P6 blocked |
| BC-005 · UI reading divergent stores | 2+ visible | 1 (identity ladder) | class-elimination-in-progress |

Non-Wave-1 rows are `audit-owed` on bug_class · full class attribution comes with the P4 audit sweep.

## By wave

| Wave | Bugs | Cluster | Status |
|---|---|---|---|
| 1 (landed cc6784c7) | BUG-002 · BUG-003 · BUG-011 · BUG-013 | Identity ladder | FIXED_UNPROVEN |
| 2 (eligible) | BUG-004 · BUG-014 | Whop CTA visibility | OPEN |
| 2 piggyback | BUG-008 | Tier propagation | OPEN |
| 3 | BUG-006 · BUG-007 | Runtime version drift | OPEN · blocked on Daniel Path A/B decision |
| 4 | BUG-001 · BUG-012 | Runtime observability | OPEN |
| 5 | BUG-010 | Learn nav visibility | OPEN |
| later | BUG-005 · BUG-009 | Standalone | OPEN |

## By P-rank (composite severity)

| Severity | Count | IDs |
|---|---|---|
| P0 | 1 | BUG-002 (FIXED_UNPROVEN) |
| P1 | 8 | BUG-001 · BUG-003 (FU) · BUG-004 · BUG-006 · BUG-008 · BUG-012 · BUG-014 · BUG-009 |
| P2 | 5 | BUG-005 · BUG-007 · BUG-010 · BUG-011 (FU) · BUG-013 (FU) |

## Mission fingerprint after Wave 1

| Mission | Fingerprint before Wave 1 | After |
|---|---|---|
| M1 (Reach) | AMBER (new users see Guest on OTP land) | GREEN-unproven |
| M2 (Revenue) | DEGRADED (Whop CTA hidden · tier defaults wrong) | unchanged (Wave 2 target) |
| M3 (Trust) | DEGRADED (Guest·Admin drift · handle absent) | GREEN-unproven for identity axis · still DEGRADED for version pill (Wave 3) |
| M4 (Retention) | unknown (no retention telemetry yet) | unchanged |

## Notes

- **No CLOSED transitions in Wave 1.** Ceiling is FIXED_UNPROVEN per DECISION-0008. Doctor Full (P8+) is the only tier authorised to CLOSED.
- **Wave 1 gap-closure eliminated 1 instance of BC-003** (developer shortcut in production request path · desktop_auth.py bypass audit → single canonical service pattern locked · commit c2421921).
- **Ship-lens P2 residuals** are queued as Wave 2 spillover, not new bugs (SideNav Guest fallback).
- **Retrofit scope:** the 6 new required fields per DECISION-0010 are populated for Wave-1 rows only. Non-Wave-1 rows are `audit-owed` and Doctor Lite refuses queries against them without flagging the gap.
