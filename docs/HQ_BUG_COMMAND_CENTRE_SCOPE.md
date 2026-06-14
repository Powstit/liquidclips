# Liquid Clips HQ — Daniel’s Solo-Dev Operating System

**Status:** v0.1 scope + static UI foundation.  
**Goal:** Manage the people, agents, APIs, bugs, costs, releases, and revenue-blocking issues required to run Liquid Clips toward $30k MRR.

**Main principle:**  
`Only manage what protects install, activation, payment, retention, trust, or $30k MRR.`

---

## 1. Where HQ lives

HQ lives in the **account-app** Next.js project:

- Admin page: `/Users/dipdip/code/jnr/account-app/src/app/admin/page.tsx`
- Main component: `/Users/dipdip/code/jnr/account-app/src/components/admin/AdminHQ.tsx`
- New HQ tabs: `/Users/dipdip/code/jnr/account-app/src/components/admin/HQCommandTabs.tsx`
- Proxy route: `/Users/dipdip/code/jnr/account-app/src/app/api/admin/[...path]/route.ts`
- Scope doc: `/Users/dipdip/code/jnr/docs/HQ_BUG_COMMAND_CENTRE_SCOPE.md`

The public URL is `https://account.liquidclips.app/admin` (Clerk auth + admin allow-list gated).

---

## 2. What exists today

The existing HQ is a read-only control surface with tabs for:

- Overview (config + counts)
- Launch Health (release gates)
- Function Heat Map (Railway cron checks)
- Alerts (operator inbox)
- Users / Usage / Billing
- Pending Whop / Claims / Webhooks
- Postiz status
- Desktop error telemetry (renamed to **Telemetry**)
- Bonus Ledger, Community Channels, Missions, Banners, Announcements

Auth is enforced in three layers:

1. `admin/page.tsx` server component (Clerk + admin email list).
2. `api/admin/[...path]/route.ts` proxy (re-checks admin + injects internal secret).
3. `junior-backend/app/routes/admin.py` `require_admin` dependency.

No secrets reach the browser.

---

## 3. What was added in v0.1

HQ navigation is now organised as:

1. **Overview**
2. **Revenue** — daily, weekly, monthly, MRR target, revenue blockers
3. **Bugs** — Agent Bug Lanes / bug source of truth
4. **Iron Gates** — section commit readiness
5. **Agents** — Kimi, Claude, OpenAI/Codex workforce
6. **Employees** — humans who can help
7. **APIs / Tools** — paid APIs, SaaS, dependencies
8. **Releases** — version/build status
9. **Customers** — conversion signals
10. **Reports** — latest agent + revenue signals
11. **Inbox** — lightweight user-to-HQ support board
12. Existing admin tabs: Launch Health, Function Heat Map, Alerts, Users, Pending Whop, Claims, Webhooks, Usage, Billing, Postiz, Telemetry, Bonus Ledger, Community Channels, Missions, Banners, Announcements

All new tabs are **static/mock-data** for v0.1. No new backend tables, no real payment wiring, no desktop changes.

---

## 4. Tabs in detail

### 4.1 Revenue

Purpose: know whether the app can support Daniel’s life and growth.

#### Revenue Overview cards

- Today’s revenue
- This week’s revenue
- This month’s revenue
- Current MRR
- Paid users
- Free users
- Conversion rate
- Churn (placeholder if not available)
- Gap to $30k MRR
- Paid users needed at $29.99

#### Daily Revenue fields

| Field | Type |
|-------|------|
| date | string |
| new subscriptions | number |
| upgrades | number |
| cancellations | number |
| gross revenue | cents |
| refunds | cents |
| net revenue | cents |
| notes | string |

#### Weekly Revenue fields

| Field | Type |
|-------|------|
| week starting | string |
| new paid users | number |
| churned users | number |
| net user growth | number |
| gross revenue | cents |
| net revenue | cents |
| top conversion blocker | string |
| top bug/revenue issue | string |

#### Monthly Revenue fields

| Field | Type |
|-------|------|
| month | string |
| MRR | cents |
| paid users | number |
| free users | number |
| churn | percent |
| gross revenue | cents |
| tool/API costs | cents |
| agent costs | cents |
| infra costs | cents |
| net cash | cents |
| gap to target | cents |

