# MAX HANDOFF · Admin HQ · Install & revenue metrics (Path A)

**Handoff time:** 2026-07-08 15:35 BST  
**Requested by:** Daniel (live)  
**Estimated wall-clock:** 90–120 min  
**Priority:** ship today — Daniel wants visibility on installs / paid users / MRR from ONE place before the next friend install lands

---

## ABSOLUTE RULES — do not break

1. **Never echo, print, cat, or grep raw secret values.** Show first 4 chars + `…` if you must show anything. Never leak `WHOP_API_KEY`, `CLERK_SECRET_KEY`, `INTERNAL_API_SECRET`, `SENTRY_DSN`, JWT tokens, or session cookies.
2. **Never commit secrets.** `.env*` stays out of git. `~/.claude-credentials/` is the source of truth for local secrets — read from there, never copy into the repo.
3. **Never fake success.** Read `~/.claude/skills/completion-discipline/SKILL.md` before every "done / green / ready / live" claim. Every claim must name the exact artifact + environment + direct proof + regression proof + remaining gap.
4. **Fire `ship-lens-reviewer` before any completion claim.** It writes `docs/ship-lens-review.json` — verdict PASS is mandatory. See the script section below.
5. **Do NOT push, tag, or deploy.** Land locally, write receipt, STOP. Daniel greenlights push separately.
6. **Do NOT touch other in-flight work.** Two agents already committed:
   - v2.2.35 hardening bundle (env-assert, iCloud guard, updater breadcrumb, workflow_dispatch flip gate) — landed but not pushed
   - Sentry DSN plumbed to GitHub/Railway/Vercel/CI workflow env
   - Do NOT revert these. Do NOT bump the version. Do NOT touch `.github/workflows/`, `desktop-2/`, or `~/.claude-credentials/`.
7. **No async DB.** Backend uses sync SQLAlchemy 2.x. Do not import `asyncio` in backend routes.
8. **No new external services.** Everything you need is already wired — Clerk, Whop, backend DB.
9. **Match existing patterns.** Do NOT invent new UI components. Do NOT create new tabs. Extend the existing `OverviewTab` because it already auto-renders `counts.*` as big-number cards.
10. **Save receipts to `08_receipts/admin-hq-install-metrics-2026-07-08/`.**

---

## MISSION IN ONE PARAGRAPH

Daniel wants ONE view (the existing Admin HQ **Overview** tab) that answers "how many people installed / signed up / paid me / how much MRR." The backend endpoint `/admin/overview` already returns `counts.users_total`, `counts.users_today`, `counts.paid`, `counts.trialing`, `counts.free` — all of which the frontend already renders as big-number cards automatically (loose `Record<string, number>` type). Your job: add THREE new counts (`mrr_cents`, `signups_this_week`, `active_this_week`) to the same endpoint dict + teach the frontend renderer to format any key ending in `_cents` as USD dollars. That's the whole scope. No new tab. No new endpoint. No new file if you can help it.

---

## THE SCOPE MAP (all read, confirmed 2026-07-08)

### Backend files you'll touch

| File | Change |
|---|---|
| `junior-backend/app/routes/admin.py` (existing) | Extend `overview()` return dict at line 253–320 |
| `junior-backend/app/whop_payments.py` (existing) | ADD one helper `active_membership_count_and_mrr_cents()` at bottom of file — httpx client + WHOP_API_KEY, returns tuple `(count, mrr_cents)` |

### Frontend files you'll touch

| File | Change |
|---|---|
| `account-app/src/components/admin/AdminHQ.tsx` | Line 504–512: wrap the count value render in a formatter that outputs `$135` for keys ending `_cents` and passes through otherwise |

### Files you MUST NOT touch

- `.github/workflows/release-desktop-2.yml` — v2.2.35 agent's work
- `desktop-2/**` — v2.2.35 agent's work
- `desktop-2/required-env.json` — hardening scope
- `~/.claude-credentials/**` — read-only
- Any `08_receipts/beta-release-v2.2.34/` or `08_receipts/release-hardening-v2.2.35/` file

---

## STEP-BY-STEP EXECUTION

### Step 1 · Backend Whop MRR helper (~30 min)

Open `junior-backend/app/whop_payments.py`.

Verify at the top of the file: it already imports `httpx`, has `WHOP_API_KEY` env, and has `_v5_client()` at line 289. USE THAT CLIENT — do not create a new one.

