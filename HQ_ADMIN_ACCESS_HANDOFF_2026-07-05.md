# HQ · Admin surface access + top-to-bottom Railway dashboard wire (2026-07-05)

**From:** Claude Me (CM lane · app-side)
**For:** HQ · Railway HQ dashboard owner
**Type:** Handoff — you own the top-to-bottom business view from here on

---

## The ask

Daniel wants the HQ Railway dashboard to render the **entire business top-to-bottom** by pulling data from the desktop app's Admin HQ surface (already live at `account.liquidclips.app/admin`).

Two access paths for you, use both:

1. **Direct login** to `account.liquidclips.app/admin` — for you to explore, edit config, review state visually
2. **Server-to-server API** — for your HQ dashboard on Railway to render its own top-to-bottom view without a browser

---

## What the admin surface is

The Admin HQ page at `account.liquidclips.app/admin` currently exposes **33 live tabs** that cover the whole business:

**Top-level orientation tabs:**
- **System Map** — hand-authored SVG flow chart of every pipe in the growth engine · 33 nodes · live health probes every 30s · red/yellow/green/gray coloured by probe state
- **Journey Map** — 80-customer-journey table across 4 clusters (identity+access · clip pipeline · distribution+money · agency+community+billing) · filterable by wired / demo / missing / Cohort 0 blockers · grep-able citations per row · pink "Waiting on Daniel" strip

**Live-data tabs (populated):**
- Overview · Revenue · Users · Alerts · Function Heat Map · Surfaces · Pending Whop · Claims · Employees · Agents · APIs/Tools · Customers · Reports · Costs/Runway

**Empty-but-honest tabs (backend endpoints work, no data yet):**
- Iron Gates · Releases · Inbox · Bonus Ledger

**Live-integration tabs (populated when the backend has rows):**
- Webhooks · Postiz · Ayrshare (DEPRECATED — pulling this soon) · Community Channels · Missions · Banners · Announcements · Telemetry · Bugs · Launch Health · Usage · Billing · Promo Codes

Everything routes through the Next.js proxy at `account-app/src/app/api/admin/[...path]/route.ts` which forwards to `api.liquidclips.app/admin/*` with `x-internal-secret`. Read paths are on lines 39-80 of that file (33 whitelisted); write paths on lines 81-103 (21 whitelisted).

---

## Path 1 · Direct login (for you to explore + edit)

The admin gate is a **Clerk email allowlist** on the desktop backend. To add HQ team members:

1. Log into Railway → `junior-backend` service → Variables tab
2. Find `JUNIOR_ADMIN_EMAILS` (comma-separated list)
3. Append your HQ team members' emails
4. Save · Railway auto-redeploys · they can now visit `account.liquidclips.app/admin` after signing in with Clerk

Alternatively — the admin allowlist logic is in `junior-backend/app/features.py` if you want a proper `admin_allowlist` DB table instead of an env var (documented gap in EmployeesTab · v0 uses the env var).

**No change to the desktop app is needed for this path** — HQ just uses the browser UI.

---

## Path 2 · Server-to-server API (for your Railway dashboard to render its own view)

The backend endpoints at `api.liquidclips.app/admin/*` accept an internal secret and return JSON. Your Railway HQ dashboard can call these directly and render however you want.

### Auth pattern

Every call carries the header:
```
x-internal-secret: <INTERNAL_API_SECRET value>
```

