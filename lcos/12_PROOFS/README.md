# 12 · Proof Suite

**Documentation is not the deliverable. Correct diagnosis of the running system is the deliverable.**

Ten executable proofs. LCOS is not trusted until all ten pass on the current codebase against Daniel-approved expected answers.

Each proof lives in this folder as an `.mjs` script + an `expected/` file with the correct answer. Runner: `node lcos/12_PROOFS/run.mjs [proof-id]`.

## The ten

| # | Proof | Pass criterion (what "correct" means) |
|---|---|---|
| 01 | `proof-01-duplicate-writers.mjs` | Finds `lc.mode` vs `lc:user-mode:v1` (historical) + any current duplicate writer. Zero false-positives on canonical-owner rows. |
| 02 | `proof-02-dead-buttons.mjs` | Every CTA with handler + status. Finds ≥3 known dead affordances. |
| 03 | `proof-03-fake-statistics.mjs` | Every displayed number + origin. Detects fixture literals ($742.50 etc). |
| 04 | `proof-04-golden-path-interruption.mjs` | Given one removed dependency, names broken journey + capability + revenue impact within confidence band. |
| 05 | `proof-05-state-drift.mjs` | Auto-scans multi-writer states. Finds current + past drift. |
| 06 | `proof-06-impact-prediction.mjs` | Predicts blast radius of a `useMe` change. Match validated against actual live measurement. |
| 07 | `proof-07-regression-detection.mjs` | Given a deleted telemetry event, identifies which journey went blind + Money Funnel impact. |
| 08 | `proof-08-feature-understanding.mjs` | Answers "How does Connect Whop work?" with full 7-layer climb + citations. |
| 09 | `proof-09-bug-explanation.mjs` | Explains BUG-002 (Guest avatar) end-to-end with confidence. |
| 10 | `proof-10-unknown-question.mjs` | Given a question LCOS cannot prove, returns "I don't know · confidence below threshold · required evidence: X." Never invents. |

## Rules for every proof

1. **Cite everything.** Every claim = file:line or graph edge id.
2. **Report confidence.** Never claim 1.00 unless AST-verified.
3. **Fail loudly.** If required evidence missing, say so + list what's missing.
4. **Deterministic output.** Same input + same commit SHA = same answer.
5. **Runs cheap.** Each proof under 5 seconds on a warm scanner cache.

## The critical proof

**Proof 10** is the discipline test. LCOS must willingly say "I don't know." That's what stops the fake-certainty bugs that have been shipping.

If Proof 10 ever returns a fabricated answer, LCOS is rejected and the phase reruns.

## Populating

Empty stubs land in P0 (this phase). Real scripts land phase-by-phase as their underlying layer (07, 08, 10, etc.) becomes available. Each phase gates on its assigned proof passing.
