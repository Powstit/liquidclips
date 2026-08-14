# Self-Onboarding Release Master

Owner: Daniel  
Executor: Claude  
Release gate: Cohort 0 local proof  
Status: **CLOSED 2026-08-14 — see "Gate closure" below. No longer an active freeze.**

This is the canonical execution order for the self-onboarding release. It is
self-contained: do not ask Daniel to restate a gate that is written here.

## Gate closure (2026-08-14)

Steps 2–8 were formally receipted (ledger below). Step 9's formal receipt
was never issued — no `SO-GATE-9-…` value exists, and there is no logged
`installed-desktop-local` clean-install evidence in this repo for it.

Despite that, production has been observably live and operating normally
well before this date: desktop releases have shipped (including v2.3.22),
the backend has deployed repeatedly, real users have signed up and been
billed, and real affiliate payouts have gone out. Root `CLAUDE.md`'s own
"v0.7.55 live state" section — dated before this entry — already states
account-app, marketing, and backend are live, "confirmed with Daniel
directly." The freeze this document describes does not match the observed
state of the system.

Authorization to close this gate was relayed by Daniel through Victor
(who has access to Daniel's accounts) directly in a Claude session on
2026-08-14. This is **not** a Step 9 receipt — no fresh clean-install
walkthrough was run or evidenced as part of this closure. It is an
explicit decision that the formal gate process is superseded by the
already-live product, made by the document's owner.

**Effective 2026-08-14: no push/deploy/tag/production-mutation restriction
from this document applies.** Future sessions should treat this file as
historical record of how the initial launch was gated, not as an active
process to re-enter or a reason to freeze current work.

## Non-negotiable execution protocol

1. Work strictly in Step 2 → Step 9 order.
2. Scope the next step before editing. Name the files, migrations, tests, and
   rollback boundary.
3. Do not touch the deferred Kade/Splash/Community work or marketing.
4. Do not push, deploy, tag, or modify production while this gate is active.
5. A passing build is not journey proof. A screenshot is not tenant-isolation
   proof. An HTTP 200 is not feature proof.
6. Every step must produce direct proof, regression proof, and zero undisclosed
   gaps.
7. Store proof logs outside the repository, for example:
   `/tmp/liquidclips-release-evidence/step-N/`.
8. Create the step evidence JSON described in
   `scripts/self_onboarding_gate_receipt.py`.
9. Run:

   ```bash
   python3 scripts/self_onboarding_gate_receipt.py \
     --step N \
     --evidence /tmp/liquidclips-release-evidence/step-N/evidence.json
   ```

10. The receipt script executes the direct and regression commands itself
    without a shell and captures their logs. Paste the emitted `SO-GATE-N-…`
    value into the gate ledger below. The script refuses to issue a receipt
    when a command fails, required assertions or artifact files are missing,
    or gaps are not explicitly empty.
11. Do not start the next step until the preceding receipt is present.

The receipt prevents accidental completion claims. It is not permission to
push or deploy.

## Gate ledger

| Step | Gate | State | Receipt |
|---|---|---|---|
| 2 | Server-owned authorization capability matrix | RECEIPT ISSUED | `SO-GATE-2-0C04E1BD0537-F28B7948A1D60E5A7243` |
| 3 | Remove production fixture fallbacks | RECEIPT ISSUED | `SO-GATE-3-3E665101B98B-B9E9C2642C24089E13C0` |
| 4 | Clipper + Agency onboarding state machines | RECEIPT ISSUED | `SO-GATE-4-C1404D65B994-C6AFED65FCB2B00C9FAB` |
| 5 | Typed observability adapter + closed event registry | RECEIPT ISSUED | `SO-GATE-5-E88DC1EAA4E8-78C2FD4A04015B3C97D7` |
| 6 | Desktop error sender → backend telemetry → HQ | RECEIPT ISSUED | `SO-GATE-6-165E22F57067-7B0CC6A0B250A84CE16C` |
| 7 | PostHog + Sentry + Railway + stuck-user HQ view | RECEIPT ISSUED | `SO-GATE-7-80EB6B11ED6D-69E10F65A8A5CC6B42FB` |
| 7.5 | Agent substrate (Agent registry · AgentAction audit · provider abstraction · kill switches · credit caps · closed-registry capabilities) | SHIPPED · informal (substrate for Step 8) | commit `dd7f39c → e0ab1b6` · 16/16 named assertions verified |
| 8 | Four-identity authorization and journey proof | RECEIPT ISSUED | `SO-GATE-8-30C8BF34D78F-97D2E943435187DDA28C` |
| 9 | Clean-install, zero-fixture Cohort 0 proof | SUPERSEDED 2026-08-14 · no formal receipt exists; gate closed on Daniel's relayed authorization given the product's already-live state (see "Gate closure" above) | `PENDING — closed without receipt, not issued` |

## Step 2 — Server-owned authorization capability matrix

### Outcome

The backend, not email checks or UI tier inference, returns and enforces an
authorization context. Commercial entitlement, platform authority, tenant
membership, and operating mode remain separate dimensions.

### Required contract

Create a closed capability registry and a pure evaluator returning:

- actor user ID;
- raw and effective plan;
- platform role;
- founder/comp entitlement state;
- tenant memberships and role per tenant;
- active operating mode: `self`, `demo`, or `support`;
- target tenant, when support mode is active;
- closed capability set;
- server limits;
- capability schema version.

Minimum capabilities:

- `clipper.use`
- `agency.workspace.read`
- `agency.campaign.create`
- `agency.campaign.update`
- `agency.campaign.publish`
- `agency.campaign.archive`
- `agency.roster.read`
- `agency.roster.manage`
- `agency.rules.manage`
- `agency.payouts.read`
- `agency.payouts.manage`
- `hq.read`
- `hq.mutate`
- `support.tenant.read`
- `support.tenant.write`
- `demo.plan_override`

Founder is an entitlement override, not a platform role. Admin self/demo mode
gets full product entitlement against the admin's own records only. Cross-
tenant support requires explicit target, reason, expiry, capability, and audit
record. Customer `/agency/*` routes must not contain an unconditional admin
ownership bypass.

Add capabilities and version to `/me` and `/sync`. Preserve legacy response
fields for one compatibility release. Server mutations recompute authorization
from current database state; they do not trust stale JWT feature claims.

Migrate routes in narrow batches:

1. Pure evaluator and table-driven unit tests.
2. `/me`, `/sync`, and JWT compatibility fields.
3. Agency owner/tenant checks.
4. HQ read and mutation checks.
5. Account-app server gates.
6. Desktop consumption.

### Required assertions

- `clipper_self_allowed`
- `clipper_hq_denied`
- `agency_a_self_allowed`
- `agency_a_to_b_denied`
- `admin_demo_own_only`
- `admin_support_requires_context`
- `admin_support_write_audited`
- `stale_jwt_rechecked`

### Regression boundary

- Existing agency A-versus-B tests remain passing.
- Missing, invalid, and expired bearer tokens remain rejected.
- Admin HQ still opens for the configured admin.
- Ordinary Clipper and Agency sessions do not become locked out.

## Step 3 — Remove production fixture fallbacks

### Outcome

A new or empty account renders honest loading, empty, unavailable, and error
states. No production code invents users, clips, channels, campaigns, earnings,
usage, leaderboard entries, tier, or onboarding progress.

### Work

- Inventory every import from `fixtures`, `mock`, `demo`, `sample`, `fake`,
  simulator defaults, fallback arrays, and seeded UI constants.
- Classify each as `test-only`, `design-preview-only`, `required system
  catalogue`, or `production fixture`.
- Move test/design fixtures behind compile-time or explicit test harness
  boundaries.
- Replace production fallbacks with typed states:
  `loading | empty | unavailable | error | real`.
- Remove the desktop's paid `SIMULATOR_DEFAULT_TIER` fallback and
  `DEFAULT_USAGE` from production gating.
- Preserve required system catalogues only where they are product definitions,
  not pretend user activity.
- Add a scanner that fails when prohibited fixture imports reach a production
  entry point.

### Required assertions

- `production_fixture_scan_zero`
- `simulator_is_test_only`
- `unknown_state_fail_closed`
- `zero_dummy_rows`

### Regression boundary

- Tests may still install fixtures explicitly.
- Empty-state routes mount without crashes.
- Paid/Agency writes cannot unlock from missing or degraded `/me`.

## Step 4 — Complete Clipper and Agency onboarding state machines

### Outcome

Onboarding is server-owned, resumable, idempotent, and naturally populates the
app from real user actions.

### Required state model

Every transition records actor, journey, previous state, next state, timestamp,
source surface, schema version, and idempotency key.

Clipper minimum path:

`account_created → desktop_connected → source_added → first_clip_generated →
first_edit_completed → first_export_completed → first_publish_or_download`

Agency minimum path:

`account_created → agency_plan_active → agency_profile_started →
first_campaign_created → first_invite_sent → first_member_joined →
first_submission_received → first_review_completed`

Define honest skip, blocked, retry, abandoned, and resumed behavior. Repeated
events must not duplicate progress. Admin/demo entitlement must not fabricate
milestones.

### Required assertions

- `clipper_resume`
- `clipper_idempotent`
- `agency_resume`
- `agency_idempotent`
- `server_owned`

### Regression boundary

- Existing milestone reconciliation tests pass.
- Restarting either client resumes at the server state.
- A failure between two transitions cannot advance the later milestone.

## Step 5 — Typed observability adapter and closed event registry

### Outcome

Features emit one closed, typed, privacy-safe event contract through a central
adapter. Components do not call PostHog, Sentry, Railway, or Admin HQ directly.

### Required envelope

- event name from a closed registry;
- event schema version;
- anonymous/internal actor reference;
- journey and feature IDs;
- surface and route;
- release and build identifiers;
- environment;
- operating mode and entitlement class;
- onboarding state;
- correlation/session/attempt IDs;
- success, failure, duration, and stable error code;
- sanitized metadata only.

The adapter fans out to configured sinks and remains non-blocking if a sink is
offline. Unknown events fail during type-check/test, not silently at runtime.
No email, JWT, token, raw URL query, local path, prompt content, or customer
media metadata may be sent.

### Required assertions

- `closed_registry`
- `unknown_event_rejected`
- `pii_redacted`
- `feature_context_attached`
- `adapter_failure_nonblocking`

## Step 6 — Desktop error sender to telemetry and HQ

### Outcome

The existing `/telemetry/desktop-error` collector receives real sanitized
desktop failures, deduplicates them, and exposes an actionable HQ incident.

### Work

- Implement the desktop sender through the Step 5 adapter.
- Buffer briefly while offline; use bounded retry with jitter and a hard cap.
- Never retry a permanent 4xx except rate limiting.
- Add release, feature, journey, route, operating mode, correlation ID, stable
  error code, and stack fingerprint.
- Preserve backend body limits and redaction.
- Group HQ errors by release + feature + error code + fingerprint.
- Show count, affected internal users, first/last seen, environment, route,
  release, and latest sanitized message.
- Prove telemetry failure never blocks the user action.

### Required assertions

- `desktop_sender_real`
- `offline_buffer_retry`
- `backend_stores_sanitized`
- `hq_displays_fingerprint`
- `dedupe_verified`

## Step 7 — PostHog, Sentry, Railway and stuck-user HQ view

### Outcome

One correlation model connects product behavior, exceptions, deployment state,
and onboarding stalls without duplicating business logic in each sink.

### Work

- PostHog: Clipper and Agency onboarding funnels using the closed registry.
- Sentry: release, environment, feature, journey, stable error code, and
  correlation tags; no PII.
- Railway: authenticated webhook ingestion for deployment started/succeeded/
  failed/rolled back, with replay protection and signature verification.
- HQ stuck-user view: last successful milestone, blocked state, age, repeated
  failure code, release, and safe support action.
- Correlate all four systems using release + feature + journey + correlation
  identifiers.
- Define alerts with deduplication, thresholds, cooldown, and ownership.

### Required assertions

- `posthog_funnel`
- `sentry_release`
- `railway_webhook_verified`
- `hq_stuck_user_view`
- `cross_tool_correlation`

## Step 8 — Four-identity proof

### Identities

1. Ordinary Clipper.
2. Agency owner A.
3. Agency owner B.
4. Platform admin.

### Proof matrix

- Each identity signs in through the real local auth boundary.
- Clipper completes the allowed self-onboarding path and cannot open HQ or
  Agency management.
- Agency A can manage A and cannot discover/read/mutate B.
- Agency B can manage B and cannot discover/read/mutate A.
- Admin self/demo uses real personal data with full product entitlement but
  does not silently inherit A or B.
- Explicit support-read targets one tenant, expires, and audits.
- Support-write is separately authorized, reasoned, time-bounded, and audited.
- Revocation/downgrade affects the next server mutation despite a previously
  issued JWT.

### Required assertions

- `identity_clipper`
- `identity_agency_a`
- `identity_agency_b`
- `identity_admin`
- `cross_tenant_denied`
- `admin_modes_scoped`

## Step 9 — Clean-install, zero-fixture Cohort 0 proof

### Outcome

The exact locally packaged application can onboard a fresh Clipper and Agency
without dummy activity or manual database repair.

### Required run

1. Build the exact candidate artifact.
2. Record source SHA, package version, artifact SHA-256, OS, and architecture.
3. Remove the prior local installation and app state using the documented safe
   uninstall procedure.
4. Install the candidate package.
5. Sign in with a genuinely empty Cohort 0 identity.
6. Confirm every data surface is empty or instructional—never populated with
   fixture activity.
7. Complete the Clipper journey.
8. Restart and prove progress resumes.
9. Complete the Agency journey with a second clean identity.
10. Restart and prove progress resumes.
11. Confirm telemetry, PostHog, Sentry release context, HQ journey state, and
    authorization proof.
12. Uninstall/reinstall once more and prove server-owned state restores without
    local dummy data.

### Required assertions

- `fresh_install`
- `empty_account`
- `zero_fixture_rows`
- `clipper_journey`
- `agency_journey`
- `restart_resume`
- `uninstall_reinstall`
- `no_blocking_errors`

The evidence environment for this step must be `installed-desktop-local`.

## Post-Step-9 decision

Original text (kept for record): "Only Daniel can authorize a push/deploy/
tag after reviewing all eight receipts, the exact candidate artifact hash,
remaining non-blocking gaps, Cohort 0 screenshots and journey logs,
four-identity authorization evidence, and rollback instructions. Marketing
remains frozen until that explicit authorization."

**Superseded 2026-08-14** — see "Gate closure" at the top of this
document. Daniel gave that authorization (relayed through Victor), not
against the formal review packet listed above, but against the
already-live, already-operating product. The freeze this section
describes is lifted.
