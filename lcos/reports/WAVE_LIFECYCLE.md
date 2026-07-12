# Wave Lifecycle · locked by DECISION-0009

Every implementation wave follows this contract. No exceptions.

## The ten steps

```
┌────────────────────────────────────────────────────┐
│ 1. Doctor identifies cluster                       │
│    Doctor Lite reads ledger + capability graph     │
│    Names cluster + members + business consequence  │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 2. LCOS dependency graph calculates impact         │
│    Downstream consumers per file/hook/state        │
│    Confidence bands per edge                       │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 3. Wave owner receives file-ownership matrix       │
│    Files touched · reviewer gates · tests owed     │
│    Telemetry topics introduced or changed          │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 4. Implementation                                  │
│    Single agent per cluster until owner proven     │
│    Reduce duplicate ownership · never synchronise  │
│    If synchronisation required · STOP and report   │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 5. Regression tests                                │
│    Named in closes_only_when · all must be green   │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 6. Golden-path walkthrough                         │
│    Live walk on promoted bundle · transcript in    │
│    Impact Report section 12                        │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 7. Telemetry verification                          │
│    Every expected event fires · every removed      │
│    event has backfill test                         │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 8. Ship-lens                                       │
│    P0/P1 findings resolved · Impact Report signed  │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 9. Bug status moves to FIXED_UNPROVEN              │
│    NOT CLOSED · human confirms transition          │
└────────────────────┬───────────────────────────────┘
                     ▼
┌────────────────────────────────────────────────────┐
│ 10. Doctor Full re-runs after scanners exist       │
│     ONLY Doctor Full can flip FIXED_UNPROVEN →     │
│     CLOSED. Every closes_only_when assertion       │
│     verified with cited evidence.                  │
└────────────────────────────────────────────────────┘
```

## Status ladder (locked)

```
     OPEN  →  IN_PROGRESS  →  FIXED_UNPROVEN  →  CLOSED
     Daniel   Wave owner      Wave owner        Doctor Full
     opens    picks up        after merge       (P8+)
              cluster         + tests           + all assertions
                              + walk            + telemetry
                              + ship-lens       + customer UI
```

**No shortcut path exists.** OPEN cannot go directly to CLOSED.

## Parallelisation rules

- **One implementation agent per cluster** until the canonical ownership model for that cluster is proven.
- **Multiple clusters may run in parallel** IF file ownership is disjoint (verified by scanner or human).
- **Post-Wave regeneration is a barrier**: after any wave lands, LCOS regenerates dependency graph · impact graph · bug graph · repair priority graph BEFORE the next wave begins.

## When to STOP and report

Per DECISION-0009, the wave STOPS and reports if any of:

- Synchronisation is proposed instead of removing a duplicate writer.
- A required regression test cannot be written because the assertion contradicts the canonical ownership model.
- Doctor Lite predicts an impact the wave owner did not anticipate.
- A change requires shell / Rust / Cargo / Tauri / sidecar / package.json outside a Daniel-signed exemption.
- The Impact Report cannot cite the canonical owner change (section 2) because the ownership model is unclear.
- A test transitions a bug directly OPEN → CLOSED.

Reporting = write a note in `lcos/reports/impact/<branch>/STOP_REPORT.md` + notify Daniel. No further commits until resolution.
