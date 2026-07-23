# Proposal · Install-count telemetry

**Owner:** Claude · **Approver:** Daniel · **Status:** DESIGN · not built yet
**Date:** 2026-07-22

## Question we're answering

"How many people downloaded the app?" — plus derived metrics (installs today · MAUs · install → activation funnel).

## Existing infrastructure (from repo scan)

| Wired now | Owning file |
|---|---|
| PostHog client + capture | `desktop-2/src/lib/posthog*` + `junior-backend/app/telemetry` |
| Sentry client | `desktop-2/src/lib/sentry*` |
| Railway telemetry ingest | `junior-backend/app/routes/telemetry.py` |
| `distinct_id` on first boot | already fired via PostHog default identify |
| `/me` returns authenticated user | `junior-backend/app/routes/me.py` |
| Users table with `created_at` per row | `junior-backend/app/models.py` User |

**Net:** we already have distinct-user counting via PostHog + a users-table `created_at` query on Railway. What's missing is a dashboard / view / endpoint to surface it.

## What to build

**Three deliverables:**

### A · `/admin/metrics/installs` endpoint (backend)

- **Path:** `GET /admin/metrics/installs?since=<iso8601>&window=<hour|day|week|month>`
- **Auth:** `x-internal-secret` header (matches existing admin routes)
- **Returns:** `{ total: number, series: [{ ts: iso, count: number }], mau: number, activation_rate: number }`
- **Source:** `SELECT date_trunc('day', created_at) as ts, count(*) FROM users WHERE created_at >= :since GROUP BY 1 ORDER BY 1`
- **Time:** ~30 min

### B · Frontend telemetry events (`install:*`)

Fire from `desktop-2/src/App.tsx` boot path:

- `install:first-boot` · once per install · localStorage flag `lc.first-boot.captured.v1`
- `install:activate` · fires on first successful `/me` response (already have this signal · re-emit as install:activate)
- `install:upgrade-installed` · fires on `runtime:activated` after pill click
- `install:daily-return` · once per calendar day · `lc.daily-return.YYYY-MM-DD`

Payload: `{ version, platform, lcId, tier, installedAt }`

**Time:** ~30 min

### C · HQ dashboard tile (accountapp)

New tile in HQ admin surface (`account-app/src/routes/admin/`) reading `/admin/metrics/installs`:

- Total installs
- Installs today / this week / this month
- 7-day trailing chart
- Activation rate (activated / installed)
- MAU number

**Time:** ~30 min

## Total scope

- ~90 min build (backend endpoint + frontend events + HQ tile)
- Uses existing PostHog + Sentry rails · no new SaaS
- Ships via runtime bundle (frontend events) + Railway deploy (backend endpoint) + Vercel deploy (HQ tile)

## Iron-gate

- IG-INSTALL-TELEMETRY-COVERAGE · lint every entry point that should fire an install:* event · vitest that `install:first-boot` is idempotent (only fires once) · backend pytest that the /admin/metrics/installs endpoint gate-checks internal secret

## What you get

- Real-time count of every download
- 7-day rolling install chart
- Activation funnel (installed → connected to Whop → first clip)
- All queryable from HQ Admin without touching PostHog directly

## Sources

- [PostHog vs Amplitude 2026 · established analytics rails](https://posthog.com/blog/posthog-vs-amplitude)
- [Best app analytics tools 2026](https://telemetrydeck.com/app-analytics-tools-you-should-know-about/)
