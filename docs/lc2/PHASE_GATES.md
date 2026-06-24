# Liquid Clips 2.0 — Phase gates

13 phases. Each phase is commit-gateable: automated guard passes + Daniel
signs off on the manual test, then the phase locks (new iron-gate sentinel
added) and the next phase begins.

Source of phase content: `~/Desktop/LIQUID_CLIPS_2_DEPENDENCY_MAP.md` (the
architectural plan). This file is the operational checklist.

| Phase | Title                                    | New iron gate | Status |
| ----- | ---------------------------------------- | ------------- | ------ |
| 0     | Contracts + registries (this shell)      | IG-LC2-001    | DONE — shell delivered as raw scaffold with 13 sections + all feature slots represented. Lock pending Daniel sign-off. |
| 1     | Shell with 11 primary sections visible, no panels; Account/Diagnostics/HQ Bridge inside Settings; two-persona UI simulator (Campaigns + Clipper mode) | (IG-LC2-001)  | DONE — covered by Phase 0 shell |
| 2     | Fake data fixtures for every section     | IG-LC2-002    | DONE — fixtures/* render in every section |
| 3     | CREATE fake → real URL/file              | IG-LC2-003    | pending |
| 4     | EDITOR preview + export (tier gate)      | IG-LC2-004    | pending |
| 5     | PROJECTS create / add / move             | IG-LC2-005    | pending |
| 6     | SCHEDULE + CHANNELS fake connected       | IG-LC2-006    | pending |
| 7     | SocialAuth real return-to-app            | IG-LC2-007    | pending |
| 8     | COMMUNITY isolated route                 | IG-LC2-008    | pending |
| 9     | EARN isolated, no passive auth           | IG-LC2-009    | pending |
| 10    | SETTINGS without passive keychain        | IG-LC2-010    | pending |
| 11    | HQ website bridge / deep-link verbs      | IG-LC2-011    | pending |
| 12    | Cutover commit (rename folders)          | n/a           | pending |

## Per-phase exit criteria

Each phase exits only when ALL three are true:

1. Automated guard passes (`bash scripts/assert-shell-contracts.sh` + any
   phase-specific contract test).
2. Daniel walks the manual test on a running install and signs off in
   writing in this file.
3. New iron-gate sentinel (`IRON GATE IG-LC2-NNN`) is added at the locked
   site, and pre-commit hook refuses to remove it without override.

## Out-of-band rules

- No tagging, no release, no public install until Phase 12.
- No push to `main` for a multi-phase sequence until Daniel green-lights
  the whole sequence (per `[[feedback_no_push_until_confirmed]]`).
- Iron gates IG-001 through IG-014 remain active on `/desktop` until
  cutover.
