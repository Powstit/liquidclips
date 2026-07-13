# 12 · Bug Class Registry

Locked by DECISION-0011.

The goal of LCOS is not to fix bugs. It is to eliminate the architectural conditions that let a class of bug exist in the first place. This registry names those classes, records their canonical fix pattern, and tracks which classes are still open.

New classes are added via a new DECISION-XXXX entry, never freehand.

---

## Class schema

```
BC-XXX · <short name>
Definition:                <what makes a bug an instance of this class>
Seed instances:            <bug IDs currently manifesting the class>
Canonical fix pattern:     <the architectural change that closes the class>
Prevention rule:           <what future waves must enforce so the class cannot return>
Invariant citation:        <INV-XXX from lcos/00B_BUSINESS_INVARIANTS.md>
Applies to layers:         <backend | frontend | shell | telemetry | data · list>
Class status:              <open | class-elimination-in-progress | closed-application-wide>
Elimination progress:      <fraction · e.g. "4 of 6 instances eliminated">
```

---

## Seed classes

### BC-001 · Multi-writer state

- **Definition:** more than one code location has write authority over the same canonical state.
- **Seed instances:** state-drift trifecta (`useAuth` · `useMe` · mode store); duplicate handle writer (`POST /me/handle` alongside `POST /me/lc-id/claim`, resolved in Wave 1 gap-closure).
- **Canonical fix pattern:** extract a single canonical writer function / service. Every entry point delegates to it. Deprecate and retire duplicates, do not synchronise them (DECISION-0009).
- **Prevention rule:** every canonical state in `06_CANONICAL_STATE_REGISTRY.md` names exactly one owner + one writer set. Doctor Lite refuses to declare a state PROVEN if the writer count is greater than one.
- **Invariant citation:** INV-001 (authenticated-user single-source) + INV-006 (locked 2026-07-12 · every canonical state names exactly one writer)
- **Applies to layers:** backend · frontend · data
- **Class status:** class-elimination-in-progress
- **Elimination progress:** 2 of unknown application-wide instances eliminated · full audit owed in P5

---

### BC-002 · Multi-source-of-truth

- **Definition:** the same conceptual value can be read from two or more places, and consumers disagree about which one is authoritative.
- **Seed instances:** `TopHud` reading `handleFromEmail(me.snapshot?.email)` while `useTierCaps` read tier from a different projection; SideNav rendering identity from a prop while TopHud read from a hook; `__APP_VERSION__` rendered in three places while `runtime_info` was the intended source (BUG-006 · BUG-007).
- **Canonical fix pattern:** one canonical hook per canonical state (or one server-side projection). Every consumer reads from it. Props for canonical values are deleted; components subscribe.
- **Prevention rule:** UI components must not receive canonical state through props. Reviewers reject any prop named for a canonical state axis (`userTier` · `userName` · `handle` · `walletBalance` · `mode`).
- **Invariant citation:** INV-002 (canonical wallet single-source) + INV-007 (locked 2026-07-12 · canonical state enters a component tree through one selector; ownership never transfers)
- **Applies to layers:** frontend
- **Class status:** class-elimination-in-progress
- **Elimination progress:** state-drift trifecta closed · identity ladder closed · version drift open (BUG-006 · BUG-007)

---

### BC-003 · Developer shortcut in production request path

- **Definition:** convenience code intended for local development is placed inside a production request handler, gated by an environment check that fails open (or a broad default that silently disables the safety in misconfigured deploys).
- **Seed instances:** `desktop_auth.py` uncommitted 2026-07-12 · plaintext OTP echo, accept-any-6-digit bypass, swallowed consume — all gated on `env != "production"` with `env` defaulting to `"development"` in config.
- **Canonical fix pattern:**
  1. Dev-only behaviour lives in an isolated harness (`junior-backend/scripts/dev/` or `tests/dev_harness/`), never in the request handler.
  2. Explicit dedicated env var (e.g. `LC_DEV_AUTH_BYPASS=1`), not `env != "production"`.
  3. Production refuses to boot with the bypass enabled (fail-closed startup check in `main.py` lifespan).
  4. Default is disabled; the env var must be present AND truthy AND the environment must not be production.
  5. Regression tests prove: production start with bypass enabled → refuse to boot; production start without env var → normal path; dev with env var → bypass path.
- **Prevention rule:** provenance gate flags any diff that touches a production route AND references an environment-level flag. Reviewer must confirm the change lives outside the request path, or halt.
- **Invariant citation:** INV-008 (locked 2026-07-12 · production request handlers contain no alternate auth / authz / payment / identity / security behaviour; dev tooling executes outside the request path)
- **Applies to layers:** backend · shell
- **Class status:** open (first named this session · fix pattern locked, application-wide audit owed)
- **Elimination progress:** 0 of unknown instances eliminated · P4 audit deliverable

---

### BC-004 · Business journey with no canonical owner

