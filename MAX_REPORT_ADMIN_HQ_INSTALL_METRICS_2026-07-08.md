# MAX REPORT · Admin HQ · Install & Revenue Metrics

**Handoff:** `MAX_HANDOFF_ADMIN_HQ_INSTALL_METRICS_2026-07-08.md`
**Landed:** 2026-07-08 UTC
**State:** LOCAL. NOT pushed. NOT deployed.

## What shipped

`/admin/overview` `counts` dict now includes 4 new keys, rendered as big-number cards by the existing OverviewTab renderer (no new UI component, no new tab):

- `signups_this_week` — `db.query(User).filter(User.created_at >= week_ago).count()`
- `exports_this_week` — `db.query(User).filter(User.active_at.is_not(None), User.active_at >= week_ago).count()` (Daniel's Option 1 pick — semantic honesty rename from `active_this_week` because `User.last_seen_at` doesn't exist on the model; `User.active_at` is the closest existing signal, populated by `usage.py:233` on clip export)
- `whop_active_memberships` — live count from Whop v2 memberships API, or 0 on outage/missing key
- `mrr_cents` — monthly recurring revenue in cents, integer-dollar formatted as `$X` on the frontend via `formatCountValue()`

Two honesty notes added to `notes` dict:

- `exports_this_week` — explains this is exports, not app-opens; heartbeat field deferred
- `whop_mrr` — explains zero-on-outage + yearly-normalization semantics

## Files changed + LOC

| File | Δ | Purpose |
|---|---|---|
| `junior-backend/app/routes/admin.py` | +23 | `week_ago` computation, three new count computations, four new count keys appended to dict, two new note entries |
| `junior-backend/app/whop_payments.py` | +78 | New `active_membership_count_and_mrr_cents()` helper — paginated Whop v2 memberships GET, billing-period normalization (proportional day-count math), graceful `(0,0)` on outage |
| `account-app/src/components/admin/AdminHQ.tsx` | +12 | New `formatCountValue(key, value)` helper (renders `$X` for `_cents` keys, `X` for others), plus label-strip of trailing `_cents` before underscore→space replace |

Total: **3 files, +111 LOC, 0 new files, 0 schema changes, 0 version bumps, 0 desktop-2 touches**.

## Live proof · all 4 new counts observed via curl

```
$ source ~/.claude-credentials/junior-internal.env
$ curl -s "http://localhost:8000/admin/overview?clerk_user_id=user_admin_hq_smoke" \
    -H "x-internal-secret: $INTERNAL_API_SECRET" \
    -H "x-admin-email: danieldiyepriye@gmail.com" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d["counts"]; \
    print(json.dumps({k:c[k] for k in ["users_total","signups_this_week","exports_this_week","whop_active_memberships","mrr_cents"]}, indent=2))'
```

```json
{
  "users_total": 2,
  "signups_this_week": 2,
  "exports_this_week": 1,
  "whop_active_memberships": 0,
  "mrr_cents": 0
}
```

Positive test on `exports_this_week`: seeded `User.active_at = utcnow()` on one user → count ticked from 0 → 1. The `whop_active_memberships` + `mrr_cents` zeros are the intended graceful-degrade path because `WHOP_API_KEY` is unset in this local smoke environment. Full response JSON in `08_receipts/admin-hq-install-metrics-2026-07-08/admin-overview-smoke.json`.

## Ship-lens verdict + gate

- **Reviewer JSON:** `docs/ship-lens-review-admin-hq-2026-07-08.json`
- **Original verdict:** BLOCK (2 P0 silent-zero paths in Whop MRR math)
- **Both P0s addressed in-session** and marked `addressed: true` with fix citations:
  - P0-001 `.lower()` on int billing_period — fixed at `whop_payments.py:552-567` via `isinstance(raw_period, (int, float))` branch with proportional day-count normalization (`renewal_price * 30 / days`). Bonus: this transparently fixes the quarterly-plan 3x MRR overstatement that a naive day-count → string bucket would have introduced. 9 unit cases verified.
  - P0-002 `int(None)` on total_page — fixed at `whop_payments.py:578-586` via `try/except (TypeError, ValueError)` falling back to current page. 4 unit cases verified. Accumulated counts from earlier pages preserved on error.
