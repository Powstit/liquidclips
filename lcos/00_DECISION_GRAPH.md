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

*Add new decisions below this line, never above.*
