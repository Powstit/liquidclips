# Ownership & Escalation · Liquid Clips

Who owns what. **Nigerian dev team owns normal maintenance.** Daniel is
only in the loop for product intent, pricing, payments, security, locked
features, and strategic direction.

`Dropbox: /Liquid Clips/RC1 Handover/ownership/`

If a decision needs Daniel, ping him. If it does not, ship it under the
gates in `docs/TEST_AND_RELEASE_RUNBOOK.md`.

---

## 1. Ownership by surface

### 1.1 Frontend / runtime bundle (`desktop-2/src/**`)

**Nigerian dev team owns.**

- All routes under `src/routes/**` (Section pipeline · money surfaces)
- All routes under `src/design-os/routes/**` (Design OS pipeline · tool surfaces)
- All components under `src/components/**` and `src/design-os/components/**`
- Watchdog primitive under `src/lib/watchdog/*`
- Runtime-update journey under `src/lib/update/*`
- Vite build config
- Runtime bundle release via `desktop-2/scripts/ship.sh`

**Must not touch without approval:** shell (`src-tauri/**`,
`Cargo.toml`, `tauri.conf.json`, `package.json` version), money-surface
mockups (`docs/mockups/approved/*.html`), iron gates, locked product
copy. See §3.

### 1.2 Account app (`account-app/**`)

**Nigerian dev team owns.**

- Next.js 16 routes, embed surfaces (`/embed/*`), admin tabs
- Vercel deploy from `account-app/` — see `DEPLOYMENT.md:24-65`
- Middleware policy for embed paths (must NOT set frame-deny headers on
  `/embed/*` — the desktop hosts them in a Tauri child webview)
- Admin HQ tabs — Missions · Banners · Announcements · Community Channels · Bonus Ledger

**Must not touch without approval:** payment code, Whop plan IDs, auth
precedence rules. See §3.

### 1.3 Backend / API (`junior-backend/**`)

**Nigerian dev team owns.**

- FastAPI routes, models, seed scripts
- Railway deploy from `junior-backend/` (`railway up --service
  junior-backend --detach`) — see `DEPLOYMENT.md:97-168`
- Community channels seed (9 rows · auto-idempotent on lifespan startup)
- Sponsored campaigns seed (3 rows · auto-idempotent)
- Admin CRUD endpoints for Banners · Announcements · Community
  Channels · Bonus Ledger

**Must not touch without approval:** the shell-frozen surface
(`junior-backend/CLAUDE.md` freeze rules), payment amounts, Stripe
integration.

### 1.4 Marketing (`liquidclips-marketing/**`)

**Nigerian dev team owns.**

- Next.js marketing site content
- Vercel deploy from `liquidclips-marketing/` — see `DEPLOYMENT.md:68-94`
- `/download` route auto-resolves the latest GitHub Release asset

**Must not touch without approval:** brand voice (see
`feedback_voice_no_bounty_use_skill.md`), pricing copy (§3.1),
positioning statements.

### 1.5 Whop integration

**Nigerian dev team owns** the code paths that call Whop APIs.

Includes:

- `openInApp` universal in-app URL router (`src/lib/openInApp.ts`) — every
  Whop URL must route through this (see
  `assert-shell-contracts.sh:139-154` for the call-site list)
- `BrowseOverlay` handoff to Whop (`src/components/browser/BrowseOverlay.tsx`)
- `SubmitToWhopModal` — Whop tracks views, approvals, payouts
- Whop bounty filter chips
- Backend Whop proxy under `junior-backend/whop/*`

**Escalate to Daniel:** any Whop API contract change (new endpoint, new
required field, deprecation), any Whop plan ID change, any change to
the community fallback URL (`https://whop.com/liquidclips/`).

### 1.6 Auth (Clerk + Whop)

**Nigerian dev team owns** the code, **Daniel owns the precedence
decision**.

- Wired: SimpleLoginPanel (primary signed-out surface)
- Auth ladder: SimpleLoginPanel → WelcomeRoute → WelcomeGate
- JWT keychain via Tauri command (`hasJwtKeychainPresence`,
  `resumeJwtFromKeychainForAuthAction`) — auth-action gated · never
  passive-read at boot