#### Revenue Blockers

Blockers are bugs that directly stop money:

- payment blocked
- paid access blocked
- Reactivate/session bug
- checkout return broken
- Projects locked for paid/admin
- Earn cannot start/resume
- export blocked

Each blocker shows: section, severity, assigned agent, status, estimated revenue damage, latest report.

#### $30k MRR target model

- Target MRR: `$30,000`
- Price per paid user: `$29.99`
- Paid users needed for target: `ceil((30,000 - currentMRR) / 29.99)`
- Progress bar: `(currentMRR / 30,000) * 100`

All revenue numbers are mock/static for v0.1.

---

### 4.2 Bugs (Agent Bug Lanes)

Bugs tab is the source of truth for revenue-blocking issues.

Bug fields:

- id
- title
- description
- source: user / app / agent / system
- section: Auth / Projects / Earn / D1 / UI / Backend / Release
- severity (revenue-first)
- app version
- status: new / assigned / fixing / ready for review / passed / failed / parked
- lane
- assigned agent
- screenshots/logs links
- Iron Gate checklist link
- latest agent report
- Daniel approval required

Severity rules:

| Severity | Meaning |
|----------|---------|
| P0 — stops payment | User cannot complete a purchase / upgrade. |
| P0 — stops paid access | Paid user cannot use something they paid for. |
| P0 — stops first action | New install / activation / first launch is blocked. |
| P1 — trust loss | User sees wrong state, dead link, or broken promise. |
| P1 — retention blocker | Existing paid user cannot continue their workflow. |
| P2 — polish | Visual/UX issue that does not block money or trust. |

Agent lanes:

1. Auth / Account / Upgrade
2. Projects Manager
3. Earn Workflow
4. Upgrade + Self-Onboarding
5. UI Polish
6. Backend
7. Release / QA

Each lane shows: name, owner, status, P0/P1/P2 counts, active bug count, API-key configured state, linked Iron Gate section, allowed files, forbidden files.

---

### 4.3 Iron Gates

Purpose: track whether each section can be committed.

Sections:

- Auth / Account / Upgrade
- Projects Manager
- Earn Workflow
- Upgrade + Self-Onboarding
- UI Polish
- Backend
- Release / QA

Fields:

- section name
- status: not started / in progress / waiting hand-walk / passed / failed
- owner
- last build version
- last installed version
- hand-walk passed? yes/no
- blocker count
- commit allowed? yes/no
- latest report link

Commit is allowed only when status is `passed`, hand-walk is passed, and blockers are zero.

---

### 4.4 Agents

Purpose: manage Kimi, Claude, Codex/OpenAI, and future automated agents.

Fields:

- agent name
- provider: Kimi / Claude / OpenAI / other
- assigned lane
- status: idle / active / blocked / disabled
- API key configured: yes/no only
- monthly budget
- usage cost this month
- last task
- last report
- allowed files
- forbidden files
- Iron Gate section
- approval required: true/false

UI includes agent lane cards, agent table, API-key status, monthly cost/budget display, and last-report panel.

Security rule: API keys show **Configured / Missing** only.

---

### 4.5 Employees

Purpose: manage humans who can help with support, dev, ops, design, or partnerships.

Fields:

- name
- email
- role
- section/lane
- permission level
- status: active / invited / paused / removed
- monthly cost
- hourly rate if applicable
- notes
- start date
- last active
- emergency contact? yes/no
- can access HQ? yes/no

Security rule: do not invite automatically yet. Store/prepare the model only. No email sending unless explicitly approved later.

---

### 4.6 APIs / Tools

Purpose: track every paid API, SaaS, backend dependency, and monthly cost.

Fields:

- service name
- category: AI / infra / auth / payments / email / analytics / video / hosting / storage / other
- owner
- env var name
- key configured: yes/no
- monthly cost
- usage-based? yes/no
- current month spend
- renewal date
- criticality: P0 / P1 / P2
- used by which app: desktop / account-app / backend / partner-app / HQ
- notes
- cancel risk: keep / review / cancel

