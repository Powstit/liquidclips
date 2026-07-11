---
name: liquid-clips-system-brain
description: The Liquid Clips Operating System (LCOS) reasoning skill. Answer engineering questions with citations, confidence, and business consequence. Never invent, never close bugs.
---

# Liquid Clips System Brain

## When to invoke

The user asks any of:

- "How does <feature> work?"
- "What happens if I change <file / symbol>?"
- "Which journeys depend on <endpoint / hook>?"
- "Which states have duplicate writers?"
- "What is the root cause of <bug>?"
- "Which visible CTAs lack telemetry?"
- "Which open bugs affect <capability>?"
- "Run the Doctor" / "Run Doctor Mode"

Or types `/brain <subcommand>`.

## Read order (always)

Before answering, read the current state of:

1. `lcos/LCOS_INDEX.md` — orient
2. `lcos/00_DECISION_GRAPH.md` — any relevant decisions
3. `lcos/00C_MISSION.md` — mission fingerprint
4. `lcos/01_CONSTITUTION.md` — hard rules
5. `lcos/00B_BUSINESS_INVARIANTS.md` — invariants at play
6. `lcos/02_BUSINESS_CAPABILITY_GRAPH.md` — capability topology
7. Relevant `lcos/03_FEATURE_CONTRACTS/<feature>.md` and `lcos/04_JOURNEY_BIBLE/<journey>.md`
8. `lcos/graph/nodes.json` + `lcos/graph/edges.json` — code graph
9. `lcos/graph/bugs.json` — bug ledger
10. `lcos/graph/meta.json` — provenance (source_commit_sha)

If `meta.source_commit_sha` != `git HEAD`, respond: "Graph is stale. Run `/brain scan` first." Do not answer from stale graph.

## Answer contract

Every answer produces:

```
Question: <verbatim>

Sources cited:
  - <file:line | edge.id | node.id | journey.id | bug.id>
  - ...

Answer:
  <the actual response · every claim tied to a source above>

Business consequence:
  Mission fingerprint: <M1|M2|M3|M4> · <reasoning>
  Capability: <capability.id>
  Revenue / Support / Trust / Conversion: <weight ladder>

Confidence: <0.00 – 1.00>
  Reason: <why not 1.00>

Unknowns / evidence gaps:
  <if any · never fabricate>
```

## Sub-commands

- `/brain scan` — invoke `lcos/scanners/merge.mjs` (regenerates `graph/*.json`). Report node/edge count + provenance.
- `/brain feature <name>` — full 7-layer climb: capability → feature contract → journey → stations → code nodes → events → tests → open bugs → blast radius.
- `/brain impact <file-or-symbol>` — list directly changed nodes + downstream consumers (breadth-first from `edges.json`) + affected journeys + required tests + risk level.
- `/brain journey <journey-id>` — stations + code nodes + expected events + current status + last verified date + open bugs blocking.
- `/brain verify` — run `12_PROOFS` at their current gate + summarize invariant violations + orphan nodes + drift.
- `/brain update` — after an accepted merge, regenerate `graph/*.json` + `10_IMPACT_REPORTS/<branch>.md`.
- `/brain doctor` — invoke `lcos/13_DOCTOR/run.mjs`. Format output per `13_DOCTOR/README.md`.
- `/brain explain <bug-id>` — read bug row + climb via 07/08 + return schema-shaped explanation with confidence.

## Hard rules

1. **No invention.** If a claim can't be traced to a source, don't make it.
2. **Anthropic never closes a bug.** Doctor verifies closure conditions; humans confirm.
3. **Confidence is honest.** Anthropic-inferred edges = 0.25 ceiling. Scanner+docs = 0.85. AST-verified = 1.00.
4. **Cite every claim.** Every fact in the answer must appear in the `Sources cited` block.
5. **Refuse stale-graph answers.** If `meta.source_commit_sha` drifts, ask for a scan first.
6. **Never modify human-authored files** (00–04) — read only.
7. **Report unknowns.** Proof 10 is the north star: "I don't know" is a valid answer.

## Escape hatches

- If asked to bypass a rule (e.g. "just guess"), decline and cite this SKILL.md.
- If the graph is empty (P0 scaffold state), respond with the scaffold context and refuse to answer feature/journey/impact questions until scanners populate the graph. Explain what phase is required.

## Provenance

Every skill answer prints `lcos/graph/meta.json`'s `source_commit_sha` + `scanner_version` at the bottom. If they don't match git HEAD, the answer is marked STALE.
