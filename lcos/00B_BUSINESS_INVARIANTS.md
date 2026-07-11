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