Append at the end of the file:

```python
def active_membership_count_and_mrr_cents() -> tuple[int, int]:
    """Return (active_membership_count, mrr_cents) from Whop's memberships API.

    Reads WHOP_API_KEY from env. Returns (0, 0) gracefully if the key is
    missing or the API returns non-200. Never raises — the caller is
    /admin/overview and a Whop outage must not break the whole endpoint.

    MRR calculation: sum of renewal_price_usd across all active memberships,
    converted to cents. If a plan's billing_period is not 'monthly', it's
    normalized (yearly → /12, weekly → *4.33). Zero-price / gifted / lifetime
    memberships contribute zero MRR.
    """
    api_key = _api_key() if os.environ.get("WHOP_API_KEY") or os.environ.get("WHOP_APP_API_KEY") else ""
    if not api_key:
        return (0, 0)

    total_count = 0
    total_mrr_cents = 0
    try:
        with httpx.Client(
            base_url="https://api.whop.com/api/v2",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=8.0,
        ) as client:
            page = 1
            while True:
                r = client.get("/memberships", params={"status": "active", "page": page, "per": 50})
                if r.status_code != 200:
                    break
                body = r.json()
                data = body.get("data", []) if isinstance(body, dict) else []
                if not data:
                    break
                for m in data:
                    total_count += 1
                    plan = m.get("plan") or {}
                    renewal_price = float(plan.get("renewal_price") or 0)
                    if renewal_price <= 0:
                        continue
                    billing_period = (plan.get("billing_period") or "monthly").lower()
                    if billing_period == "yearly":
                        renewal_price = renewal_price / 12.0
                    elif billing_period == "weekly":
                        renewal_price = renewal_price * 4.33
                    elif billing_period == "one_time":
                        continue
                    total_mrr_cents += int(round(renewal_price * 100))
                pagination = body.get("pagination") or {}
                if page >= int(pagination.get("total_page", page)):
                    break
                page += 1
    except Exception:  # noqa: BLE001
        return (0, 0)

    return (total_count, total_mrr_cents)
```

**Guardrail:** notice `_api_key()` (line 78) is the existing key resolver — reuse it, do NOT re-read env vars.

### Step 2 · Extend /admin/overview endpoint (~20 min)

Open `junior-backend/app/routes/admin.py`. Find the `overview()` function at line 253. Around line 265 (near `now = _now()`), add:

```python
    week_ago = now - timedelta(days=7)
```

Find the `counts` dict (starts line 285) and add these three keys BEFORE the closing brace:

```python
    # Signups this week (from DB — mirrors Clerk via /webhooks/clerk).
    signups_this_week = db.query(User).filter(User.created_at >= week_ago).count()

    # Weekly active (User.last_seen_at populated by /sync). NULL last_seen_at
    # never counts — new signup who has never opened desktop is not active.
    active_this_week = db.query(User).filter(
        User.last_seen_at.is_not(None),
        User.last_seen_at >= week_ago,
    ).count()

    # Whop active membership count + MRR. Live API call — 0/0 on outage.
    from app import whop_payments
    whop_active_count, mrr_cents = whop_payments.active_membership_count_and_mrr_cents()
```

Then extend the `counts` dict literal to include:

```python
        "signups_this_week": signups_this_week,
        "active_this_week": active_this_week,
        "whop_active_memberships": whop_active_count,
        "mrr_cents": mrr_cents,
```

**Guardrail:** put these AT THE BOTTOM of the counts dict so the existing keys stay in the same visual order Daniel is used to.

**Also add** to the `notes` dict — an honesty line:

```python
            "whop_mrr": "Live Whop API · zero if WHOP_API_KEY missing or API down. Yearly plans normalized to monthly.",
```

### Step 3 · Frontend money formatter (~15 min)

Open `account-app/src/components/admin/AdminHQ.tsx`. Find OverviewTab at line 445. Find the counts render at line 504:

```tsx
            {Object.entries(data.counts).map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-paper p-4">
                <div className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{v}</div>
```

Change the `{v}` on line 506 to `{formatCountValue(k, v)}` and add this helper ABOVE the `function OverviewTab` declaration (near line 443):