- Iron gate `bug-015.sh` guards the keychain passive-read rule
  (`assert-shell-contracts.sh:186-191`)

**Escalate to Daniel:** any change to Clerk vs Whop precedence, any
change to the auth precedence rule
(`liquid_clips_whop_lead_decision.md`), any change to the JWT keychain
namespace or storage service.

### 1.7 Payments

**Daniel owns. Do not modify without approval.**

- Stripe integration (backend)
- Whop plan IDs
- Watermark burn-in logic (proves free-tier receipt integrity)
- Tier definitions (clipper / solo / pro / agency / autopilot / guest)
- Pricing pivot to Agency-only $0 / $99.99/mo
  (`liquid_clips_pricing_pivot_2026-07-06.md`) — locked

### 1.8 QA

**Nigerian dev team owns.**

- Must run the gates in `docs/TEST_AND_RELEASE_RUNBOOK.md` before every
  claim of "done"
- Must classify every failing test into one of the 6 lanes
  (PRODUCT · STALE-TEST · HARNESS · ENV · EXTERNAL · SUPPORT ·
  FEATURE-REQUEST)
- Must preserve traces / screenshots / logs (see
  `TEST_AND_RELEASE_RUNBOOK.md` §7)
- Must never claim "done" without exact-artifact proof
  (`feedback_forbidden_fake_done.md`)

### 1.9 Releases

**Nigerian dev team can propose. Daniel signs off before public
release.**

- Dev team runs `desktop-2/scripts/ship.sh` (all gates + tag push + CI
  sign & notarise + manifest flip)
- Draft GitHub release + local DMG install allowed for review at any
  time
- **Public promotion of the DMG requires Daniel's sign-off.** No
  exceptions.
- Backend + account-app + marketing deploys are dev-team-owned
  operational housekeeping (see §1.10 Infra)

### 1.10 Infra

**Shared.**

- **Dev team owns:** `railway up --service junior-backend --detach`,
  `vercel deploy --prod` from `account-app/` and
  `liquidclips-marketing/`. Considered operational housekeeping (per
  `feedback_railway_deploys_authorized.md`).
