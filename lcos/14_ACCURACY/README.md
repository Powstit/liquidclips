# 14 · Accuracy Metrics

LCOS is measured. Not assumed. Confidence auto-recalibrates against realized accuracy.

## What is tracked

Written to `journal.jsonl` (append-only) after every proof run + every doctor run:

| Metric | Definition |
|---|---|
| `state_ownership_accuracy` | Of the "canonical owner" claims, what fraction were confirmed by scanner? |
| `impact_prediction_accuracy` | Predicted vs actual blast-radius on real merges (proof 06) |
| `journey_prediction_accuracy` | Predicted vs actual customer-facing effect (proofs 04, 07) |
| `bug_classification_accuracy` | Predicted vs actual root cause on closed bugs (proof 09) |
| `false_positives_rate` | Findings that turned out to be non-bugs |
| `false_negatives_rate` | Bugs we missed that Daniel found later |
| `unknown_response_rate` | Fraction of queries where LCOS said "I don't know" (proof 10 healthy signal) |
| `confidence_calibration` | Predicted confidence vs realized correctness (Brier-score style) |

## Auto-recalibration rule

If `confidence_calibration` shows LCOS overrates itself for a category (e.g. Anthropic-inferred edges), the ceiling drops for that category until re-earned by future correct answers.

Formula: for each category, `next_ceiling = clip(current_ceiling - alpha * (predicted - actual), 0.25, 1.00)` with `alpha=0.1`. Applied nightly (or on doctor run).

## Reporting

The Doctor Mode output includes an `ACCURACY THIS RUN` section pulled from the journal's rolling 7-day window.

## Invariants of the accuracy tracker

- **Append-only.** No entry mutation.
- **Deterministic scoring.** Same run = same score. If it changes, the definition changed and must be Decision-Graph-approved.
- **No self-scoring.** Only external ground truth (Daniel-approved answers in `12_PROOFS/expected/`) counts toward calibration.

## Populating

Empty file at P0. Journal starts filling at P4 when the first proof runs (Proof 01 + 05).
