# 13 · Doctor Mode

Composite runner. On-demand system-wide diagnosis. Never proposes fixes without evidence. Never closes bugs.

## Invocation

- Skill: `/brain doctor`
- CLI: `node lcos/13_DOCTOR/run.mjs [--json | --md] [--fail-on <P0|P1|invariant>]`
- Ship-lens hook: runs on every merge candidate; blocks if `--fail-on P0` fires.

## What it runs

1. `runtime_scan` — pull last N minutes of telemetry from HQ (`08_RUNTIME_GRAPH`)
2. `code_graph_scan` — verify `07_CODE_GRAPH` is fresh vs `HEAD` (block if stale)
3. `bug_graph_scan` — read `09_BUG_LEDGER.md` + `graph/bugs.json`
4. `journey_scan` — walk `04_JOURNEY_BIBLE` · rate each GREEN / AMBER / RED
5. `capability_scan` — roll journey ratings up to capabilities in `02`
6. `telemetry_scan` — compare expected event ordering vs actual
7. `decision_scan` — flag any code change reversing a `00_DECISION_GRAPH` node without reference
8. `invariant_scan` — run every verifier in `00B_BUSINESS_INVARIANTS`

## Output format (locked)

```
LCOS DOCTOR · <utc>  · source_sha <sha>  · scanner_v <ver>

MISSION HEALTH
  Fingerprint M1 (Reach):     <GREEN|AMBER|RED>
  Fingerprint M2 (Revenue):   <GREEN|AMBER|RED>
  Fingerprint M3 (Trust):     <GREEN|AMBER|RED>
  Fingerprint M4 (Retention): <GREEN|AMBER|RED>

CAPABILITY HEALTH
  identity-trust:          <status>  · owned journeys <n>  · open bugs <n>
  creator-onboarding:      <status>
  content-production:      <status>
  campaign-distribution:   <status>
  affiliate-revenue:       <status>
  community-retention:     <status>
  operational-excellence:  <status>

BROKEN INVARIANTS
  <INV-id>  violated at <file:line>  · confidence <n>  · rationale <text>

ROOT CAUSES (ranked by business consequence)
  1. <finding.id>  affects <capability>  · blocks <n> other findings  · confidence <n>
  2. ...

AFFECTED JOURNEYS (per finding above)
  <j-id>  · station <s-id>  · last-successful <event>  · missing <event>

BUSINESS CONSEQUENCE (per finding)
  Revenue: <weight>  Support: <weight>  Trust: <weight>  Conversion: <weight>

SUGGESTED FIX ORDER
  1. <finding.id>  · rationale <text>  · required proof <proof.id>
  2. ...

ACCURACY THIS RUN
  Predictions made: <n>
  Predictions confirmed: <n>  · calibration <ok|drift>

UNKNOWNS
  <question>  · required evidence: <list>

CLOSURE VERIFICATION (bugs marked AWAITING_PROOF)
  <BUG-id>  test <name> <PASS|FAIL>  · journey <name> <PASS|FAIL>  · telemetry <event> <SEEN|MISSING>  · ui <check> <PASS|FAIL>  · overall <FLIP TO CLOSED | STAY AWAITING>
```

## The rules

- **Doctor never proposes fixes without evidence.** If it can't cite, it says "unknown."
- **Doctor never closes a bug.** It verifies closure conditions and reports; humans confirm.
- **Doctor is deterministic** for a given source SHA + telemetry window.

## Populating

Empty stub at P0. Full runner lands at P8 after code graph (P5) + journey bindings (P6) are complete.
