# Scope notes · Layer 1 · Whop webhooks

## What changed (scope-in only, no drift)

- `app/models.py` · added `WebhookDeadLetter` class after `WebhookEventLog`
- `app/routes/webhooks_whop.py` · additions only, zero rewrites:
  - `_add_breadcrumb()` helper — no-op when `sentry_sdk` missing / not initialised
  - `_is_duplicate_event()` helper — extracts the existing outer guard into a
    named function so every mutating branch has an explicit contract statement
  - `_record_dead_letter()` helper — writes in a fresh `SessionLocal` session
    so the outer rollback can't take it with the failed transaction
  - `retry_dead_letter()` module-level entry point for operators / future cron
  - Sentry breadcrumbs at entry AND exit of every `_handle_*` handler:
    `_handle_membership_valid` · `_handle_membership_invalid` ·
    `_handle_membership_canceled` · `_handle_membership_cancel_setting_changed` ·
    `_handle_payment_failed` · `_handle_payment_succeeded` ·
    `_handle_payment_refunded`
  - Outer `whop_webhook` handler emits breadcrumbs at receive / duplicate /
    handled / failed transitions
  - Outer `except` writes a `WebhookDeadLetter` row before re-raising so
    Whop's own retry cadence still applies
  - `reconcile_whop_memberships()` — pure fn taking a `fetch_memberships`
    callable; diffs Whop's live view against local `User.paid_until` +
    `subscription_status`; returns a summary dict with drift_pct + severity
    (`ok` / `warn` / `alert`) and logs every drift row + a summary line
- `app/cron.py` · added `_whop_reconcile_tick()`, registered as a daily
  `04:00 UTC` cron job with id `whop_reconcile_nightly`. Skipped when
  `LC_WHOP_RECONCILE_ENABLED` env is not `true` — ships dormant.
- `tests/test_webhook_idempotency.py` · new file, 8 tests covering the 5
  master-doc assertions plus an above-5%-drift severity variant.
- `scripts/layer1_demo.py` · live proof harness that fires each code path
  against an in-memory SQLite so the receipt log lines are real, not staged.

## What did NOT change (scope-out honored)

- No webhook routing redesign · `_handle_*` bodies untouched apart from the
  breadcrumb entry/exit calls
- No changes to `set_affiliate_custom_commission`
- No new webhook event types
- No new npm/pip deps · `sentry_sdk` and `apscheduler` were already present

## What's deferred

- **Live Sentry screenshot** — requires staging deploy to a project with
  `SENTRY_DSN` set. Cannot capture from local dev without a real DSN. The
  test suite proves breadcrumbs fire via a `sentry_sdk` shim, and the demo
  harness dumps captured breadcrumbs verbatim.
- **Live Whop `/api/v1/memberships` call** — the cron fetcher wraps
  `whop_payments._client()`, which requires `WHOP_API_KEY`. Local test uses
  synthetic `fetch_memberships` list. First live run happens after Daniel
  flips `LC_WHOP_RECONCILE_ENABLED=true` on staging.
- **Prod deploy** — per Section 0.6, nothing pushes until Daniel signs off.

## Regression proof

Full backend suite: `261 passed, 3 warnings` (was 253 → +8 new tests).
Zero pre-existing tests broken.