Example services tracked:

- OpenAI
- Kimi
- Claude
- Whop
- Clerk
- Stripe
- Railway
- Vercel
- Supabase
- Resend
- Ayrshare
- Postiz
- S3/R2/storage
- Sentry/telemetry

Security rule: keys show **Configured / Missing** only.

---

### 4.7 Releases / Builds

Purpose: prevent version chaos.

Fields:

- version
- build time
- installed time
- git status clean? yes/no
- tsc result
- invariant result
- keychain assert result
- sidecar rebuilt? yes/no
- app installed? yes/no
- hand-walk status
- release approved by Daniel? yes/no
- notes

A release is not done until the installed app passes hand-walk and Daniel approves.

---

### 4.8 Customers (Signals)

Purpose: identify what stops users from converting.

Fields:

- user email
- app version
- last action
- bug reported
- upgrade attempted? yes/no
- checkout completed? yes/no
- locked after payment? yes/no
- first clip created? yes/no
- first Project created? yes/no
- first Earn campaign started? yes/no

This is mock/static for v0.1. Real tracking is scoped for later.

---

### 4.9 Reports

A running feed of:

- latest agent reports
- revenue blockers
- Iron Gate status changes

Mock data for v0.1.

---

### 4.10 Inbox

Purpose: lightweight user-to-HQ support board.

Board columns:

- **New** — needs triage
- **In Progress** — being handled
- **Resolved** — done / archived

Message fields:

- id
- from (masked email)
- subject
- body
- status
- priority: low / medium / high
- app version
- created at
- assignee
- revenue related? yes/no

UI includes:

- summary cards (new, in progress, resolved, revenue-related)
- filter: all / revenue-related / high priority
- move buttons on each card (new → in progress → resolved)
- compose placeholder

Security rule: no real user PII in mock data; real implementation must mask emails.

Backend path later:

- Add an `inbox_messages` table (or reuse `notifications` with category `"support_inbound"`).
- Add `/admin/inbox` read route in `junior-backend/app/routes/admin.py`.
- Add write route for status changes.
- Add to proxy allow-list in `account-app/src/app/api/admin/[...path]/route.ts`.
- Add customer-facing support form that POSTs to the backend via the proxy.

---

## 5. Env vars needed

Add these placeholders to `account-app/.env.example`:

```text
# HQ — Agent lane API keys (source of truth for bug-command-centre only).
# Leave empty for local dev. The UI shows Configured / Missing — never the value.
# Do not commit real secrets.
KIMI_AUTH_AGENT_API_KEY=
KIMI_PROJECTS_AGENT_API_KEY=
KIMI_EARN_AGENT_API_KEY=
KIMI_UI_AGENT_API_KEY=
OPENAI_CODEX_AGENT_API_KEY=
CLAUDE_AGENT_API_KEY=
HQ_INTERNAL_SECRET=
```

Service keys are detected from existing env vars (never displayed):

```text
OPENAI_API_KEY
KIMI_API_KEY
CLAUDE_API_KEY
WHOP_API_KEY
CLERK_SECRET_KEY
STRIPE_SECRET_KEY
RAILWAY_TOKEN
VERCEL_TOKEN
SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
AYRSHARE_API_KEY
POSTIZ_API_KEY
AWS_ACCESS_KEY_ID / S3_ACCESS_KEY_ID / R2_ACCESS_KEY_ID
SENTRY_AUTH_TOKEN
```

Set real values only in `.env.local` or Vercel. Never commit them.

---

## 6. Security rules for API keys

1. **No hardcoded secrets.** All key placeholders are empty in the repo.
2. **No keys in the browser.** `admin/page.tsx` reads env vars server-side and converts them to boolean flags. Only `true`/`false` reaches the client.
3. **UI displays only `Configured` / `Missing`.** The real value is never rendered, logged, or sent to the browser.
4. **HQ_INTERNAL_SECRET is separate from INTERNAL_API_SECRET.** Agent-lane automation cannot reuse the existing internal API secret without explicit configuration.
5. Missing keys are shown clearly so it is obvious which automation cannot run.

---

## 7. Bug severity rules

