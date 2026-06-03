# Resend Audit — 2026-06-03

Complete inventory of every Resend send + every callsite + how each one is
deduped. Generated while wiring Resend across the remaining gaps the launch
audit surfaced.

## Summary

- **Total senders**: 26 (16 customer-facing + 4 admin alerts + 6 Minecraft Challenge funnel).
- **New senders this pass**: 10
  - 7 customer-facing: `send_schedule_failed`, `send_channel_disconnected`, `send_trial_ending_soon`, `send_affiliate_payout_enabled`, `send_payout_kyc_required`, `send_account_pack_added`, `send_bounty_rejected`
  - 3 admin: `send_admin_affiliate_milestone`, `send_admin_big_payout`, `send_admin_kyc_alert`
- **New callsites wired this pass**: 8
  - `send_bounty_approved` (was orphaned — now fires on PATCH submissions status=accepted)
  - `send_bounty_rejected` (PATCH submissions status=rejected, watermark gate excluded)
  - `send_schedule_failed` (cron `_fire_schedule` legacy-row fail path)
  - `send_channel_disconnected` (cron `_refresh_channel_status_tick` on active→error/pending_link)
  - `send_trial_ending_soon` (new cron `_trial_ending_soon_tick`, env-gated off)
  - `send_affiliate_payout_enabled` + `send_payout_kyc_required` (Stripe Connect webhook)
  - `send_admin_affiliate_milestone` (Whop payment_succeeded affiliate lifecycle)
  - `send_admin_big_payout` (PATCH submissions status=accepted, payout ≥ $50)
  - `send_admin_kyc_alert` (Stripe Connect webhook, mirrors `send_payout_kyc_required`)
- **Gap NOT fixed**: account-pack add-on confirmation is scaffolded only — Clerk's `subscriptionItem.updated` doesn't currently expose add-on quantity through `webhooks_clerk._handle_subscription_active`. Sender + template ready; wiring lives in a separate sprint that plumbs add-on parsing through.

---

## Callsite inventory

### Customer-facing senders

| Sender | Callsite | Tag | Dedup strategy |
| --- | --- | --- | --- |
| `send_welcome` | `webhooks_clerk._handle_user_created` | `welcome` | `WebhookEvent.external_id` (svix-id) — Clerk webhook idempotency layer; replays skip entirely. |
| `send_subscription_activated` | `webhooks_whop._handle_membership_valid` + `routes/onboarding.link_whop` + `routes/onboarding.redeem_claim` | `subscription_activated` | `WebhookEvent.external_id` for webhook path; pending-membership `consumed_at` for onboarding paths. |
| `send_subscription_canceled` | `webhooks_whop._handle_membership_invalid` + `webhooks_clerk._handle_subscription_canceled` | `subscription_canceled` | `WebhookEvent.external_id`. |
| `send_founder_welcome` | `webhooks_whop._handle_membership_valid` (founder branch) + onboarding (2 founder paths) | `founder_welcome` | `WebhookEvent.external_id` + `PendingWhopMembership.consumed_at`. |
| `send_license_activated` | `routes/desktop.connect` first-time path | `license_activated` | License row uniqueness — only fires when a fresh JWT is minted for a clerk user. |
| `send_bounty_approved` | `routes/submissions.update_submission_status` (status=accepted, NEW) | `bounty_approved` | PATCH route stamps prev_status before mutation; only the prev != accepted transition fires the email. |
| `send_bounty_rejected` | `routes/submissions.update_submission_status` (status=rejected, NEW) | `bounty_rejected` | Same prev_status guard + skip when `watermark_check.detected=true` so we don't double up with `send_mc_watermark_rejected`. |
| `send_affiliate_qualified` | `webhooks_whop._fire_affiliate_lifecycle_emails` | `affiliate_qualified` | `Notification.external_dedup_key = affiliate-qualified-<user_id>` — write returns None on retry. |
| `send_first_paid_referral` | `webhooks_whop._fire_affiliate_lifecycle_emails` | `first_paid_referral` | `Notification.external_dedup_key = first-paid-referral-<user_id>`. |
| `send_whop_claim_link` | `routes/onboarding.claim_whop` + `routes/admin.resend_claim` | `whop_claim` | `WhopClaimToken.token` rate-limited to `CLAIM_MAX_PER_HOUR` per email/user. |
| `send_schedule_failed` (NEW) | `cron._fire_schedule` legacy-row fail branch | `schedule_failed` | `Notification.external_dedup_key = sched-failed-<schedule_id>` — only mails the first time the row enters failed state. |
| `send_channel_disconnected` (NEW) | `cron._refresh_channel_status_tick` on active→error or active→pending_link transition | `channel_disconnected` | `Notification.external_dedup_key = channel-disconnected-<channel_id>-<yyyy-mm-dd>` — max one mail per UTC day per channel. |
| `send_trial_ending_soon` (NEW, gated off) | `cron._trial_ending_soon_tick` | `trial_ending_soon` | `Notification.external_dedup_key = trial-ending-<user_id>-<days_left>` + env gate `JUNIOR_ENABLE_TRIAL_REMINDERS=1`. |
| `send_affiliate_payout_enabled` (NEW) | `routes/webhooks_stripe.stripe_connect_webhook` on `payouts_enabled: false→true` | `affiliate_payout_enabled` | `Notification.external_dedup_key = stripe-payouts-enabled-<user_id>` — one per user, ever. |
| `send_payout_kyc_required` (NEW) | `routes/webhooks_stripe.stripe_connect_webhook` on `status=restricted` AND `requirements.currently_due` non-empty | `payout_kyc_required` | `Notification.external_dedup_key = stripe-kyc-required-<user_id>-<yyyy-mm-dd>` — one nudge per UTC day. |
| `send_account_pack_added` (NEW, scaffold) | none today; waiting on Clerk webhook plumbing | `account_pack_added` | Caller will use `Notification.external_dedup_key = pack-added-<user_id>-<new_total>`. |

