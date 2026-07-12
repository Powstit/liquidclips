# 01 · Constitution

**Non-negotiable rules.** Every agent, ship-lens run, and merge gate enforces these. Violations are automatic P0 findings.

Extracted from Daniel's locked memory (2026-05 through 2026-07-12).

## Truth over appearance

- **No fake success.** A step is complete only when its exact artifact exists in the exact environment.
- **No customer-visible fixture data.** Zero hardcoded balances, streaks, clipper counts, campaigns.
- **Hide unfinished features.** If backend isn't wired, remove the nav / CTA / count. Never tease.
- **No raw errors to users.** Every failure has a customer-safe state authored by `describeError` or an equivalent primitive.

## One source of truth per shared state

- **One canonical hook per state axis.** `useAuth` · `useMe` · `useTierCaps` · `useMode`.
- **One persistence key per state.** No shadow zustand copies.
- **One writer per canonical state.** Everyone else reads.
- Registry lives at [`06 Canonical State Registry`](./06_CANONICAL_STATE_REGISTRY.md).

## Every CTA has an outcome

- **Visible affordances must fire real actions.** No `preventDefault()` + `toast("coming soon")` dressed as buttons.
- **Disabled CTAs must have a reason string.** No mysterious grey buttons.
- **Every money CTA emits telemetry** (INV-003).

## Every state is recoverable

- **401 → auto-signout + route preservation** (Block 1 L1).
- **Backend unreachable → customer-safe error + retry** (Block 2 IngestErrorStrip).
- **Bundle stale → runtime beacon reload** (UpdateBeacon).
- **File unreadable → preflight rejection + Reveal in Finder** (Block 2 uploadPreflight).

## Runtime + cloud first

- **Tauri shell is FROZEN** (DECISION-0003).
- **No Rust, Cargo, `tauri.conf`, sidecar, or `package.json` touches** without an explicit Daniel-signed decision graph entry.
- Every fix must be **runtime bundle + Railway backend + HQ** only.

## Ship-lens is the hard gate

- **Ship-lens runs before every commit / build / deploy / done-claim.** No carve-outs.
- **P0 = blocks ship.** P1 = fix same-turn. P2 = defer with rationale.
- **Zero-tolerance for fake-success in prod bundles.** Grep-blocked at gate time.

## Ledger discipline

- **No bug exists only in conversation.** Every bug goes to `09_BUG_LEDGER.md`.
- **No bug closes without proof.** DECISION-0004 · Anthropic never closes.
- **Every fix carries a regression test.** If the test doesn't name the exact node it protects, the test is malformed.

## Voice + copy

- **Target audience: 19-year-old clipper.** Direct, money-aware, no corporate fluff.
- **Banned words:** "bounty". Use "skill" / "clip job" / "paid post".
- **Sentence case for humans.** UPPERCASE ONLY for eyebrows / status codes / system labels.
- **Past tense for done, plain verb for in-progress.** No exclamation marks. No emoji.

## Assets

- **Brand assets from `/public/brand/`.** No external CDN. No CSS-mesh gradients where a brand file exists.
- **All video content generated via approved pipelines** (gpt-image-1 for images, Higgsfield for cinematic, Rive for animation only).

## Golden-path integrity

- **Every critical journey has expected event ordering.** Delete a telemetry event = engineering finding (INV-003).
- **Every visible route has a journey row in `04_JOURNEY_BIBLE`.**
- **Every claim about system state cites a file:line or a graph edge.**

## Development harness boundary (INV-008 · BC-003 prevention)

- **Production request handlers contain no alternate authentication, authorization, payment, identity, or security behaviour.** Development tooling executes outside the production request path.
- **Dev helpers live under `junior-backend/scripts/dev/**` or `junior-backend/tests/**`**, never inside `junior-backend/app/routes/**`.
- **No environment-branching, feature-flag branching, header-branching, or caller-identity branching** may deviate the auth / authz / payment / identity / security path in a route module.
- **Test-only fixtures write to the DB through the same primitives production uses.** Production route stays byte-identical in every environment.
- The 2026-07-12 `desktop_auth.py` audit is the seed instance; the auth hardening commit `c2421921` demonstrates the elimination pattern.

## Observability floor (INV-011 · every canonical state transition is provable)

- **Every write to a canonical state axis must produce four proofs:** telemetry event, regression test, journey step, owning station.
- **Transitions without all four are not considered observable.** They cannot count toward journey health, and bugs against them cannot be closed even by Doctor Full.
- Extends DECISION-0004 (only proof closes bugs) to state transitions themselves.

## Change management

- **No push / no deploy / no runtime promotion without human ✓.**
- **Every release passes the golden-path smoke gate** (`desktop-2/scripts/smoke-gate.sh`).
- **Every merge produces an impact report** (`lcos/reports/impact/<branch>/`).
- **Every wave commit uses the Impact Report template** at `lcos/reports/IMPACT_REPORT_TEMPLATE.md`.
- **Every wave follows the ten-step lifecycle** at `lcos/reports/WAVE_LIFECYCLE.md` (DECISION-0009).

## Constitution is amendable

Only by a Decision Graph entry that supersedes a numbered clause here, approved by Daniel.
