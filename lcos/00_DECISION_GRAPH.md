# 00 · Decision Graph

Append-only ledger of every permanent architectural decision.

Every future agent must reference a decision node before reversing it. Reversing without reference = engineering finding.

## Schema

```
DECISION-XXXX
Title:          <short name>
Date:           <YYYY-MM-DD>
Approved by:    <person>
Reason:         <business or technical rationale>
Supersedes:     <DECISION-YYYY | none>
Superseded by:  <DECISION-ZZZZ | none>
Affects:
  Capability:   <capability.id> [, ...]
  Feature:      <feature.id> [, ...]
  Journey:      <journey.id> [, ...]
Files:          <file:line> [, ...]
Reversible?:    <yes | no>
```

## Ledger

---

### DECISION-0001 · Establish LCOS as the canonical engineering brain
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Chat-memory-driven fixes were producing cascading regressions. LCOS forces every claim to cite. Documentation is not the deliverable — correct diagnosis of the running system is.
- Supersedes: none (net-new)
- Superseded by: none
- Affects:
  - Capability: `capability.operational-excellence`
  - Feature: none (meta)
  - Journey: none (meta)
- Files: `lcos/**`
- Reversible?: no (foundation)

---

### DECISION-0002 · Mission = "Help creators earn recurring income from clipping"
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Locks scope. Excludes general video editing, social networking, payments, marketing.
- Supersedes: none
- Superseded by: none
- Affects:
  - Capability: all
- Files: `lcos/00C_MISSION.md`
- Reversible?: yes (product pivot)

---

### DECISION-0003 · Shell freeze
- Date: 2026-06-25 (locked earlier; re-affirmed 2026-07-12)
- Approved by: Daniel
- Reason: Tauri 2 shell is stable enough to ship RC1. Every fix must be runtime bundle + backend + HQ only. No Rust / Cargo / tauri.conf / sidecar / new npm deps.
- Supersedes: none
- Superseded by: only Daniel can lift this
- Affects:
  - Capability: `capability.operational-excellence`
- Files: `desktop-2/src-tauri/**` `Cargo.toml` `tauri.conf.json` `desktop/python-sidecar/**` `package.json`
- Reversible?: only by Daniel (explicit)

---

### DECISION-0004 · Anthropic never closes a bug
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Prevents fake-certainty closures. Only deterministic proof — passing regression test + live journey + expected telemetry trail + customer UI match + HQ match — flips a bug to CLOSED.
- Supersedes: none
- Superseded by: none
- Affects:
  - Capability: all
- Files: `lcos/09_BUG_LEDGER.md` `lcos/13_DOCTOR/**`
- Reversible?: no

---