- **Definition:** a customer journey exists in the product but has no station chain in LCOS, no owner capability, no acceptance criteria, and no telemetry backing. Bugs against the journey have no gravity because the journey itself has no shape.
- **Seed instances:** every one of the 15 journeys in `lcos/04_JOURNEYS.md` (currently unwritten). Most acute for the Whop-connect flow (BUG-004 · BUG-014) and the identity onboarding claim ceremony (BUG-003).
- **Canonical fix pattern:** every journey gets a file at `lcos/04_JOURNEYS.md::journey.jNNN-<slug>` listing: owning capability, station chain, entry conditions, exit conditions, expected telemetry per station, acceptance test IDs.
- **Prevention rule:** no wave may add a bug to the ledger against a journey that does not exist in `04_JOURNEYS.md`. Doctor Lite refuses the query with a `gap: journey-not-authored` report.
- **Invariant citation:** INV-009 (locked 2026-07-12 · every customer-facing surface belongs to a journey with a written station chain)
- **Applies to layers:** frontend · backend · telemetry
- **Class status:** open (P6 dependency)
- **Elimination progress:** 0 of 15 journeys authored

---

### BC-005 · UI reading divergent stores

- **Definition:** a single UI surface reads the same conceptual value from two different stores, and the two stores hydrate on different timelines, producing a visible drift window.
- **Seed instances:** `TopHud` reading `useMe` + `useTierCaps` at different hydration timings created `Guest·Admin` (BUG-002); `SideNav` reading identity from a prop while TopHud read from a hook.
- **Canonical fix pattern:** one hook per canonical state. Every consumer subscribes to it. Where two hooks read the same axis, one is deprecated + removed. Priority ladders live inside the hook, never in the consumer.
- **Prevention rule:** ship-lens rejects any component that reads two hooks whose readouts must agree. Ladder logic lives in the hook or a shared selector.
- **Invariant citation:** INV-010 (locked 2026-07-12 · a canonical state axis is observed via exactly one selector within a component)
- **Applies to layers:** frontend
- **Class status:** class-elimination-in-progress
- **Elimination progress:** identity ladder closed via Wave 1 · full application audit owed in P5

---

### BC-006 · Shared-worktree state bleed under parallel `isolation:worktree` agents (LCOS tooling · not customer-facing)

- **Definition:** Multiple `isolation:worktree` agents share the same physical repo (`.git` object database). Parallel branch checkouts in the shared main working tree at `/Users/dipdip/code/jnr` oscillate between the agent branches during parallel dispatch. Integration lead's `git status` and `git branch --show-current` in the main repo return whichever agent last touched the shared checkout. Working tree may contain uncommitted files from agent operations (`pnpm install` side-effects, auto-branch switches).
- **Seed instances:** Train A2 (2026-07-12 · main repo left on `wave-a2/whop-tier`) · Train A3 (main worktree drift during commit) · Train B1 (main repo path did not contain B1 changes) · Train B2 (branch oscillated between wave-b2 and wave-b3) · Train B3 (parallel process on wave-b2 briefly bled). All five agents flagged the pattern; none produced a customer bug because agents worked in their own isolated worktrees and integration lead reset the main checkout at each barrier.
- **Canonical fix pattern:**
  1. Pre-dispatch guard script (`lcos/scripts/dispatch-guard.sh`) that verifies main repo is on the integration branch AND working tree is clean · refuses dispatch otherwise.
  2. Post-completion reset routine · integration lead runs `git checkout integration/<branch>` and `git checkout -- <any-modified-tracked-files>` before merging.
  3. Long-term: escalate to Claude Code runtime team · request that `isolation:worktree` agents not affect the parent repo's checkout state.
- **Prevention rule:** every future parallel dispatch call MUST be preceded by `lcos/scripts/dispatch-guard.sh` returning 0. Integration lead never dispatches without the guard.
- **Invariant citation:** none (tooling scope · no INV covers Claude Code runtime behaviour)
- **Applies to layers:** LCOS tooling · Claude Code runtime · not product code
- **Class status:** class-elimination-in-progress
- **Elimination progress:** dispatch-guard.sh authored 2026-07-12 (this session) · long-term runtime fix owed

---

## Adding a new class

1. Open a new DECISION-XXXX in `lcos/00_DECISION_GRAPH.md` with class name, definition, seed instances (with bug IDs), fix pattern, prevention rule, invariant citation.
2. Append the class entry to this file in the section above.
3. If the class references a new invariant, propose it in `lcos/00B_BUSINESS_INVARIANTS.md`.
4. Doctor Lite must be able to answer: "which known class does this bug belong to?" for every open ledger row. Unknowns count as a Gap.

## Elimination progress rollup

| Class | Instances known | Instances eliminated | Class status |
|---|---|---|---|
| BC-001 | 2 (visible) · full count owed P5 | 2 | in-progress |
| BC-002 | 3 (visible) · full count owed P5 | 2 | in-progress |
| BC-003 | 1 (visible today) · full count owed P4 | 0 | open |
| BC-004 | 15 (all journeys) | 0 | open |
| BC-005 | 2 (visible) · full count owed P5 | 1 | in-progress |

Application-wide class elimination is the north star. FIXED_UNPROVEN on individual bugs is a stepping stone, not the destination.