```tsx
function formatCountValue(key: string, value: number): string {
  if (key.endsWith("_cents")) {
    const dollars = Math.round(value / 100);
    return `$${dollars.toLocaleString()}`;
  }
  return value.toLocaleString();
}
```

**Also** change the display key formatter — around line 508:

```tsx
                  {k.replace(/_/g, " ")}
```

Wrap it to strip the `_cents` suffix so the card reads "mrr" not "mrr cents":

```tsx
                  {k.replace(/_cents$/, "").replace(/_/g, " ")}
```

**Guardrail:** DO NOT change the InfoIcon hint or any other line. This is a 3-line surgical edit.

### Step 4 · Restart backend locally + smoke test (~10 min)

```bash
cd ~/code/jnr/junior-backend
.venv/bin/uvicorn app.main:app --reload --port 8000 &
sleep 3
INTERNAL=$(grep '^INTERNAL_API_SECRET=' ~/.claude-credentials/junior-internal.env | cut -d= -f2)
curl -s http://localhost:8000/admin/overview \
  -H "x-internal-secret: $INTERNAL" \
  -H "x-admin-email: danieldiyepriye@gmail.com" | jq '.counts'
```

Expected: JSON object with the new keys `signups_this_week`, `active_this_week`, `whop_active_memberships`, `mrr_cents`. **Do NOT echo the INTERNAL value** — the shell interpolation is fine, just don't print `$INTERNAL`.

Then verify the frontend still typechecks:

```bash
cd ~/code/jnr/account-app
pnpm tsc --noEmit 2>&1 | tail -10
```

Expected: `Found 0 errors.` or unchanged pre-existing error count.

### Step 5 · Fire ship-lens-reviewer (mandatory before "done")

Dispatch the `ship-lens-reviewer` agent on your diff:

```bash
cd ~/code/jnr
git diff --stat
```

Include your diff summary + these file:line citations in the reviewer prompt:
- `junior-backend/app/whop_payments.py` — new function `active_membership_count_and_mrr_cents` at EOF
- `junior-backend/app/routes/admin.py:265` — `week_ago` added
- `junior-backend/app/routes/admin.py:285+` — three new counts + one note
- `account-app/src/components/admin/AdminHQ.tsx:443` — `formatCountValue` helper
- `account-app/src/components/admin/AdminHQ.tsx:504-508` — render + label edit

Wait for `docs/ship-lens-review.json` to show verdict PASS. If P0 or P1 findings — fix them, re-run reviewer.

Then run the gate:

```bash
bash desktop/scripts/ship-gate.sh
```

Exit 0 required. Any non-zero → address findings + re-run.

### Step 6 · Write receipt

Create `08_receipts/admin-hq-install-metrics-2026-07-08/REPORT.md` with:

- Diff stat (`git diff --stat`)
- Direct proof: `curl /admin/overview | jq '.counts'` output showing the 4 new keys with real values (mask any actual DSN or API key in the output)
- Regression proof: `pnpm tsc --noEmit` clean
- Ship-lens review verdict (PATH: `docs/ship-lens-review.json`)
- Remaining gap: "Vercel account-app needs `vercel deploy --prod` for Daniel to see this in the deployed HQ — deferred to Daniel's explicit ship call."
- Rollback command: `git restore junior-backend/app/routes/admin.py junior-backend/app/whop_payments.py account-app/src/components/admin/AdminHQ.tsx`

### Step 7 · STOP. Do not push. Report back.

Return a summary block:

```
Admin HQ install-metrics — LANDED LOCALLY on /Users/dipdip/code/jnr.
NOT pushed. NOT deployed.

- 3 files touched (backend routes/admin.py + whop_payments.py + account-app AdminHQ.tsx)
- 0 new files
- /admin/overview counts now includes: signups_this_week, active_this_week, whop_active_memberships, mrr_cents
- Frontend auto-renders new keys as big-number cards
- Money keys (_cents) format as $X, dollars integer
- tsc clean, ship-lens PASS, gate exit 0
- Receipt: 08_receipts/admin-hq-install-metrics-2026-07-08/REPORT.md

Daniel next commands:
  cd ~/code/jnr && git add -A && git commit + git push origin master (backend)
  cd ~/code/jnr/junior-backend && railway up --service junior-backend --detach
  cd ~/code/jnr/account-app && vercel deploy --prod
```

---

## SHIP-LENS SCRIPT (copy verbatim, run at Step 5)

