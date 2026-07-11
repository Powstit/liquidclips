# 10 · Impact Reports

Machine-derived. One report per branch. Blocks merge if impact isn't accepted.

Populated at P7 as part of Living Architecture.

## Trigger

Automatic on any branch that touches `desktop-2/src/**` or `junior-backend/app/**`. Ship-lens hook writes:

`lcos/reports/impact/<branch>.md`

## Content

```
# Impact Report · <branch> · <commit SHA>

## Directly changed nodes
- [node.id → file:line]

## Downstream consumers (from 07 code graph)
- [node.id → depth 1]
- [node.id → depth 2]
- [node.id → depth 3]

## Affected features
- [feature.id → capability]

## Affected journeys
- [journey.id → status impact]

## Affected canonical sources of truth
- [state.id → owner check]

## Required test suites
- [test file, ...]

## Expected HQ events
- [lcDiag topic → expected count delta]

## Risk level
<LOW | MEDIUM | HIGH | CRITICAL>

## Shell/native impact
<none | yes — REJECTED>

## Confidence
<0.00 – 1.00>

## Approval
- Reviewer: <name>
- Verdict: <accept | request changes>
- Rationale: <text>
```

## Rules

- **No merge without an impact report.**
- **Shell/native impact = automatic reject** (DECISION-0003).
- **Confidence < 0.85 requires human sign-off on downstream consumers list.**
