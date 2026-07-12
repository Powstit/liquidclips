# 00B · Business Invariants

Machine-verifiable rules. Scanners flag every violation. **A violation is an engineering finding, not an opinion.**

Each invariant has a `verifier` (which scanner proves it) and a `severity` (how bad a violation is). Scanners must return `pass`, `fail with citation`, or `unknown with reason`.

## Schema

```
INV-XXX
Title:          <short name>
Statement:      <one sentence · testable>
Verifier:       <scanner or proof id>
Severity:       <P0 | P1 | P2>
Mission link:   <M1|M2|M3|M4> [, ...]
Rationale:      <why we hold this line>
```

## The five (P0 seed)

---

### INV-001 · Exactly one authenticated-user state exists per session
- **Statement:** At any moment, `hasJwt` has exactly one canonical source (`hook.useAuth`). No component may `useState(!!getJwt())` independently.
- **Verifier:** Proof 05 (state drift) + AST grep for `useState(<!>getJwt())` outside `useAuth.ts`
- **Severity:** P0
- **Mission link:** M3 (Trust)
- **Rationale:** A signed-in user showing "Guest" is a credibility hit. This drift caused BUG-002.

---

### INV-002 · Exactly one canonical wallet state exists
- **Statement:** Every surface that renders a money number reads from `hook.useWalletLedger` (via `hook.useEarnSummary` where scoped). No hardcoded balances.
- **Verifier:** Proof 03 (fake statistics) + AST grep for money literals ($XX.XX) in JSX
- **Severity:** P0
- **Mission link:** M2 (Revenue), M3 (Trust)
- **Rationale:** Fake money numbers destroy trust and lie to the founder about MRR.

---

### INV-003 · Every money CTA must produce telemetry
- **Statement:** Every button that touches money (`connectWhop`, `Withdraw`, `Submit to Whop`, `Copy referral link`, `Payout claim`) must emit an `lcDiag` event before or after user action.
- **Verifier:** Proof 07 (regression detection) + AST match on CTA onClick handlers
- **Severity:** P1
- **Mission link:** M2 (Revenue), M3 (Trust)
- **Rationale:** If we can't see the money click, we can't diagnose the money bug.

---

### INV-004 · Customer cannot withdraw before eligibility
- **Statement:** The `Withdraw` CTA is disabled or hidden unless `wallet.balance_cents > 0 AND wallet.affiliate_agreement_signed AND wallet.whop_connected`.
- **Verifier:** Proof 02 (dead buttons) + AST rule on `WithdrawButton` disabled predicate
- **Severity:** P0
- **Mission link:** M2 (Revenue), M3 (Trust)
- **Rationale:** Premature payout attempts create refund cycles and Whop bans.

---

### INV-005 · Every customer-visible statistic originates from a canonical backend source
- **Statement:** Any number rendered to the customer must trace back to a backend endpoint call. No client-computed derivations that aren't reconciled with `/me/*`.
- **Verifier:** Proof 03 (fake statistics) + node.origin trace to endpoint
- **Severity:** P1
- **Mission link:** M3 (Trust)
- **Rationale:** Client-computed statistics drift silently across surfaces.

---

## Adding a new invariant

1. Write it as a testable sentence.
2. Name the verifier (or add one to `12_PROOFS/`).
3. Attach a Decision Graph entry justifying it.
4. Register in `graph/invariants.json` on next scanner run.

*Add new invariants below this line, never above.*

---

### INV-006 · Every canonical state names exactly one writer
- **Statement:** For every entry in `06_CANONICAL_STATE_REGISTRY.md`, exactly one code node has write authority. Duplicate writers are engineering findings; synchronisation between two writers is banned (DECISION-0009).
- **Verifier:** P5 scanner walks all `hook.*` + `service.*` + `endpoint.*` nodes; matches each canonical state to writer count; asserts count == 1.
- **Severity:** P0
- **Mission link:** M3 (Trust)
- **Rationale:** Divergence between writers is what let BUG-002 (Guest·Admin drift) and the state-drift trifecta ship.
- **Class link:** BC-001 (multi-writer state)

