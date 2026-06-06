# probe_tiktok.py — TikTok channel-link diagnostic

End-to-end probe for a user's TikTok `SocialChannel`: cross-checks the DB row, a live Ayrshare `GET /user`, the `_fetch_handle_from_ayrshare` helper that `/channels/<id>/refresh` calls, and recent Ayrshare `WebhookEvent` rows. Prints every discrepancy + one recommended action — ground truth in one command instead of three SQL queries plus curl.

## Run (from `junior-backend/`)

```bash
source ~/.claude-credentials/clerk.env   # or whatever sets AYRSHARE_API_KEY + DATABASE_URL
python3 scripts/probe_tiktok.py --user-email danieldiyepriye@gmail.com
# alt resolvers: --clerk-id user_xxx   |   --channel-id <social_channels.id>
# flags: --json (machine-readable)   --webhook-window 25 (longer tail)
```

## Example output (truncated)

```
── DB · SocialChannel ────────────
  status            : pending_link
  last_refreshed_at : 2026-06-06 09:11:02Z (47.3m ago)
── Ayrshare · GET /user ──────────
  HTTP 200 OK  ·  tiktok linked: yes  ·  handle: @daniel.diy
── Discrepancies ─────────────────
  ! Ayrshare HAS TikTok linked but DB says status='pending_link'.
── Recommended action ────────────
  → POST /channels/<id>/refresh — link succeeded, DB never caught up.
```

## When to run + diagnostic flow

Run after a user reports "TikTok still failing", or a Schedule v2 row sticks in `error`/`failed` with a TikTok-shaped reason. Flow: run probe → read Discrepancies → apply Recommended action → re-run. Exit 0 + no discrepancies = closed.