### Minecraft Story Clip Challenge funnel (sprint #14c — pre-existing)

| Sender | Callsite | Tag |
| --- | --- | --- |
| `send_mc_challenge_join` | `routes/minecraft_challenge` join endpoint | `mc_challenge_join` |
| `send_mc_first_export` | `routes/submissions.create_submission` (first per-campaign submission) | `mc_first_export` |
| `send_mc_watermark_rejected` | `routes/submissions.create_submission` (watermark detector rejects) | `mc_watermark_rejected` |
| `send_mc_upgrade_confirmed` | `routes/minecraft_challenge` upgrade-confirmed path | `mc_upgrade_confirmed` |
| `send_mc_first_acceptance` | `routes/submissions.update_submission_status` (status=accepted, prior_accepted=0) | `mc_first_acceptance` |
| `send_mc_leaderboard_placement` | `routes/leaderboard` placement cron | `mc_leaderboard_placement` |

### Admin alerts (recipients = `settings.admin_emails` CSV)

| Sender | Callsite | Tag | Dedup strategy |
| --- | --- | --- | --- |
| `send_admin_paid_customer_alert` | `webhooks_whop._handle_membership_valid` + `webhooks_whop._handle_payment_succeeded` + 2× `routes/onboarding` founder paths | `admin_paid_customer` | Caller is inside a `WebhookEvent.external_id` idempotency gate. |
| `send_admin_affiliate_milestone` (NEW) | `webhooks_whop._fire_affiliate_lifecycle_emails` | `admin_affiliate_milestone` | Fired inside the dedup-keyed Notification branch — cannot double-fire. |
| `send_admin_big_payout` (NEW) | `routes/submissions.update_submission_status` (status=accepted, payout_usd_cents ≥ 5000) | `admin_big_payout` | Same prev_status transition guard as `send_bounty_approved`. |
| `send_admin_kyc_alert` (NEW) | `routes/webhooks_stripe.stripe_connect_webhook` (restricted + currently_due) | `admin_kyc_alert` | Fired inside the same `Notification.external_dedup_key = stripe-kyc-required-<user_id>-<yyyy-mm-dd>` branch as the user-facing nudge. |

---

## Manual test recipes

### 1. `send_schedule_failed`

Insert a legacy row that the cron can mark failed:

```sh
sqlite3 junior-backend.db "INSERT INTO schedules
  (id, user_id, project_slug, clip_idx, clip_title, vertical_path,
   platform, scheduled_for, status, retry_count, created_at, updated_at)
  VALUES ('sched_test_001','<user_id>','test-proj',0,'Test clip','/tmp/x.mp4',
          'youtube', datetime('now','-1 hour'), 'pending', 0,
          datetime('now'), datetime('now'));"
```

Within 60s, the cron flips it to `failed` and mails the owner.

### 2. `send_channel_disconnected`

Force a healthy channel into an Ayrshare 401 response, then trigger the
refresh tick:

```sh
sqlite3 junior-backend.db "UPDATE social_channels SET ayrshare_profile_key='deliberately_broken_key', last_refreshed_at=NULL WHERE id='<channel_id>';"
```

Wait for the 6 h refresh tick, or call the route directly:

```sh
curl -X POST http://localhost:8000/channels/<channel_id>/refresh \
  -H "authorization: Bearer $JWT"
```

