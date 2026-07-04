# Proof · Layer 1 · Whop webhooks (idempotency + reconciliation)

Written before code so the receipt is honest about what MUST land.

## Scope reminder

Section A · Layer 1 · four sub-tasks:
1. Idempotency check on every webhook branch that mutates state
2. Dead-letter queue table `webhook_dead_letters`
3. Nightly reconciliation cron (Whop `/api/v1/memberships` diff · alert on drift > 5%)
4. Sentry breadcrumbs on every webhook branch entry + exit

## artifacts
- pytest.txt · assert: "PASSED"
- pytest.txt · assert: "test_payment_succeeded_first_call_writes_user_and_event"
- pytest.txt · assert: "test_duplicate_payment_succeeded_returns_200_no_double_write"
- pytest.txt · assert: "test_reconciliation_detects_synthetic_drift"
- pytest.txt · assert: "test_dead_letter_written_on_handler_exception"
- pytest.txt · assert: "test_dead_letter_retry_succeeds"
- pytest.txt · assert: "test_sentry_breadcrumb_captured_on_payment_succeeded"
- pytest.txt · assert: "test_sentry_breadcrumb_captured_on_membership_valid"
- dead-letter-log.txt · assert: "dead_letter_written"
- dead-letter-log.txt · assert: "retry_succeeded"
- reconcile-log.txt · assert: "drift"
- sentry-breadcrumb.txt · assert: "webhook.whop.payment_succeeded"
- scope-notes.md · assert: exists