- **Daniel owns:** DNS records (`liquidclips.app`,
  `account.liquidclips.app`, `api.liquidclips.app`,
  `updates.liquidclips.app`), Stripe account settings, Whop plan
  configuration, Vercel team ownership, Apple Developer certificate,
  GitHub secrets (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`,
  `TAURI_SIGNING_PRIVATE_KEY`).

### 1.11 HQ (Admin console)

**Nigerian dev team owns.** They are the primary operators.

- Admin HQ tabs at `account-app/src/components/admin/`
- Journey Map tab (source of truth for 80 customer journeys)
- Node health tab (planned — see `docs/SELF_HEALING_ROADMAP.md` Phase 1)
- LCOS events tab (already wired via `POST /lcos/events/ingest`)

**Escalate to Daniel:** any change to the admin permission model, any
change to which events are visible to which admin role.

### 1.12 Codex agents

**Co-owned.** Nigerian dev team + Daniel co-own the guardrails.

- Dev team runs Codex agents day-to-day within the allowed paths and
  LOC-change limits documented in
  `docs/CODEX_GUARDRAILS.md` (companion doc in the RC1 handover pack)
- Daniel signs off on Codex allowlist / blocklist changes, cost / token
  budgets, retry limits, and PR requirements
- Codex must never freely rewrite the core app — see the guardrails doc

### 1.13 Security incidents

**Daniel first.** Then dev team executes.

- Any suspected exposed secret → Daniel immediately + rotate per
  `DEPLOYMENT.md:264-306`
- Any suspected cross-tenant data leak → Daniel + freeze the affected
  API surface + emit HQ incident event
- Any suspected auth bypass → Daniel + roll auth secrets + emit HQ
  incident event
- Any customer-reported "someone else's data appeared in my account"
  → Daniel

**Never publish a security fix quietly.** Security fixes always include
a post-mortem and an HQ observability upgrade so the class of bug is
prevented at the system level.

---

## 2. Escalation matrix

| Incident type | First contact | Then | Deadline |
|---|---|---|---|
| Live prod bug (auth · money · clipping · export) | Dev team on-call | Fix under gates · deploy · post-mortem in HQ | 4h to mitigate |
| Live prod bug (community · analytics · brand) | Dev team on-call | Fix under gates · deploy | 24h to mitigate |
| Security incident (any) | **Daniel** | Rotate secrets · freeze surface · post-mortem | Immediate |
| Payment mismatch (Stripe / Whop) | **Daniel** | Investigate · pause the surface if needed | Immediate |
| Whop API contract change | **Daniel** (product decision) | Dev team wires under gates | 48h |
| Clerk plan / precedence change | **Daniel** | Dev team wires under gates | 48h |
| DNS / cert / Apple / signing failure | **Daniel** + dev team | Daniel unblocks credential · dev team retries | Immediate |
| New surface / feature request | Dev team + Daniel product review | Sprint planning · never mid-cycle | Sprint boundary |
| Test flake (not a real bug) | Dev team | Fix the test OR classify STALE-TEST OR HARNESS | 24h |
| Failing D1 sweep (composite failure > 1) | Dev team on-call | Freeze release · classify · fix under gates | 4h |
| Failing shell contract guard | Dev team on-call | Freeze anything new · fix the underlying assertion | 4h |
| Codex agent hit its budget | Dev team | Review · either raise budget with Daniel or fix the loop | 24h |

---

## 3. Areas the dev team MUST NOT change without approval

Each of these is guarded — some by iron gates, some by ship-lens rules,
some by product locks. Editing without approval is a release blocker.

### 3.1 Pricing / tier definitions

- Agency-only pricing model ($0 / $99.99/mo · other tiers deferred)
  — see `liquid_clips_pricing_pivot_2026-07-06.md`
- Free-tier watermark burn (proves free-tier receipt integrity) —
  guarded by shell contract at
  `assert-shell-contracts.sh:193-201`
- Free-tier clip cap (10 clips)
- Any change to a tier's per-user limits, feature access, or pricing

### 3.2 Money-surface behaviour

Money surfaces need approved HTML mockup + founder video + 3+ explicit
states (loading · empty · error minimum) — see
`desktop-2/CLAUDE.md:10-35`. Adding a new money surface without an
approved HTML in `desktop-2/docs/mockups/approved/` is a ship-lens
failure.

Current money surfaces:

- Wallet (`src/routes/wallet-detail/`)
- Cold-entry (`src/routes/cold-email/`)
- Outreach
- Cancellation
- Catalog
- Sponsored Reward (`src/routes/sponsored-reward/`)

### 3.3 Iron gate sentinels

Marker: `IRON GATE IG-NNN`. Pre-commit hook enforces presence. Never
delete a sentinel without the documented override.

- `IG-012` — brand-token parity between `desktop/src/index.css` and demo
  HTML mirrors. Run `bash desktop/scripts/brand-kit-drift-check.sh`
  after any change to the token list.
- `IG-013` — agency-preview paywall (see
  `desktop-2/scripts/iron-gates/agency-preview-paywall.sh`)
- `IG-015` — keychain passive-read guard (see
  `desktop-2/scripts/iron-gates/bug-015.sh`)

### 3.4 The shell (Rust / Tauri config)

The shell is **FROZEN**. Do not modify:

- `desktop-2/src-tauri/**`
- `desktop-2/Cargo.toml` / `desktop-2/src-tauri/Cargo.toml`
- `desktop-2/src-tauri/tauri.conf.json` /
  `desktop-2/src-tauri/tauri.dev.conf.json`
- `desktop-2/package.json` version (only bumped by `scripts/ship.sh`)
- `desktop-2/python-sidecar/**`
- Anything that would require a new Tauri build

Any change here is a shell release — follow `desktop-2/RELEASING.md`
after Daniel approves.

### 3.5 Whop plan IDs

Live in backend config + `NEXT_PUBLIC_WHOP_CHECKOUT_PLAN_ID` (Vercel env
var on account-app). Changing them requires Daniel + a coordinated
deploy across all four surfaces.

### 3.6 Auth precedence rules

Locked in `liquid_clips_whop_lead_decision.md`: **Whop primary, Clerk
fallback.** Any change to this precedence (which auth writes the JWT
first, which credential resolves the tier, which surface owns the
signed-out user) requires Daniel.

### 3.7 Locked product decisions

- **Agency-only pricing** (§3.1)
- **Ayrshare is a MISTAKE** — walk-around is the persistent-cookie in-app
  webview + assisted-schedule local records + native OS notification.
  See `feedback_ayrshare_mistake.md` and
  `liquidclips_publish_walkaround.md`.
- **Fallback resilience scoped to Wallet only** — see
  `desktop-2/CLAUDE.md:54-71`.
- **Voice** — no "bounty", use "skill / clip job / paid post". See
  `feedback_voice_no_bounty_use_skill.md`.
- **Runtime bundle release path** — tag + `ship.sh` + CI. Never hand out
  a locally built DMG.
- **The 80 customer journeys catalogued in `JourneyMapTab.tsx`** — the
  primary state-of-truth. Any change updates the tab + this file +
  `docs/KNOWN_ISSUES_AND_DEBT.md` + `ship-lens-review.json` in the same
  turn.

---

## 4. Sign-off contract

Before Daniel signs off on a public release, the dev team ships:

- Release checklist from `docs/TEST_AND_RELEASE_RUNBOOK.md` all green
- Direct proof for every completion claim (exact artifact, not
  neighbouring evidence — per `feedback_forbidden_fake_done.md`)
- Regression proof for every fix
- Remaining gap for every not-yet-fixed item (no hidden debt)
- HQ event stream shows the release running clean on the internal test
  install for at least 24h

Daniel signs off in writing. Dev team ships the manifest flip. Rollback
plan is in `docs/TEST_AND_RELEASE_RUNBOOK.md` §9.

---

## References

- `desktop-2/CLAUDE.md` — money-surface rule · lane boundaries · perf
  contract
- `CLAUDE.md` (root) — cross-cutting rules · completion discipline ·
  deployment topology summary
- `DEPLOYMENT.md` (root) — canonical deploy topology + secret hygiene
- `desktop-2/RELEASING.md` — ship definition
- `docs/TEST_AND_RELEASE_RUNBOOK.md` — gate order + release checklist
- `docs/KNOWN_ISSUES_AND_DEBT.md` — the debt they own
- `docs/SELF_HEALING_ROADMAP.md` — Watchdog + HQ instrumentation roadmap
- `docs/SELF_EXTENDING_ROADMAP.md` — extension-point roadmap
- `docs/HQ_CODEX_OPERATING_MODEL.md` — 6-lane classification (companion doc)
- `docs/CODEX_GUARDRAILS.md` — Codex allowlist / blocklist (companion doc)
- `desktop-2/scripts/assert-shell-contracts.sh` — the shell contract
  guard the whole team runs
- `[Ownership matrix diagram](dropbox:///Liquid%20Clips/RC1%20Handover/ownership/matrix.png)` — `TODO: Daniel · generate Dropbox share link for ownership matrix diagram`
- `[Escalation playbook video](dropbox:///Liquid%20Clips/RC1%20Handover/ownership/escalation-playbook.mp4)` — `TODO: Daniel · generate Dropbox share link for escalation playbook video`

## Verification checklist

Files inspected while writing this doc:

- [x] `/Users/dipdip/code/jnr/desktop-2/CLAUDE.md`
- [x] `/Users/dipdip/code/jnr/CLAUDE.md`
- [x] `/Users/dipdip/code/jnr/DEPLOYMENT.md`
- [x] `/Users/dipdip/code/jnr/desktop-2/RELEASING.md`
- [x] `/Users/dipdip/code/jnr/desktop-2/scripts/assert-shell-contracts.sh`
- [x] `/Users/dipdip/code/jnr/desktop-2/scripts/ship.sh`
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/HANDOVER_PLAN_QUEUED.md`
- [x] `/Users/dipdip/code/jnr/lcos/reports/rc1-sprint/OWNERSHIP_MATRIX_TRAIN_A.md`
- [x] `/Users/dipdip/code/jnr/lcos/09_BUG_LEDGER.md` (BUG-012 native constraint)
- [x] `/Users/dipdip/code/jnr/desktop-2/src/lib/watchdog/` (source of §1.11 HQ node consumer)
