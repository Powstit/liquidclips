# Codex Guardrails

Owner: Liquid Clips core • Audience: Codex triage agents + reviewers
Status: RC1 handover • Last citation sweep 2026-07-13

These are the rules Codex agents **must** follow. Codex never freely
rewrites the core app. Every edit lands as a small, verifiable diff
inside the allowed lanes described in `HQ_CODEX_OPERATING_MODEL.md`.

If a rule below and a rule elsewhere disagree, this file wins for Codex
behaviour.

---

## Path scopes

### Allowed paths

Codex may edit files under these roots only, subject to the LOC and
dependency rules below.

- `desktop-2/src/**` — production TS/TSX (but not the shell — see
  frozen list below).
- `desktop-2/docs/**` — internal engineering docs. Never publish or
  copy to marketing.
- `desktop-2/tests/**` — Playwright + vitest test files.
- `desktop-2/src/**/*.test.ts(x)` — colocated unit tests.

### Blocked paths (frozen shell — do not touch)

Every path below is FROZEN per `desktop-2/CLAUDE.md`
("The shell is FROZEN — no Rust / Cargo / tauri.conf / sidecar /
package.json / new native commands / shell rebuild without an explicit
greenlight").

- `desktop-2/src-tauri/**` — Rust shell + Cargo lockfile + native
  commands.
- `desktop-2/tauri.conf.json` — Tauri config.
- `desktop-2/package.json` — deps frozen without human approval
  (see Dependency restrictions below).
- `desktop-2/pnpm-lock.yaml`, `desktop-2/package-lock.json` —
  regenerated only when a human-approved dep change lands.
- `.github/workflows/**` — CI ownership stays with Daniel + the
  Nigerian dev team lead. Codex may propose in a comment; never edit.
- `**/secrets/**` — any secrets directory, anywhere in the tree.
- `**/.env`, `**/.env.*` — never open, never read, never write.
- `~/.claude-credentials/**` — user credential mirror; out of scope.
- `desktop-2/src-tauri/target/**` — build artifacts.
- `desktop-2/src/components/SectionWithFallback.tsx` — Lane B
  territory per `desktop-2/CLAUDE.md` ("Do NOT touch:").
- `desktop-2/src/design-os/routes/EarnRoute.tsx` — deprecated behind
  the money-surface rule per `desktop-2/CLAUDE.md`.
- Anything under `junior-backend/**` — Lane B (backend).
- Anything under `account-app/**` admin tabs — Lane B (account-app).

### Money surfaces (always high-risk, human approval required)

Per `desktop-2/CLAUDE.md` money-surface rule, these routes are always
human-approved even inside the allowed roots above. Codex may propose
edits but cannot self-approve.

- `desktop-2/src/routes/wallet-detail/**` — Wallet.
- `desktop-2/src/routes/**` — every route registered under the
  Section pipeline for a money surface (Cold entry, Outreach,
  Cancellation, Catalog, Wallet).
- `desktop-2/docs/mockups/approved/**` — approved HTML mockups.
  Never move, rename, or delete.

Adding a **new** money surface requires the approved mockup + founder
video + 3 explicit states before any code lands. Codex cannot
introduce a money surface; only wire an approved one.

---

## Command allowlist

Codex may run these commands during triage and verification:

- `npm run test`
- `npx tsc -b`
- `npm run dev`
- `npx playwright test`
- `bash scripts/assert-shell-contracts.sh`
  (`desktop-2/scripts/assert-shell-contracts.sh` — Kade/design-OS
  shell guard)
- `bash desktop/scripts/brand-kit-drift-check.sh` — token parity
  check per repo-root `CLAUDE.md` §IG-012 (read-only for Codex,
  never edits the CSS).
- `git status`, `git diff`, `git log` (read-only).
- `git add <path>`, `git commit -m <msg>` inside a Codex-owned branch
  only. Never on `main` / `master`.

## Command blocklist

Never run these. Any of these attempts is an immediate escalation.

- `railway up` — deploys backend, out of Codex scope
  (per `junior-backend/CLAUDE.md`).
- `vercel deploy` (all variants) — deploys account-app or marketing.
- `pnpm publish`, `npm publish` — no package publish.
- `git push --force`, `git push -f`, `git push --force-with-lease` —
  destructive push.
- `git reset --hard origin/*`, `git reset --hard HEAD~*` — destructive
  reset.
- `git branch -D`, `git branch --delete --force` — destructive branch
  delete.
- `git checkout .`, `git restore .`, `git clean -f`, `git clean -fd` —
  work destroyer.
- `rm -rf **` — never. Even inside allowed paths.
- `curl <any external URL>` — network egress out of Codex sandbox.
  Codex must not fetch from the public internet during triage.
- `chmod`, `chown` — never rewrite permissions.
- `git config` (write mode) — never mutate git config.
- Any `--no-verify` / `--no-gpg-sign` flag — never skip hooks.

Sudo, brew, npm global installs, and system-level package managers are
implicitly blocked (Codex has no shell escalation).

---

## LOC-change limits

Single PR: **≤ 500 LOC across ≤ 5 files**. Break larger work into
staged PRs.

Inside 500 LOC, autonomy still depends on lane (see
`HQ_CODEX_OPERATING_MODEL.md` §3):

| Lane | Self-approve? | LOC ceiling for self-approve |
| --- | --- | --- |
| STALE-TEST | Yes | ≤ 200 |
| HARNESS | Yes | ≤ 200 |
| PRODUCT (Low risk) | No — human review | ≤ 500 |
| PRODUCT (Med / High) | No — human review | ≤ 500 |
| ENV / EXTERNAL / SUPPORT / FEATURE-REQUEST | N/A — no code PR | — |

A PR that would cross 500 LOC or 5 files is split at the natural
seam (usually one file per concern) and cross-linked.

---

## Dependency restrictions

- Codex **cannot** add, remove, upgrade, or downgrade any
  `dependencies` / `devDependencies` entry in
  `desktop-2/package.json`.
- Codex **cannot** touch `pnpm-lock.yaml` or `package-lock.json`
  except as a side-effect of a human-approved dep change PR
  authored by a human.
- Codex **cannot** add pip requirements to `junior-backend/**` (out
  of scope anyway per Blocked paths above).
- Codex **cannot** modify `Cargo.toml` / `Cargo.lock`.

If a fix requires a new dependency, Codex opens a **proposal**
(a doc PR under `desktop-2/docs/`) instead of a code PR. Human
reviewer decides.

---

## Schema restrictions

- No DB migrations. Backend schema is out of Codex scope.
- No changes to `desktop-2/src/lib/telemetry/eventRegistry.ts`
  event-name → payload map without a human-approved envelope-shape
  memo. Adding a new event name is fine; changing the payload shape
  of an existing event is not.
- No changes to the `lcos_event` idempotency tuple
  `(topic, ts_ms, payload_hash)` behaviour
  (`junior-backend/app/routes/lcos_events.py:102–172`) — out of
  scope anyway; called out here so Codex knows not to propose it.

---

## Cost + token budget

- Max **100 000 output tokens per PR triage cycle**. Cycle = ingest
  → classify → propose → verify → PR.
- Cycles that exceed the budget hard-stop and escalate with the
  partial trail attached.
- Model choice is fixed by the platform; Codex may not switch models
  mid-cycle to stretch the budget.

---

## Retry limits

- **3 retries max** for a failing verification check
  (`npx tsc -b`, `npm run test`, `npx playwright test`,
  `bash scripts/assert-shell-contracts.sh`).
- After 3 retries on the same failing check, Codex escalates to the
  human queue with:
  - the failing check name
  - the exact stderr for each attempt
  - the interceding change (if any)
  - the current diff
- Retries **never** silence a failure by weakening the check
  (see "PR requirements" below). Retrying with `--retry-failed`
  or `--reporter=null` is prohibited.

---

## PR requirements

Every Codex PR must include:

- **Descriptive title** — imperative mood, ≤ 72 chars, no emojis
  (per repo-root `CLAUDE.md` conventions).
- **Diff summary** — bullet list of files touched + one-line
  intent per file.
- **Lane declaration** — one of PRODUCT / STALE-TEST / HARNESS /
  ENV / EXTERNAL / SUPPORT / FEATURE-REQUEST (from
  `HQ_CODEX_OPERATING_MODEL.md` §2).
- **Verification section** — the actual green output of:
  - `npx tsc -b`
  - `npm run test` (relevant scope)
  - `npx playwright test` (relevant scope)
  - `bash scripts/assert-shell-contracts.sh`
- **Regression proof** — for any bug-fix PR, the exact test / repro
  that previously failed and now passes. No claim without proof.
- **Deliberate-regression proof when applicable** — if a fix
  deliberately changes behaviour, name the old behaviour and the
  new one and why.
- **Zero broad retries** — CI cannot include `retries > 0` unless the
  PR is a HARNESS PR whose scope is documented flake reduction.
- **Zero assertion weakening** — a diff that changes
  `expect(x).toBe(y)` into `expect(x).toBeTruthy()` (or removes an
  assertion entirely) is rejected unless the PR explicitly declares
  it as a STALE-TEST update with a paragraph explaining the intent
  change.
- **Zero `.skip` / `.only`** — no skipped or focused tests in the
  merged diff. A test that must be quarantined moves to an
  explicitly-named quarantine file with a linked issue and a date.

---

## Evidence requirements (completion discipline)

Codex must obey the completion-discipline gate at
`~/.claude/skills/completion-discipline/SKILL.md` — the same gate
that applies to human contributors.

Every completion claim ("done", "fixed", "green", "shipped", "ready",
etc.) must:

1. Name the exact artifact (file:line or route or endpoint).
2. Name the exact environment (dev / QA / prod / installed Tauri).
3. Attach direct proof (green run output, curl response, screenshot
   for UI).
4. Attach regression proof (the previously-failing check, now green).
5. State the remaining gap explicitly if partial.

- Source code proves **on disk**, not built.
- A green `tsc -b` proves **compiles**, not installed.
- Vite / dev-server behaviour never proves the installed Tauri app.
- HTTP 200 proves reachability, not the changed feature.
- Anonymous 401 proves authentication runs, not tenant isolation.
- Push, backend deploy, Vercel deploy, and desktop release are
  distinct states — never conflated.

If direct or regression proof is missing, Codex downgrades the state
and names what remains — never claims "done" without both.

---

## Automated rollback

Any post-merge failure inside the first hour of shipping triggers an
automatic revert of the offending commit.

Definition of "failure":

- Any `stable_error_code` regression fingerprint whose count
  crosses the pre-merge baseline by 3× within 60 min.
- Any `sidecar_probe` regression producing `state_not_managed` or
  `bundle_missing` at >0.1% of session boots.
- Any Sign-in Ops tab spike (Whop 401 / Clerk 401 / exchange
  failures) that exceeds baseline by 3× within 60 min.

The revert is a plain `git revert <sha>` PR authored by the rollback
bot, merged by the on-call human, and shipped through the standard
release path. Codex does not perform the rollback — it only observes,
alerts, and prepares the revert PR.

Rollbacks after 1 hour go through normal human decision.

---

## Approval boundaries

- **Money surfaces** — Wallet, Cold entry, Outreach, Cancellation,
  Catalog (per `desktop-2/CLAUDE.md` money-surface rule) — always
  require Daniel's approval. Codex cannot self-approve any diff that
  touches these paths even if the LOC count is under the Low-risk
  ceiling.
- **Iron gates** — any file containing an `IRON GATE IG-NNN`
  sentinel comment. Grep shows currently active gates including
  `IG-003` (`desktop-2/src/overlays/IntroSplash.tsx:1`),
  `IG-012` (brand token parity — repo-root `CLAUDE.md`),
  `IG-SOV-2.2-001` (Sponsored Reward Rules —
  `desktop-2/src/design-os/earn/SponsoredRewardCard.tsx:13`),
  `IG-LC2-015..018` (Workstation + cockpit + preview shell —
  `desktop-2/docs/lc2/IRON_GATES_LC2.md`). Codex **never**
  removes a sentinel. Editing inside a sentinel span requires
  human approval and a note in the PR body.
- **Auth surfaces** — `SimpleLoginPanel`, `ClerkOtpPanel`,
  `authedFetch.ts`, telemetry sinks — always human review.
- **Envelope shape** — see Schema restrictions above.
- **Retirements** — never remove a route, tab, feature flag, or
  event topic without a written retirement memo approved by
  Daniel.

---

## Codex must NEVER freely rewrite the core app

Restated for clarity: a diff whose intent is "modernise", "simplify",
"clean up", "refactor for readability", or "unify" — with no linked
bug, failing test, or user-visible issue — is out of scope. Codex
triages incoming events. It does not curate the codebase.

The Nigerian dev team owns codebase curation. Codex assists by
gathering evidence and drafting proposals in `desktop-2/docs/**`, not
by opening speculative refactor PRs.

---

## Verification checklist

- [ ] Allowed and blocked paths enumerated with explicit citations
      to `desktop-2/CLAUDE.md`
- [ ] Command allowlist covers `npm run test`, `npx tsc -b`,
      `npm run dev`, `npx playwright test`,
      `bash scripts/assert-shell-contracts.sh`
- [ ] Command blocklist covers `railway up`, `vercel deploy`,
      `pnpm publish` / `npm publish`, `git push --force*`,
      `git reset --hard origin/*`, `rm -rf **`, `curl <external URL>`
- [ ] LOC limit stated (≤ 500 LOC across ≤ 5 files)
- [ ] Dependency and schema restrictions explicit
- [ ] Token budget (100k out per cycle) + retry limit (3) recorded
- [ ] PR requirements list green verification + regression proof +
      no assertion weakening + no broad retries
- [ ] Automated rollback rules named with concrete thresholds
- [ ] Money surfaces + iron gates + auth surfaces named as always-
      human boundaries
- [ ] Final "never freely rewrite the core app" rule present