Severity is strict and revenue-first:

| Severity | Meaning |
|----------|---------|
| P0 — stops payment | User cannot complete a purchase / upgrade. |
| P0 — stops paid access | Paid user cannot use something they paid for. |
| P0 — stops first action | New install / activation / first launch is blocked. |
| P1 — trust loss | User sees wrong state, dead link, or broken promise. |
| P1 — retention blocker | Existing paid user cannot continue their workflow. |
| P2 — polish | Visual/UX issue that does not block money or trust. |

Revenue damage classification:

- **Blocking payment:** P0 — stops payment OR P0 — stops paid access.
- **Blocking activation:** P0 — stops first action.
- **Blocking retention:** P1 — retention blocker.

---

## 8. Monthly cost representation

Costs are stored and displayed in **cents** internally to avoid floating-point errors. The UI formats cents to dollars.

Cost categories:

- **Tool / API costs:** fixed monthly + current usage spend.
- **Agent costs:** monthly usage spend per agent.
- **Infra costs:** hosting + backend services.
- **People costs:** active employee monthly cost.
- **Total monthly burn:** sum of all of the above.
- **Net monthly cash:** gross revenue − total burn.

Burn is displayed as negative when costs exceed revenue.

---

## 9. How employees are represented

Employees are a static table with permission levels and access control:

- `Owner` (Daniel) — full HQ access.
- `Support` — customer trust issues, no HQ access.
- `Contributor` — specific lane work, no HQ access unless explicitly granted.

Status controls cost inclusion: only `active` employees count toward monthly people cost. Invited/paused/removed employees are visible but excluded from burn.

No invites or emails are sent automatically.

---

## 10. How agents are represented

Agents are displayed as both **lane cards** and a **detail table**:

- Lane cards show status, API-key state, budget vs spend, approval requirement, and latest report.
- The detail table shows allowed/forbidden files, last task, and Iron Gate section.

Agents are mapped to env-key booleans so the UI can show which agents are ready to run automated work.

---

## 11. What is intentionally not built yet

To keep this a minimal foundation, the following are out of scope for v0.1:

- Real backend tables for bugs, agents, employees, APIs, releases, revenue, customers.
- Real bug intake API from the desktop app.
- Real revenue / payment data from Stripe/Whop/Clerk.
- Slack notifications.
- Automated agent report ingestion.
- Bug create/edit/delete mutations.
- Employee invite / email sending.
- Screenshots/logs upload storage.
- Real customer signal tracking.
- Real release/build pipeline integration.

These are documented in section 12 as next steps.

---

## 12. Next steps to wire real data later

1. **Backend models:** Add `Bug`, `Agent`, `Employee`, `ApiService`, `IronGate`, `Release`, `CustomerSignal`, `RevenueDay`, `RevenueWeek`, `RevenueMonth`, and `InboxMessage` tables in `junior-backend/app/models.py`.
2. **Backend routes:** Add `/admin/hq/*` endpoints under `junior-backend/app/routes/admin.py` for each tab.
3. **Proxy allow-list:** Add new paths to `READ_PATHS` in `account-app/src/app/api/admin/[...path]/route.ts`.
4. **Desktop bug intake:** Add a minimal bug-report flow in the desktop app that POSTs to the backend via the account-app proxy.
5. **Revenue wiring:** Pull subscription/payment events from Clerk/Stripe/Whop into the revenue tables.
6. **Inbox wiring:** Add customer-facing support form + `/admin/inbox` routes so messages flow into the board.
7. **Swap mock for live:** Replace static arrays in `HQCommandTabs.tsx` with `useAdminFetch()` calls.
8. **Add mutations later:** Only after read is stable, add POST/PATCH routes for changing status, assignments, and reports.

---

## 13. Files changed

- `account-app/.env.example`
- `account-app/src/app/admin/page.tsx`
- `account-app/src/components/admin/AdminHQ.tsx`
- `account-app/src/components/admin/HQCommandTabs.tsx` (new)
- `docs/HQ_BUG_COMMAND_CENTRE_SCOPE.md` (this file)

No customer desktop app files were changed. No commit, push, tag, release, or `latest.json` changes were made.
