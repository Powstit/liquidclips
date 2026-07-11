# Liquid Clips Operating System · LCOS

**First read for every Claude session, every implementation agent, every ship-lens run.**

LCOS is a self-verifying engineering brain for Liquid Clips. It maps business intent down to code and back, so any engineering question can be answered with citations, confidence, and business consequence — never invention.

Documentation is not the deliverable. **Correct diagnosis of the running system is the deliverable.**

## Reading order

| # | File | Layer | Written by |
|---|---|---|---|
| **00** | [Decision Graph](./00_DECISION_GRAPH.md) | append-only ledger of architectural decisions | Daniel |
| **00B** | [Business Invariants](./00B_BUSINESS_INVARIANTS.md) | machine-verifiable rules | Daniel |
| **00C** | [Mission](./00C_MISSION.md) | the customer promise | Daniel |
| **01** | [Constitution](./01_CONSTITUTION.md) | non-negotiable engineering rules | Daniel |
| **02** | [Business Capability Graph](./02_BUSINESS_CAPABILITY_GRAPH.md) | mission → capabilities | Daniel |
| **03** | [Feature Contracts](./03_FEATURE_CONTRACTS/) | one per feature | Daniel |
| **04** | [Journey Bible](./04_JOURNEY_BIBLE/) | one per customer journey | Daniel |
| **05** | [Station Registry](./05_STATION_REGISTRY.md) | UX steps ↔ code | Daniel + scanner |
| **06** | [Canonical State Registry](./06_CANONICAL_STATE_REGISTRY.md) | one owner per shared state | Daniel + scanner |
| **07** | [Code Graph](./07_CODE_GRAPH/) | nodes + edges from AST | Scanner |
| **08** | [Runtime Graph](./08_RUNTIME_GRAPH/) | live telemetry evidence | Scanner + HQ |
| **09** | [Bug Ledger](./09_BUG_LEDGER.md) | every open + closed bug | Both |
| **10** | [Impact Reports](./10_IMPACT_REPORTS/) | per-branch blast radius | Scanner |
| **11** | [Anthropic Brain](./11_ANTHROPIC_BRAIN/) | reasoning skill | Skill |
| **12** | [Proof Suite](./12_PROOFS/) | 10 executable proofs LCOS must pass | Both |
| **13** | [Doctor Mode](./13_DOCTOR/) | composite diagnosis runner | Scanner |
| **14** | [Accuracy Metrics](./14_ACCURACY/) | self-calibration ledger | Runtime |

## The hierarchy (7 layers)

```
Mission                     ← WHY we exist
    ↓ owns
Business Capability         ← segments of value
    ↓ owns
Feature                     ← what we deliver
    ↓ owns
Journey                     ← how the customer travels
    ↓ owns
Station                     ← where each step happens
    ↓ implements
Code · Runtime · Backend    ← implementation
    ↓ measured by
Proof                       ← evidence the layer above works
```

## Golden philosophy

> **Anthropic never closes a bug. Only proof closes a bug.**
>
> The Business Capability Graph decides which bug matters.
> The Code Graph shows where it lives.
> The Runtime Graph shows if it's happening now.
> The Journey Bible defines what the customer was promised.
> Anthropic reasons across all four.
> Proof — passing test + live journey + HQ event trail + customer UI match — is the only closer.

## Living Architecture

| Layer | Regenerated? |
|---|---|
| 00, 00B, 00C, 01, 02, 03, 04 | Never · human-owned |
| 05, 06 | Structure human, bindings regen |
| 07, 08, 10 | Every merge |
| 09 | Machine appends, human closes |
| 11 | Every query |
| 12, 13, 14 | Every run |

Ship-lens refuses to merge if the graph is stale relative to source. Docs stop lying because they can't.

## Definition of Complete (P10)

LCOS is complete when this loop passes end-to-end:

1. Inject `BUG-002` (authenticated Guest avatar) into a branch
2. `Doctor` identifies: invariant + capability + journey + stations + business consequence + owner + required proof
3. Fix branch lands
4. `Doctor` verifies: regression test passes + live journey passes + telemetry arrives + customer UI matches + HQ matches
5. Only then does `bugs.json` flip to CLOSED

## Guardrails

- No product-code touches during LCOS build.
- No shell / Rust / Cargo / Tauri / sidecar / new npm deps.
- Human-approved sections (00–04) never regenerate automatically.
- Machine-derived sections (07, 08, 10) never hand-edited.
- Every claim carries confidence. Confidence auto-recalibrates.

## Provenance

Every generated file records the source commit SHA it was built from. See [`graph/meta.json`](./graph/meta.json).
