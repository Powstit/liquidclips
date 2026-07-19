# RC1 Handover Plan · Queued for Execution Post-GREEN

**Received from Daniel 2026-07-13** — execute after the final unchanged-commit
certification returns GREEN at HEAD `429e9140` (or whatever HEAD certifies).

Full instructions preserved verbatim below. Execute in order. Do NOT push an
undocumented code dump.

## Dropbox linking rule (added 2026-07-13)

The Nigerian dev team has Dropbox access. **In every MD file** in the handover
pack:
- Prefer **linking to Dropbox** for large binary assets: screenshots, video
  walkthroughs, prod deploy receipts, external design references, journey
  captures, HQ dashboards, brand kits, private roadmap decks.
- **Keep in git**: source code, source docs, the doc pack itself, small
  illustrative screenshots ≤500KB, config examples, `.env.example` (names
  only, never secrets).
- Every Dropbox reference must be a durable share link Daniel confirms is
  team-readable. If a link needs Daniel to generate, note it as
  `TODO: Daniel · generate Dropbox share link for X`.
- Use a consistent Dropbox root path in the MD headers (e.g.
  `Dropbox: /Liquid Clips/RC1 Handover/`) so the team can navigate the
  matching folder structure locally.
- Reference format: `[<label>](dropbox://<team-share-URL>)` in prose, and a
  Dropbox path anchor in a companion table for offline reference.

Rationale: git stays clean and reviewable; the dev team gets rich context
(video walk-throughs of the customer journey, real prod screenshots, brand
kits) without bloating the repository.

---

## 1. Final Git state

Before pushing:

* confirm the branch is clean
* confirm the exact final certified commit
* confirm no secrets, local `.env` files, tokens, keys, generated test debris or machine-specific paths are tracked
* preserve all relevant QA receipts and release reports
* do not modify, rebuild or release the Tauri/Rust shell
* runtime/frontend-only architecture remains locked unless Daniel explicitly reverses it

Push:

* the final integration branch
* a clearly named handover branch or tag
* the final certified commit SHA
* the authoritative `AUTOMATED_RELEASE_STATE.md`

Suggested tag: `rc1-dev-handover-2.2.36`

## 2. Developer handover pack

Central document: `docs/DEV_TEAM_HANDOVER.md`

Required sub-documents:

- `docs/PRODUCT_OVERVIEW.md` — what Liquid Clips is, who it serves, Clipper vs Agency mode, core customer journey, current pricing + tier behaviour, Whop's role, live vs mocked vs gated vs planned vs incomplete
- `docs/FEATURE_INVENTORY.md` — full matrix: feature name · route/surface · user tier · Clipper/Agency ownership · frontend component · backend/API dependency · status · automated coverage · known limitations · locked product rules · covering auth · cold entry · clip generation · workstation/editor · captioning · trimming · watermarking · styling · export · scheduling/posting · Whop submission · campaigns · submissions · analytics · wallet/earn · Sponsored Reward · affiliate · community · account/settings · TopHud/Kade · BrowseOverlay · runtime updates · account app · Agency preview/paywall
- `docs/ARCHITECTURE_MAP.md` — desktop runtime/frontend, Tauri shell boundary, account app, backend/API, Whop, auth flow, state, routing, local processing, clip/render/export pipeline, telemetry, test architecture, deployment, runtime update flow. Include Mermaid diagram. Mark what runs local vs remote, Whop-owned vs Liquid Clips-owned, and what must never be changed casually.
- `docs/HQ_CODEX_OPERATING_MODEL.md` — HQ triage flow (15 steps · PRODUCT/STALE-TEST/HARNESS/ENV/EXTERNAL/SUPPORT/FEATURE-REQUEST classification), specialist lanes, risk levels (low/medium/high), 40k paid users scale, dynamic Codex cohorts, HQ as control plane, user machines as compute
- `docs/HQ_INTEGRATION_SPEC.md` — event flow (app health · crash · support · failed actions · processing failures · auth failures · payment mismatches · update health · feature requests · diagnostic bundles). Each event's name/source/payload/privacy/severity/correlation-id/identifiers/retry/queue destination/Codex lane/escalation. HQ NOT on the critical clipping/render path — app must function safely if HQ is unavailable.
- `docs/CODEX_GUARDRAILS.md` — allowed vs blocked paths · command allowlist/blocklist · loc-change limits · dependency restrictions · schema restrictions · cost/token budgets · retry limits · PR requirements · evidence requirements · automated rollback · approval boundaries. Codex must never freely rewrite the core app.
- `docs/SELF_HEALING_ROADMAP.md` — each installed app becomes a bounded self-healing clipping workstation · diagnoses local processing/storage/permissions/config · repairs only safe app-level issues · escalates to HQ otherwise. Explicitly a roadmap, not current prod.
- `docs/SELF_EXTENDING_ROADMAP.md` — user custom feature requests via approved extension points · permission boundaries · isolated modules · compatibility checks · regression gates · local/user-specific by default · rollback · human review for core promotion. Self-healing first, self-extending later.
- `docs/LOCAL_SETUP.md` — cloning · deps · env · desktop frontend dev · account app dev · backend/local expectations · tsc · vitest · targeted Playwright · full D1 · builds · shell contracts · iron gates · QA reports. `.env.example` files with names only, never secrets.
- `docs/TEST_AND_RELEASE_RUNBOOK.md` — trusted gate runner · canonical commands · required order · targeted proof rules · full certification rules · failure classification · false-green avoidance · trace/screenshot/log preservation · runtime-only release path · rollback. State that manual walkthrough is NOT the functional release gate — automation proves functionality first.
- `docs/KNOWN_ISSUES_AND_DEBT.md` — every remaining warning · intentional skip · FIXME · mocked integration · incomplete API · deferred refactor · perf concern · test limitation · roadmap-only feature. No hidden debt.
- `docs/OWNERSHIP_AND_ESCALATION.md` — who owns frontend/runtime · account app · backend/API · Whop · auth · payments · QA · releases · infra · HQ · Codex agents · security incidents. Rule: Nigerian dev team owns normal maintenance. Daniel only needed for product intent, pricing, payments, security, locked features, strategic direction.

## 3. Root README

Rewrite so a new engineer understands in 10 min:

* what the product is
* repo structure
* setup
* key commands
* architecture link · feature inventory link · HQ/Codex plan link · release runbook link
* current certified state
* shell restriction

## 4. `docs/HANDOVER_SUMMARY.md`

* final certified commit
* runtime version
* current branch/tag
* what changed during RC1 sprint
* final test totals · known skips · current prod blockers
* immediate next priorities
* first-week tasks for dev team
* areas they must not change without approval

## 5. GitHub push report

After pushing, return:

* repository
* branches pushed
* tag created
* final commit SHA
* documents added
* test/release status
* any files intentionally excluded
* exact first command the new team should run
* recommended first three engineering tasks

**Handover is not complete until an unfamiliar developer could clone the repo, run it, understand the architecture, and know where a user issue flows through HQ and Codex.**