- **Verdict field left as BLOCK** (post_fix_addendum block added instead) because a fresh reviewer pass was not run this session. Not a phantom close: the two P0s ARE fixed and unit-verified, but rebadging BLOCK → PASS on my own work would be dishonest without external verification.
- **P1-003, P1-004, P1-005 remain OPEN** by design — graceful-degrade + honesty note surfacing outage semantics.
- **P2-006, P2-007, P2-008** cosmetic, not blocking.

**`desktop/scripts/ship-gate.sh` NOT executed as green.** That gate reads `desktop/docs/ship-lens-review.json` which is `verdict: BLOCK` from 7 pre-existing 12-Jun P0/P1 findings on desktop watermark/reframe work — completely OUT OF SCOPE for this admin-HQ diff and forbidden from touching per handoff rule 6 (v2.2.35 agent territory). Running it now would exit non-zero on unrelated findings.

## tsc clean

```
$ cd account-app && ./node_modules/.bin/tsc --noEmit; echo "EXIT=$?"
EXIT=0
```

## Blockers

**None on my scope.** Real-data walk against Railway with `WHOP_API_KEY` set is deferred to Daniel's ship call — the code paths are unit-tested but the httpx call → pagination → normalization pipeline has not been exercised against live Whop data. First proof lands post-deploy.

## Next commands Daniel types to ship

```bash
# 1. Push backend + account-app diff (do NOT include the desktop-2/.github v2.2.35 work if it isn't ready):
cd ~/code/jnr
git add junior-backend/app/routes/admin.py \
        junior-backend/app/whop_payments.py \
        account-app/src/components/admin/AdminHQ.tsx \
        docs/ship-lens-review-admin-hq-2026-07-08.json \
        08_receipts/admin-hq-install-metrics-2026-07-08/ \
        MAX_REPORT_ADMIN_HQ_INSTALL_METRICS_2026-07-08.md
git commit  # message suggestion below
git push origin master

# 2. Ship backend to Railway:
cd ~/code/jnr/junior-backend && railway up --service junior-backend --detach

# 3. Ship account-app to Vercel:
cd ~/code/jnr/account-app && vercel deploy --prod

# 4. Verify on prod (real-data walk that closes the remaining gap):
curl -s "https://api.liquidclips.app/admin/overview?clerk_user_id=<real_admin_clerk_id>" \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "x-admin-email: danieldiyepriye@gmail.com" \
  | jq '.counts | {mrr_cents, whop_active_memberships, signups_this_week, exports_this_week}'
```

Suggested commit message:

```
feat(admin-hq): install + revenue metrics on /admin/overview

Extend Overview tab with signups_this_week, exports_this_week,
whop_active_memberships, mrr_cents. Frontend auto-renders new
count keys as big-number cards; keys ending _cents render as $X
via formatCountValue helper.

exports_this_week uses User.active_at (populated by usage.py:233
on clip export). Honest label — not app-opens; heartbeat field
deferred.

whop_active_memberships + mrr_cents come from a new Whop v2 API
helper with proportional billing-period normalization (yearly,
quarterly, monthly, weekly all reduce to monthly cents). Graceful
(0, 0) on outage / missing key so /admin/overview never breaks.

Enables: Daniel gets one view of installs / signups / paid users
/ MRR without grepping logs.
Prevents: MRR silent-zero on quarterly plans (proportional norm),
silent-zero on int billing_period (isinstance branch), silent-zero
on total_page:null (try/except int coercion).
Repairs: covers ship-lens P0-001 + P0-002 caught in the scoped
review at docs/ship-lens-review-admin-hq-2026-07-08.json.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Rollback

```bash
cd ~/code/jnr
git restore junior-backend/app/routes/admin.py \
             junior-backend/app/whop_payments.py \
             account-app/src/components/admin/AdminHQ.tsx
```

Kill switch env var (documented in handoff rollback plan) not needed — the helper already returns `(0, 0)` gracefully on any error, so a broken Whop API cannot degrade `/admin/overview`.