You already have this secret if you deploy to the same Railway project (it's shared env). If not: Daniel can add HQ's Railway app to the same secret vault, or issue a scoped HQ-only secret if you want isolation.

### Endpoints you probably want first

**Whole-business one-shot:**
```
GET https://api.liquidclips.app/admin/overview
```
Returns paying users · MRR · trial count · churn · install count · welcome-email counts · signup source breakdown · etc. (~30 metrics). This alone probably drives 80% of your dashboard.

**Growth engine funnel:**
```
GET https://api.liquidclips.app/admin/revenue/summary
GET https://api.liquidclips.app/admin/revenue/blockers
GET https://api.liquidclips.app/admin/customer-signals
```
Funnel state · revenue-blocked users · signals to act on.

**Compute + spend:**
```
GET https://api.liquidclips.app/admin/agents          # per-agent monthly spend ceilings
GET https://api.liquidclips.app/admin/api-services    # per-vendor spend + config gates
GET https://api.liquidclips.app/admin/function-heatmap # config-gate health score
```

**People + tickets:**
```
GET https://api.liquidclips.app/admin/employees
GET https://api.liquidclips.app/admin/users
GET https://api.liquidclips.app/admin/customer-signals
GET https://api.liquidclips.app/admin/bug-intake
GET https://api.liquidclips.app/admin/agent-reports
```

**Growth engine specifics (for Peer Inbox + Deployer Surface once you build them):**
```
GET https://api.liquidclips.app/admin/inbox           # empty for now — the Peer Inbox surface will feed this
GET https://api.liquidclips.app/admin/alerts
GET https://api.liquidclips.app/admin/webhooks
```

Full read + write path list in `account-app/src/app/api/admin/[...path]/route.ts` (lines 39-103).

### Response shape

Every endpoint returns:
```json
{
  "generated_at": "2026-07-05T22:30:00Z",
  "note": "<backend-shipped honesty note explaining data scope + gaps>",
  "rows": [ ... ]
}
```

The `note` field is important — it explains data-shape assumptions + known gaps. Surface it in the HQ dashboard so nobody's misled by an empty table.

---

## The unbuilt nodes on the SystemMap · who owns what

You're going to see gray nodes on the SystemMap flow chart. Here's what's actually going on:

| Node | Actual state | Owner | What to do |
|---|---|---|---|
| **F4 Deployer Surface** | genuinely unbuilt · in-app first-run gate that blocks workspace until user runs scan + broadcast | app-side (CM lane) | Sprint 2 UI work · scoped after Cohort 0 lands |
| **F5 Contact Scan** | ✅ SHIPPED 2026-07-04 (Layer 2 · commit `1ae0ad2`) · Gmail OAuth + YT cross-ref | app-side | **Data fix:** SystemMap node needs a `probeUrl`. Currently gray because the config file was written before the ship. Someone should PATCH the node in `account-app/src/components/admin/SystemMapTab.tsx` |
| **User's Network** | backend feed ✅ live, ⏳ F4 UI pending Layer 5 | app-side (Layer 5) | Depends on F4 Deployer Surface build |
| **F6 Broadcast Engine** | ✅ SHIPPED 2026-07-04 (Layer 3 · commit `5a3bf05`) · DOM automation + persistent cookies | app-side | **Data fix:** SystemMap node needs a `probeUrl`. Same as F5 above |
| **Peer Inbox** | genuinely unbuilt · landing page + reply tracker for incoming warm-peer conversations | **HQ** | This is yours. Landing at `liquidclips.app/inbox` (or similar) · aggregates replies to the Broadcast Engine sends · shows cohort 0 engagement metrics. Suggest scoping this as an HQ sprint since the data lives in HQ's Gmail relay anyway |

If HQ wants to own the SystemMap probeUrl fix + Peer Inbox build, drop a PASTE_BACK in the same Dropbox folder and I'll wire it into `account-app` from your end.

---

## Suggested Railway HQ dashboard structure

Since you're rendering top-to-bottom, one layout that works:

```
┌────────────────────────────────────────────────────────────┐
│  TOP LINE (from /admin/overview)                           │
│  MRR · Paying · Trials · Installs · Churn 30d              │
├────────────────────────────────────────────────────────────┤
│  GROWTH FUNNEL                                             │
│  Cold sends → clicks → installs → paying                   │
│  (Instantly count · click-through rate · install count     │
│   from /admin/overview · paying from /admin/revenue)       │
├────────────────────────────────────────────────────────────┤
│  ACTIVE USER SIGNALS (from /admin/customer-signals)        │
│  Who's stuck · who needs a nudge · who's about to churn    │
├────────────────────────────────────────────────────────────┤
│  SYSTEM HEALTH (from /admin/function-heatmap)              │
│  Which config gates are broken · score 0-100               │
├────────────────────────────────────────────────────────────┤
│  SPEND (from /admin/agents + /admin/api-services)          │
│  Monthly burn by vendor · monthly by agent                 │
├────────────────────────────────────────────────────────────┤
│  BUG INTAKE + AGENT REPORTS                                │
│  Live bug queue · recent agent work                        │
└────────────────────────────────────────────────────────────┘
```

Every row is one API call. Polling every 30s matches the browser Admin HQ's cadence.

---

## What we need from you

1. **Confirm the access path** you want (login only · API only · both)
2. **Identify which HQ team emails** to add to `JUNIOR_ADMIN_EMAILS` (if login path)
3. **Decide on Peer Inbox ownership** — HQ builds it, or CM lane builds it under your spec
4. **Ping back the SystemMap probeUrl fix** for F5 + F6 if you want to own that data patch

Reply in a `PASTE_BACK_ADMIN_ACCESS.md` in this folder or ping Daniel directly.

---

## Ownership summary

- **CM lane owns:** the desktop app surface · Journey Map data · admin proxy config
- **HQ owns:** top-to-bottom Railway dashboard rendering the API · Peer Inbox surface · cold-email pipeline (F1-F3 · Instantly · preview MP4 rendering per the cold-email-pipeline-spec.md)
- **Shared:** the SystemMap flow chart (either can edit) · JOURNEY_MAP data (either can add rows as new surfaces ship)

Thanks — this closes the loop on the "one place to see the whole business" gap Daniel called out.

— CM lane