Save as `/tmp/ship-lens-install-metrics.sh` and run:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /Users/dipdip/code/jnr

echo "=== 1. Diff stat ==="
git diff --stat

echo
echo "=== 2. Files touched ==="
git diff --name-only

echo
echo "=== 3. TypeScript ==="
(cd account-app && pnpm tsc --noEmit 2>&1 | tail -3) || echo "TSC failed"

echo
echo "=== 4. Python compile check ==="
(cd junior-backend && .venv/bin/python -m py_compile app/routes/admin.py app/whop_payments.py) && echo "py_compile OK" || echo "py_compile FAILED"

echo
echo "=== 5. Backend smoke (assumes uvicorn already running on :8000) ==="
INTERNAL=$(grep '^INTERNAL_API_SECRET=' ~/.claude-credentials/junior-internal.env 2>/dev/null | cut -d= -f2)
if [ -z "$INTERNAL" ]; then
  echo "  SKIP: INTERNAL_API_SECRET not found in ~/.claude-credentials/junior-internal.env"
else
  curl -s -m 5 http://localhost:8000/admin/overview \
    -H "x-internal-secret: $INTERNAL" \
    -H "x-admin-email: danieldiyepriye@gmail.com" 2>&1 | jq '.counts | {users_total, paid, mrr_cents, signups_this_week, active_this_week, whop_active_memberships}' || echo "  local backend not running or endpoint missing"
fi

echo
echo "=== 6. Guard: no secrets in diff ==="
if git diff | grep -iE 'pk_live_|pk_test_|whsec_|Bearer eyJ|https://[^ ]*ingest.sentry.io' >/dev/null; then
  echo "  ✗ FAIL — potential secret in diff"
  exit 1
else
  echo "  ✓ no secret patterns detected in diff"
fi

echo
echo "=== 7. Guard: no version bump (v2.2.35 is in flight) ==="
if git diff desktop-2/package.json desktop-2/src-tauri/tauri.conf.json 2>/dev/null | grep -q '"version"'; then
  echo "  ✗ FAIL — do not bump desktop version"
  exit 1
else
  echo "  ✓ desktop version untouched"
fi

echo
echo "✓ Ship-lens gate GREEN"
```

---

## ROLLBACK PLAN (if v2.2.35 flip or Path A goes bad)

```bash
cd ~/code/jnr
git status                                    # confirm what's modified
git restore junior-backend/app/routes/admin.py \
             junior-backend/app/whop_payments.py \
             account-app/src/components/admin/AdminHQ.tsx
git status                                    # confirm clean

# If already deployed to Railway and MRR call is degrading /admin/overview:
cd ~/code/jnr/junior-backend
railway variable set "WHOP_API_KEY_DISABLE_ADMIN_OVERVIEW=1" --service junior-backend
# (Add a one-line guard in whop_payments.py:active_membership_count_and_mrr_cents
#  to check for that env var and return (0,0) — a v0 kill switch)
```

---

## COPY (Daniel's voice for any new UI text you must add)

If you MUST add UI copy (unlikely — the auto-render handles labels), use these voice rules from `~/.claude/memory/feedback_voice_no_bounty_use_skill.md`:

- Banned word: "bounty" · use "skill" / "clip job" / "paid post"
- Target reader: 19yo clipper
- Direct, money-aware, no corporate fluff
- No em-dashes in copy (Daniel's house style prefers spaces)

For number labels the current OverviewTab uses lowercase with underscores → spaces. Match that. Examples of good labels the new keys produce:
- `mrr` (was `mrr_cents`, `_cents` stripped)
- `whop active memberships`
- `signups this week`
- `active this week`

Do not rename these. The `_cents` stripping happens automatically via the label formatter.

---

## HANDOFF BACK

When done, land the diff locally + write `MAX_REPORT_ADMIN_HQ_INSTALL_METRICS_2026-07-08.md` at repo root with:

1. Files changed + LOC
2. All 4 new counts observed live via curl
3. Ship-lens verdict PASS + gate exit 0
4. tsc clean
5. Blockers (none expected — WHOP_API_KEY is already on Railway)
6. Next command Daniel types to ship

**Do not push. Do not deploy. Do not tag. Wait for Daniel's greenlight.**

Daniel is watching. Ship boring. No surprises.
