# Doctor Lite · specification

**Status:** available now (P1-continuation deliverable)
**Locked by:** DECISION-0008

Doctor Lite is the read-only reasoning tier of LCOS. It uses **only** documentation, the Decision Graph, the ledger, and existing evidence receipts to produce impact analysis, repair plans, cluster identification, and wave briefs.

Doctor Lite **cannot** move a bug's status. It **cannot** certify anything as CLOSED. That authority is reserved for **Doctor Full** (available after P5 scanners land per DECISION-0008).

---

## What Doctor Lite CAN do

1. **Impact analysis** — given a proposed code change (files touched, hooks modified, endpoints added), walk the 7-layer chain (Mission → Capability → Feature → Journey → Station → Canonical State → Code) and enumerate downstream consumers with confidence bands.
2. **Cluster identification** — group open bugs in the ledger by shared canonical owner + shared root cause. Produce cluster docs like `REPAIR_PLAN_P1.md`.
3. **Wave brief authoring** — produce a file-ownership matrix, tests-owed list, telemetry expectations, and rollback template for a proposed wave.
4. **Draft Impact Report skeletons** — pre-populate sections 1-6 of `IMPACT_REPORT_TEMPLATE.md` for a wave owner to complete during implementation.
5. **Gap analysis** — enumerate missing LCOS assets (feature contracts, journey files, station registry entries) required to answer a query, and report them as gaps.
6. **Predict status transitions** — for a proposed wave, predict which bugs would flip to `IN_PROGRESS` and `FIXED_UNPROVEN` on merge. Never predict `CLOSED`.
7. **Refuse stale answers** — if the graph is not up-to-date, refuse and report which regeneration is required first.

## What Doctor Lite CANNOT do

1. **Transition any bug status.** Even to `IN_PROGRESS`. Status transitions are wave-owner + human sign-off actions, not Doctor actions.
2. **Certify a fix.** No `FIXED_UNPROVEN → CLOSED`. That is Doctor Full only.
3. **Extract new edges from source code.** Scanner work is P5.
4. **Verify telemetry parity live.** Ephemeral stdout ≠ Doctor evidence.
5. **Verify customer UI state.** Live-app inspection is Doctor Full.
6. **Author human-owned documents.** Doctor Lite drafts machine-authored reports only. Constitution, Mission, Invariants, Business Capabilities remain human-authored.
7. **Bypass DECISION-0004.** Anthropic never closes a bug.

## Inputs Doctor Lite reads

Human-authored:
- `lcos/00_DECISION_GRAPH.md`
- `lcos/00B_BUSINESS_INVARIANTS.md`
- `lcos/00C_MISSION.md`
- `lcos/01_CONSTITUTION.md`
- `lcos/02_BUSINESS_CAPABILITY_GRAPH.md`
- `lcos/03_FEATURE_CONTRACTS.md` (P6 output, currently empty)
- `lcos/04_JOURNEYS.md` (P6 output, currently empty)

Ledger + hybrid:
- `lcos/06_CANONICAL_STATE_REGISTRY.md`
- `lcos/09_BUG_LEDGER.md`
- `lcos/graph/bugs.json`

Reports:
- `lcos/reports/GAP_ANALYSIS_P1.md`
- `lcos/reports/REPAIR_PLAN_P1.md`
- `lcos/reports/impact/**` (per-wave Impact Reports)

Constraints:
- Doctor Lite must include a `source_sha`, `read_at`, and `confidence` in every output.
- If any input is stale (older than the current HEAD by more than the last wave commit), Doctor Lite refuses.

## Outputs Doctor Lite writes

- `lcos/reports/impact/<branch>/DRAFT_<sha>.md` — pre-populated Impact Report skeleton (wave owner completes sections 8-14)
- `lcos/reports/cluster/<cluster-id>.md` — cluster identification write-up
- `lcos/reports/wave-brief/<branch>.md` — wave dispatch brief

Doctor Lite **never** writes into:
- `lcos/00*.md`, `lcos/01_CONSTITUTION.md`, `lcos/02_BUSINESS_CAPABILITY_GRAPH.md` (human-owned per DECISION-0005)
- `lcos/09_BUG_LEDGER.md` status fields (owned by wave owner during branch work)
- `lcos/graph/bugs.json` status field (mirror of ledger)

## Invocation contract

Doctor Lite is invoked via one of three slash-commands (to be built):

- `/doctor lite impact <branch-or-cluster>` — impact analysis
- `/doctor lite cluster <bug-id>` — find or propose the cluster this bug belongs to
- `/doctor lite wave <wave-number>` — draft wave brief + Impact Report skeleton

Until slash-commands land, Doctor Lite runs as an Agent Task with the following contract:

```
You are LCOS Doctor Lite.

Input: <query>
Constraints:
  - Read only human-authored + ledger + reports + graph files under lcos/
  - Cite every claim with file:line
  - Report confidence per claim
  - Refuse if source_sha != current HEAD (report which regeneration required)
  - NEVER propose bug status = CLOSED
  - If asked to certify a fix, decline and cite DECISION-0008

Output:
  - Analysis
  - Cited evidence
  - Predicted status transitions (never CLOSED)
  - Named gaps for Doctor Full to verify later
```

## Doctor Lite verdict format

Every Doctor Lite response must open with a verdict header:

```
LCOS DOCTOR (LITE) · <UTC timestamp> · source_sha <HEAD sha> · doc_freshness <ok|stale>
Query: <what was asked>
Verdict: <analysis|refuse|escalate-to-doctor-full>
Confidence: <LOW | MEDIUM | HIGH>
```

Followed by the analysis + gaps + recommended next actions.

## Success test

Doctor Lite passes its own quality bar when it can, given only P0-P1 LCOS assets, correctly:

1. Read the ledger and Decision Graph.
2. Identify cluster 1 (identity ladder · BUG-002 + 003 + 011 + 013) from bugs.json.
3. Produce a wave brief matching `REPAIR_PLAN_P1.md` §File ownership matrix · Wave 1.
4. Refuse to certify BUG-002 as CLOSED even if all closes_only_when tests pass, citing DECISION-0008.

Once Doctor Lite passes this test end-to-end, we promote it from spec to skill and gate the P1-continuation on Daniel's approval.

## Handoff to Doctor Full (later)

Doctor Full inherits Doctor Lite's contract and adds:
- Live code-graph queries via scanners (P5)
- Telemetry parity checks against HQ persistence
- Journey status derivation from station events
- Invariant scanning against runtime state
- Bug status transitions to CLOSED (with cited evidence for every `closes_only_when` clause)

Doctor Lite continues to run in parallel for cheap impact-analysis queries even after Doctor Full ships.