Side-effect emails fire via the cron path only (the manual refresh route
doesn't pipe through the disconnect detector — by design, so single-user
clicks don't mass-mail).

### 3. `send_trial_ending_soon`

Enable the cron, then plant a row with paid_until 3 days out:

```sh
export JUNIOR_ENABLE_TRIAL_REMINDERS=1

sqlite3 junior-backend.db "UPDATE users SET subscription_status='trialing',
  tier='solo',
  paid_until=datetime('now','+3 days')
  WHERE email='you@example.com';"
```

Tick fires daily; trigger immediately by restarting uvicorn (the
`add_job(interval=86400)` runs on first scheduler tick).

### 4. `send_affiliate_payout_enabled`

Forge a Stripe Connect `account.updated` webhook locally:

```sh
curl -X POST http://localhost:8000/webhooks/stripe-connect \
  -H "content-type: application/json" \
  -d '{
    "id": "evt_test_payouts_on",
    "type": "account.updated",
    "data": {"object": {
      "id": "<connect_account_id_in_db>",
      "payouts_enabled": true,
      "charges_enabled": true,
      "details_submitted": true,
      "requirements": {"currently_due": []}
    }}
  }'
```

`STRIPE_CONNECT_WEBHOOK_SECRET` empty in dev = signature check skipped.

### 5. `send_payout_kyc_required` + `send_admin_kyc_alert`

```sh
curl -X POST http://localhost:8000/webhooks/stripe-connect \
  -H "content-type: application/json" \
  -d '{
    "id": "evt_test_kyc_due",
    "type": "account.updated",
    "data": {"object": {
      "id": "<connect_account_id_in_db>",
      "payouts_enabled": false,
      "charges_enabled": false,
      "details_submitted": true,
      "requirements": {"currently_due": ["individual.dob.day", "individual.id_number"]}
    }}
  }'
```

### 6. `send_bounty_approved` + `send_bounty_rejected` + `send_admin_big_payout`

Have an admin user (per `is_admin_email`) flip a submission:

```sh
# Approve (also fires admin big-payout if payout >= $50)
curl -X PATCH http://localhost:8000/submissions/<submission_id>/status \
  -H "authorization: Bearer $ADMIN_JWT" \
  -H "content-type: application/json" \
  -d '{"status":"accepted"}'

# Reject (mod-side — distinct from auto watermark gate)
curl -X PATCH http://localhost:8000/submissions/<submission_id>/status \
  -H "authorization: Bearer $ADMIN_JWT" \
  -H "content-type: application/json" \
  -d '{"status":"rejected","rejection_reason":"Clip cuts off before the hook lands."}'
```

To exercise the big-payout admin alert, pre-set `payout_usd_cents`:

```sh
sqlite3 junior-backend.db "UPDATE campaign_submissions SET payout_usd_cents=7500 WHERE id='<submission_id>';"
```

### 7. `send_admin_affiliate_milestone`

The lifecycle path lives inside Whop's `payment_succeeded` handler — it
fires when the buyer's first-ever paid invoice resolves AND their
`affiliate_id` points at a known Junior referrer with a cached
`whop_affiliate_id`. Easiest path is to seed the referrer + buyer state
then post a synthetic `payment_succeeded`:

```sh
sqlite3 junior-backend.db "
  UPDATE users SET whop_affiliate_id='aff_referrer_123' WHERE email='referrer@example.com';
  UPDATE users SET affiliate_id='aff_referrer_123', subscription_status='trialing' WHERE email='buyer@example.com';
"

curl -X POST http://localhost:8000/webhooks/whop \
  -H "content-type: application/json" \
  -d '{
    "id": "evt_test_pay_001",
    "event": "payment_succeeded",
    "data": {
      "id": "pay_test",
      "user": {"email": "buyer@example.com"},
      "renewal_period_end": null
    }
  }'
```

---

## Idempotency at a glance

| Layer | Mechanism | Used for |
| --- | --- | --- |
| Webhook envelope | `WebhookEvent.external_id` unique | Replays/retries of the same Whop/Clerk/Stripe payload skip processing entirely. |
| Notification rows | `Notification.external_dedup_key` unique | All cron-fired emails + affiliate lifecycle + KYC nudges — `write_notification` returns None on collision. |
| Per-row status | Tracked in `Schedule.status`, `CampaignSubmission.status`, `SocialChannel.status`, `User.stripe_connect_*` | PATCH/webhook handlers compare prev vs new before firing the side-effect email. |
| Pending Whop membership | `PendingWhopMembership.consumed_at` | Founder/Whop activation paths through `/onboarding/link-whop` mail at most once per pending row. |
| Env gate | `JUNIOR_ENABLE_TRIAL_REMINDERS` | The trial-ending cron is wired but disabled until Whop's trial-state UI ships. |

---

## Gap NOT fixed this pass (with reason)

- **Account-pack add-on confirmation email** — `send_account_pack_added` and
  `render_account_pack_added` exist with the right shape, but `webhooks_clerk
  ._handle_subscription_active` doesn't parse `data.items[].plan.add_ons[]`
  (or the Clerk equivalent) today, so there's no event to wire it to.
  Adding parsing is out of scope for this audit (touches the billing
  schema reconciliation in a way the prompt explicitly carved out:
  "Don't touch `app/main.py` lifespan — schema migrations are someone
  else's responsibility this session"). The sender is left in place so
  the next sprint that plumbs add-on parsing through can wire it with a
  one-line call.

- **`send_channel_disconnected` from the manual `/channels/{id}/refresh`
  endpoint** — deliberately routed only through the 6 h cron path.
  Triggering on every user-click of "Refresh" would mass-mail any user
  whose channel is just temporarily wonky; the cron's 6 h cadence + the
  per-UTC-day dedup key gives a much cleaner signal of "this is broken,
  not a flake."

- **`send_admin_big_payout` threshold tuning** — hard-coded at $50.00
  (5000 cents) inside `routes/submissions.py`. A config-driven threshold
  is overkill at v1 RPM scale; bumping it is a one-line edit when the
  Minecraft Challenge starts paying real money.