---

### INV-007 · Canonical state enters a component tree through one selector; ownership never transfers
- **Statement:** Canonical state may only enter a component tree through a canonical selector (hook or context). Once inside a subtree, derived presentation props are allowed, but ownership must never transfer.
- **Verifier:** P5 AST rule walks each component's props against the Canonical State Registry; flags any prop that carries a registered canonical axis. Presentation props derived downstream from a selector-read remain allowed.
- **Severity:** P0
- **Mission link:** M3 (Trust)
- **Rationale:** Owning canonical state via prop creates two sources of truth; deriving presentation values from an already-selector-owned canonical value preserves the single-owner invariant while letting presentational components stay flexible.
- **Class link:** BC-002 (multi-source-of-truth), BC-005 (UI reading divergent stores)

---

### INV-008 · Production request handlers contain no alternate authentication, authorization, payment, identity, or security behaviour
- **Statement:** Production request handlers shall not contain alternate authentication, authorization, payment, identity, or security behaviour. Development tooling must execute outside the production request path.
- **Verifier:** P5 AST scanner walks `junior-backend/app/routes/**` and flags any branch that deviates the auth / authz / payment / identity / security path based on environment, feature flag, request header, caller identity, or any other runtime signal. Dev-only helpers permitted only under `junior-backend/scripts/dev/**` or `junior-backend/tests/**`.
- **Severity:** P0
- **Mission link:** M3 (Trust)
- **Rationale:** Framed as behaviour not env-var so no future implementation shape (header switch, feature-flag service, magic caller) can slip through the same gap. First named by the 2026-07-12 `desktop_auth.py` audit.
- **Class link:** BC-003 (developer shortcut in production request path)

---

### INV-009 · Every customer-facing surface belongs to a journey with a written station chain
- **Statement:** Every route in `desktop-2/src/routes/**` and every top-level surface in `desktop-2/src/design-os/**` maps to at least one `journey.jNNN-*` entry in `04_JOURNEYS.md`, with a defined station chain, entry condition, exit condition, and expected telemetry per station.
- **Verifier:** P5 route-to-journey scanner walks the route registry + `04_JOURNEYS.md`; asserts coverage.
- **Severity:** P1
- **Mission link:** M1 (Reach), M2 (Revenue), M4 (Retention)
- **Rationale:** A journey without shape can't have gravity — bugs against it can't be triaged, closed, or prevented.
- **Class link:** BC-004 (business journey with no canonical owner)

---

### INV-010 · A canonical state axis is observed via exactly one selector within a component
- **Statement:** A canonical state axis may have multiple implementations, but a component may observe that axis through exactly one canonical selector.
- **Verifier:** P5 AST scanner walks each component's `use*` hook calls; flags any component that reads the same registered axis via two selectors in the same render.
- **Severity:** P1
- **Mission link:** M3 (Trust)
- **Rationale:** Multiple implementations of an axis are permitted (refactor headroom); multiple in-component observations of the axis are not (drift risk). Different hydration timings between overlapping observations produced `Guest·Admin`.
- **Class link:** BC-005 (UI reading divergent stores)

---

### INV-011 · Every canonical state transition produces observable proof
- **Statement:** A state transition is complete only when it has all four:
  1. a telemetry event fired with the transition payload,
  2. regression test coverage naming the transition,
  3. a journey step that describes the transition,
  4. an owning station in `05_STATIONS.md` (or equivalent registry).
  Transitions without all four are not considered observable and cannot be counted toward journey health or bug closure.
- **Verifier:** P5 scanner joins telemetry topic registry × canonical state writer set × journey stations × test-protection graph; asserts every write to a canonical state axis has all four proofs.
- **Severity:** P0
- **Mission link:** M3 (Trust) · underpins every other invariant's provability
- **Rationale:** Extends DECISION-0004 (only proof closes) from bug closure to state transitions. If a transition can't be seen, the system can't be trusted to have executed it, and bugs against it can't be diagnosed. This is the invariant that lets Doctor Full ever certify anything.
- **Class link:** none (foundational · applies to every class)