### DECISION-0005 · Living Architecture split
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Machine facts regenerate automatically; business intent requires explicit review. Prevents docs lying in six months.
- Human-owned (never regenerated): 00, 00B, 00C, 01, 02, 03, 04
- Machine-owned (regenerated on merge): 07, 08, 10, 11, 14
- Hybrid: 05, 06, 09
- Supersedes: none
- Superseded by: none
- Files: all lcos/**
- Reversible?: yes

---

### DECISION-0006 · The Bug Ledger is one organ · the connected graph is the brain
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Prevents LCOS from being treated as a fancy bug tracker. Every ledger row must link forward and backward through the seven-layer chain: `Mission → Capability → Feature → Journey → Station → Canonical State → Code · Runtime · Backend`. And in reverse: `changed code → affected state → station → journey → feature → capability → customer/business consequence`. No isolated organs.
- Bug rows must cite: mission fingerprint, capability, feature, journey, station, canonical state, code nodes, tests, telemetry, decisions, invariants. Missing links = gap-report entry, not "unlinked bug."
- Ledger states: `OPEN` / `IN_PROGRESS` / `FIXED_UNPROVEN` / `CLOSED`. Only deterministic proof (test + live journey + expected telemetry + customer UI match) flips to CLOSED.
- Wave 1 does NOT dispatch until: (a) `graph/bugs.json` written from approved ledger, (b) dependency-gap report published, (c) shared-root-cause groupings identified, (d) ranked repair plan by golden-paths-unblocked/customer-impact/recurrence-risk, (e) file-ownership matrix approved.
- Supersedes: none
- Superseded by: none
- Affects: all LCOS layers · dispatch process
- Files: `lcos/**`
- Reversible?: yes (with new decision)

---

### DECISION-0007 · Living dependency graph edge set (locked minimum)
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Lock what the scanner MUST extract so LCOS answers can climb both directions of the chain. Anything not in this list is out-of-scope for P5-P8; anything on this list is required.
- Minimum edge types (18):
  1. `component RENDERS component`
  2. `component READS hook`
  3. `hook READS state`
  4. `hook WRITES state`
  5. `hook CALLS endpoint`
  6. `endpoint READS table`
  7. `endpoint WRITES table`
  8. `event INVALIDATES hook_or_state`
  9. `cta CALLS handler`
  10. `handler CALLS endpoint_or_command`
  11. `route MOUNTS component`
  12. `test PROTECTS node_or_edge`
  13. `telemetry PROVES journey_step`
  14. `watchdog GUARDS surface`
  15. `decision CONSTRAINS feature`
  16. `invariant CONSTRAINS state`
  17. `journey USES station`
  18. `station IMPLEMENTS feature` · `feature SUPPORTS capability` · `capability ADVANCES mission`
- Every edge stores: `source_file`, `line`, `extraction_method`, `confidence`, `generated_at`, `source_commit_sha`.
- Supersedes: DECISION-0005 (extended, not replaced)
- Files: `lcos/graph/edges.json` · scanner specs
- Reversible?: yes (add edge types via new decision · never remove without justification)

---

### DECISION-0008 · Doctor Lite (now) · Doctor Full (after scanners)
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Do not wait for P8 to use Doctor. Split into two stages so LCOS delivers value immediately while preserving the highest closure bar for CLOSED.
- **Doctor Lite** — available now. Uses documentation, Decision Graph, ledger, and existing evidence to produce impact analysis, repair plans, cluster identification, wave briefs. **Cannot certify bugs as CLOSED.** Cannot transition status. Read-only reasoning.
- **Doctor Full** — available after P5 scanners land. Adds live code-graph verification, telemetry parity checks, invariant scanning, journey-status derivation. **Only Doctor Full can move a bug from FIXED_UNPROVEN → CLOSED**, and only when every `closes_only_when` assertion is green with cited evidence.
- Neither stage may bypass DECISION-0004 (Anthropic never closes).
- Supersedes: none (extends earlier scope)
- Files: `lcos/13_DOCTOR/**` will split into `doctor-lite.mjs` + `doctor-full.mjs`
- Reversible?: no (foundational to LCOS proof discipline)

---

### DECISION-0009 · Wave lifecycle contract (10 steps · locked)
- Date: 2026-07-12
- Approved by: Daniel
- Reason: Every implementation wave follows the same lifecycle so no dispatch, no branch, and no commit can shortcut proof.
- Steps (must occur in order):
  1. Doctor identifies cluster.
  2. LCOS dependency graph calculates downstream impact.
  3. Wave owner receives the file-ownership matrix.
  4. Implementation.
  5. Regression tests.
  6. Golden-path walkthrough.
  7. Telemetry verification.
  8. Ship-lens.
  9. Bug status moves to **FIXED_UNPROVEN only**.
  10. Doctor Full re-runs after scanners exist before any bug becomes CLOSED.
- **No bug transitions from OPEN directly to CLOSED. Ever.** Status ladder: `OPEN → IN_PROGRESS → FIXED_UNPROVEN → CLOSED`.
- **Reduce duplicate ownership, do not synchronise it.** If a wave uses synchronisation instead of removing a duplicate writer, the wave STOPS and reports.
- Every commit in a wave produces an Impact Report (`lcos/reports/impact/<branch>/<sha>.md`) per the template at `lcos/reports/IMPACT_REPORT_TEMPLATE.md`.
- Every branch includes: regression tests · telemetry expectations · live customer walkthrough steps · rollback proof.
- Only **one** implementation agent may operate inside a cluster until the canonical ownership model for that cluster is proven. Parallel dispatches allowed only across clusters with disjoint file ownership.
- After a wave lands and passes review, LCOS regenerates: dependency graph · impact graph · bug graph · repair priority graph — BEFORE the next wave begins.
- Supersedes: DECISION-0006 (extends dispatch process)
- Files: `lcos/reports/**` · `lcos/13_DOCTOR/**` · every future branch
- Reversible?: no (foundational)

---

*Add new decisions below this line, never above.*
