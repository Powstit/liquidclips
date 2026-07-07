# HQ · Constellation Engine · state-page mockup spec (2026-07-05)

**From:** Claude 1 (identity + pipeline lane · Constellation coordinator)
**For:** HQ · Railway HQ dashboard owner
**Type:** Fresh spec — new tab on your dashboard · you own the visual mock · I own the Railway backend + admin wiring
**Cadence:** unsolicited handoff · Daniel asked me to give you the exact information to mock up the state page BEFORE the backend ships so it's ready to bind day-one

---

## TL;DR

We're shipping a **self-healing node runtime** across the desktop app called **Constellation**. Every user-reachable surface (49 nodes and counting · identity + pipeline + money + agency) is wrapped in a `Watchdog` that never lets a crash white-screen the app — instead the crash gets reported to a Railway-hosted engine, aggregated per-node, and either **fixed by a bug-fix LLM you (HQ) hired for that specific node**, or **fixed by me as the fallback** on my always-on Anthropic key.

- **Nodes = stars.** Each has a stable id, a cluster, a source file:line, an owner.
- **HQ = astronomer.** You render the sky map + hire/fire the bug-fix LLMs.
- **LLMs = independent bug-fix agents.** One per node · huge dedicated credit line · does nothing but fix that node's bugs.
- **Me = coordinator + always-on fallback.** I dispatch the assigned LLM when a node trips RED · if no LLM is hired, I take the fix using my Anthropic key.
- **Client = reporter only.** Desktop just POSTs failures. Everything else lives on Railway.

**What I need from you:** a new tab in your HQ dashboard rendering `/admin/constellation/state`. Spec + mock JSON below. You can start binding today · the endpoints go live end of this build session.

---

## Where this fits into your dashboard

New tab in the top-level nav — suggest right after **System Map**:

```
Overview · System Map · Constellation · Journey Map · Revenue · Bugs · Iron Gates …
```

**Constellation** is the runtime health sibling to **System Map**:
- System Map = *are the surfaces reachable?* (probe URLs · 30s cadence)
- Constellation = *are the surfaces crashing?* (failure reports · 5s cadence · per-node LLM assigned)

---

## The state page — visual mockup

```
┌───────────────────────────────────────────────────────────────────────┐
│  CONSTELLATION                                            [ 5s poll ] │
├───────────────────────────────────────────────────────────────────────┤
│  Coordinator: Claude 1 (Anthropic · always-on)   Fallback key: ✅ set │
│  Nodes: 49 · Healthy: 46 · Yellow: 2 · Red: 1 · Awaiting hire: 6      │
│  Patches proposed: 3 · Approved today: 1 · Failed dispatches: 0       │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  IDENTITY (6 nodes)                                          [ ⋯ ]    │
│  ●  id-01/intro-splash            green   ·  0 fails/5m  · —          │
│  ●  id-02/sign-in-pill            green   ·  0 fails/5m  · —          │
│  ●  id-06/settings-body           yellow  ·  4 fails/5m  · Kimi K2 🟢 │
│                                                                       │
│  PIPELINE (6 nodes)                                          [ ⋯ ]    │
│  ●  cp-10/export-clip             green   ·  0 fails/5m  · —          │
│  ●  cp-15/browse-in-app           red     ·  12 fails/5m · GPT-4o 🟢 │
│     └─ patch proposed 2m ago      [ view diff ] [ approve ] [ reject ]│
│                                                                       │
│  MONEY (14 nodes)                                            [ ⋯ ]    │
│  ●  mo-08/reward-clip-mint        green   ·  0 fails/5m  · Claude 3.5 🟢│
│  ●  mo-15/whop-payout-rail        green   ·  0 fails/5m  · —          │
│  ●  mo-16/sponsored-submission    yellow  ·  3 fails/5m  · —  ⚠ hire │
│                                                                       │
│  AGENCY (18 nodes)                                           [ ⋯ ]    │
│  ●  ag-01/create-workspace        green   ·  0 fails/5m  · —          │
│  ●  ag-11/publish-tier-gate       green   ·  0 fails/5m  · —          │
│                                                                       │
│  SYSTEM (5 nodes)                                            [ ⋯ ]    │
│                                                                       │
├───────────────────────────────────────────────────────────────────────┤
│  RECENT INTERCESSIONS                                                 │
│  cp-15  · TypeError · openWith is undefined      · 2m ago · patch 🟢 │
│  mo-16  · fetch 500 · POST /campaigns             · 8m ago · queued  │
│  id-06  · React error boundary · null prop drop   · 41m ago · cleared│
└───────────────────────────────────────────────────────────────────────┘
```

### Node-row anatomy

Every row shows five things:

| Field | Source | Format |
|---|---|---|
| Status dot | `state.health` | green / yellow / red |
| Node id | `state.meta.id` | mono, small |
| Rolling failure count | `state.failureScore` computed over last 5min | `N fails/5m` |
| Assigned LLM | `state.assignment.model` if hired, else `—` | model name + green dot if hired |
| Action | `patch proposed` state | inline approve/reject buttons |

### Node-row expanded (click ⋯)

```
┌───────────────────────────────────────────────────────────────────────┐
│  pipeline/cp-15/browse-in-app                                    [ × ]│
├───────────────────────────────────────────────────────────────────────┤
│  Label:       Browse · in-app source picker                          │
│  Cluster:     pipeline                                                │
│  Source:      src/sections/browse/BrowseSection.tsx:14               │
│  Owner:       Claude 1                                                │
│  Money-crit:  no                                                      │
│                                                                       │
│  HEALTH                                                               │
│  Score: 12 / RED (threshold 10)                                       │
│  Last failure: 2026-07-05 22:41:03 UTC                               │
│  Message: TypeError: Cannot read properties of undefined (openWith)   │
│                                                                       │
│  ASSIGNED LLM                                                         │
│  Model:  gpt-4o (OpenAI)                                              │
│  Hired:  2026-07-04                                                   │
│  Credits: $500 budget · $47.20 used                                   │
│  API key: ✅ configured (never displayed)                             │
│  System prompt: [ edit ] [ view ]                                     │
│  [ fire this LLM ]  [ dispatch fix now ]                              │
│                                                                       │
│  OVERRIDES                                                            │
│  [ pause node ]  [ clear score ]  [ inject api key ]                  │
│                                                                       │
│  RECENT PATCHES                                                       │
│  · 2m ago    · proposed  · fix openWith undefined  [approve] [reject] │
│  · 3d ago    · approved  · fix null clip.title                        │
│  · 5d ago    · approved  · handle 429 whop rate limit                 │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Backend API contract

All endpoints live on `api.liquidclips.app/admin/constellation/*` (junior-backend on Railway) and go through your existing admin proxy at `account-app/src/app/api/admin/[...path]/route.ts`. Same `x-internal-secret` auth pattern.

### GET /admin/constellation/state

Whole sky in one call. Polls at 5s.

```json
{
  "generated_at": "2026-07-05T22:41:00Z",
  "note": "Live node health from Watchdog runtime. failureScore rolls over 5 min; health flips yellow at 3 and red at 10.",
  "summary": {
    "total": 49,
    "healthy": 46,
    "yellow": 2,
    "red": 1,
    "awaiting_hire": 6,
    "patches_proposed": 3,
    "approved_today": 1,
    "failed_dispatches_24h": 0
  },
  "coordinator": {
    "role": "Claude 1 · Anthropic",
    "fallback_key_configured": true,
    "fallback_model": "claude-opus-4-7"
  },
  "clusters": [
    {
      "cluster": "identity",
      "nodes": [
        {
          "meta": {
            "id": "identity/id-01/intro-splash",
            "label": "First-launch intro splash",
            "cluster": "identity",
            "source": "src/App.tsx:225",
            "owner": "Claude 1",
            "money_critical": false
          },
          "failureScore": 0,
          "failures_5m": 0,
          "health": "green",
          "last_failure": null,
          "assignment": null,
          "override": {},
          "recent_patches": []
        },
        {
          "meta": {
            "id": "identity/id-06/settings-body",
            "label": "Settings (connections · profile · notifications)",
            "cluster": "identity",
            "source": "src/design-os/routes/Settings.tsx:1494",
            "owner": "Claude 1",
            "money_critical": false
          },
          "failureScore": 4,
          "failures_5m": 4,
          "health": "yellow",
          "last_failure": {
            "ts": "2026-07-05T22:39:12Z",
            "message": "React error boundary · null prop drop",
            "weight": 1
          },
          "assignment": {
            "model": "kimi-k2",
            "provider": "moonshot",
            "hired_at": "2026-07-01T00:00:00Z",
            "budget_cents": 50000,
            "used_cents": 4720,
            "api_key_configured": true,
            "system_prompt_length": 340
          },
          "override": {},
          "recent_patches": []
        }
      ]
    },
    {
      "cluster": "pipeline",
      "nodes": [
        {
          "meta": {
            "id": "pipeline/cp-15/browse-in-app",
            "label": "Browse · in-app source picker",
            "cluster": "pipeline",
            "source": "src/sections/browse/BrowseSection.tsx:14",
            "owner": "Claude 1",
            "money_critical": false
          },
          "failureScore": 12,
          "failures_5m": 12,
          "health": "red",
          "last_failure": {
            "ts": "2026-07-05T22:41:03Z",
            "message": "TypeError: Cannot read properties of undefined (openWith)",
            "weight": 10
          },
          "assignment": {
            "model": "gpt-4o",
            "provider": "openai",
            "hired_at": "2026-07-04T00:00:00Z",
            "budget_cents": 50000,
            "used_cents": 4720,
            "api_key_configured": true
          },
          "override": {},
          "recent_patches": [
            {
              "id": "patch_1234",
              "status": "proposed",
              "ts": "2026-07-05T22:39:00Z",
              "summary": "fix openWith undefined guard",
              "diff_url": "/admin/constellation/patches/patch_1234"
            }
          ]
        }
      ]
    }
  ],
  "recent_intercessions": [
    {
      "nodeId": "pipeline/cp-15/browse-in-app",
      "ts": "2026-07-05T22:39:00Z",
      "message": "TypeError: openWith is undefined",
      "resolution": "patch_proposed"
    },
    {
      "nodeId": "money/mo-16/sponsored-submission",
      "ts": "2026-07-05T22:33:00Z",
      "message": "fetch 500 · POST /campaigns",
      "resolution": "queued_for_llm"
    },
    {
      "nodeId": "identity/id-06/settings-body",
      "ts": "2026-07-05T22:00:00Z",
      "message": "React error boundary · null prop drop",
      "resolution": "cleared_by_admin"
    }
  ]
}
```

### POST /admin/constellation/nodes/{id}/assign-llm

HQ hires an LLM to a node.

Request:
```json
{
  "model": "gpt-4o",
  "provider": "openai",
  "api_key": "sk-…",
  "budget_cents": 50000,
  "system_prompt": "You fix bugs in the Browse in-app source picker. …"
}
```

Response:
```json
{ "ok": true, "hired_at": "2026-07-05T22:41:00Z" }
```

**Security rule:** API key is written encrypted to `node_assignments.api_key_encrypted`. UI never re-reads it — subsequent GET calls show `api_key_configured: true` only.

### POST /admin/constellation/nodes/{id}/fire

HQ fires the assigned LLM.

Response:
```json
{ "ok": true, "fired_at": "2026-07-05T22:41:00Z" }
```

Node reverts to Claude 1 fallback until a new LLM is hired.

### POST /admin/constellation/nodes/{id}/override

HQ pauses / clears / injects a key on a node.

Request:
```json
{
  "disabled": true,
  "clear_score": true,
  "api_key_override": null
}
```

Response:
```json
{ "ok": true }
```

### POST /admin/constellation/nodes/{id}/dispatch

HQ manually kicks a fix run (e.g. before a demo).

Response:
```json
{ "ok": true, "dispatch_id": "disp_5678", "eta_seconds": 20 }
```

### POST /admin/constellation/patches/{id}/approve

Approve a proposed patch — coordinator applies + commits.

Response:
```json
{ "ok": true, "commit_sha": "abc1234", "branch": "constellation/patch_1234" }
```

### POST /admin/constellation/patches/{id}/reject

Reject — coordinator discards + tells the LLM to try again with feedback.

Request:
```json
{ "reason": "not the right file · needs to touch openWith not openBrowser" }
```

---

## Current node registry (Cohort 0 snapshot)

49 nodes wrapped across the app as of this handoff. **Full list — this is what your state page renders on day-one:**

### Identity cluster (6 nodes)

| id | label | source |
|---|---|---|
| `identity/id-01/intro-splash` | First-launch intro splash | src/App.tsx:225 |
| `identity/id-02/sign-in-pill` | Top HUD sign-in pill | src/design-os/components/TopHud.tsx:425 |
| `identity/id-06/settings-body` | Settings (connections · profile · notifications) | src/design-os/routes/Settings.tsx:1494 |
| `identity/id-07` | *(shared with id-06)* | — |
| `identity/id-08` | *(shared with id-06)* | — |

### Pipeline cluster (6 nodes)

| id | label | source |
|---|---|---|
| `pipeline/cp-10/export-clip` | Real MP4 export via sidecar | src/design-os/engine/sidecar-stub.ts:978 |
| `pipeline/cp-11/save-copy-as` | Save copy as (dupe export) | src/design-os/engine/sidecar-stub.ts:1056 |
| `pipeline/cp-12/reveal-in-finder` | Reveal exported file in Finder | src/design-os/engine/sidecar-stub.ts:1103 |
| `pipeline/cp-13/export-history` | List past exports | src/design-os/engine/sidecar-stub.ts:1034 |
| `pipeline/cp-15/browse-in-app` | Browse · in-app source picker | src/sections/browse/BrowseSection.tsx:14 |
| `pipeline/cp-16/overlay-gallery` | Overlay template gallery | src/design-os/studio/OverlayTemplateGallery.tsx:149 |

### Money cluster (14 nodes)

| id | label | source |
|---|---|---|
| `money/mo-01/assisted-handoff` | Publish walk-around | src/design-os/schedule/assistedSchedule.ts:232 |
| `money/mo-02/schedule-notification-fire` | Schedule notification fire | src/App.tsx:250 |
| `money/mo-03/schedule-single-post` | Schedule single post | src/components/publish/PublishModal.tsx:292 |
| `money/mo-05/schedule-cancel` | Schedule cancel | src/design-os/engine/sidecar-stub.ts:1875 |
| `money/mo-05/schedule-reschedule` | Schedule reschedule | src/design-os/engine/sidecar-stub.ts:1920 |
| `money/mo-05/schedule-retry` | Schedule retry | src/design-os/engine/sidecar-stub.ts:1990 |
| `money/mo-06/calendar-view` | Calendar view | src/design-os/routes/Schedule.tsx:272 |
| `money/mo-08/reward-clip-mint` | Publish → RewardClip mint | src/design-os/engine/cockpit/PublishModule.tsx:508 |
| `money/mo-09/reward-clip-statuses` | Reward clip drawer | src/design-os/earn/RewardClipDrawer.tsx:125 |
| `money/mo-10/earn-summary` | Wallet earn summary | src/design-os/earn/WalletPanel.tsx:108 |
| `money/mo-13/reward-rules` | Reward rules panel | src/design-os/earn/RewardRules.tsx:49 |
| `money/mo-15/whop-payout-rail` | Whop payout rail | src/design-os/earn/AffiliateWidget.tsx:132 |
| `money/mo-16/sponsored-submission` | Sponsored campaign submission | src/design-os/campaigns/CampaignPageShell.tsx:237 |
| `money/mo-17/sponsored-reward` | Sponsored reward module | src/design-os/earn/SponsoredRewardModule.tsx:130 |

### Agency cluster (18 nodes)

| id | label | source |
|---|---|---|
| `agency/ag-01/create-workspace` | Create workspace | src/design-os/routes/Settings.tsx:685 |
| `agency/ag-02/roster-view` | Roster view | src/design-os/routes/agency-panels/RosterPanel.tsx:42 |
| `agency/ag-03/roster-invite` | Roster invite | src/lib/agency.ts:274 |
| `agency/ag-04/revoke-invite` | Revoke invite | src/lib/agency.ts:299 |
| `agency/ag-05/remove-member` | Remove member | src/lib/agency.ts:316 |
| `agency/ag-06/change-role` | Change role | src/lib/agency.ts:333 |
| `agency/ag-07/campaigns-grid` | Campaigns grid | src/design-os/routes/AgencyCampaigns.tsx:219 |
| `agency/ag-08/payout-splits-define` | Payout splits define | src/design-os/routes/agency-panels/PayoutSplitPanel.tsx:47 |
| `agency/ag-08/payout-splits-put` | Payout splits PUT | src/lib/agency.ts:364 |
| `agency/ag-10/watermark-removal-charge` | Watermark removal charge | src/lib/useWatermarkRemovalPaywall.ts:83 |
| `agency/ag-11/publish-tier-gate` | Publish tier gate | src/design-os/engine/cockpit/PublishModule.tsx:441 |
| `agency/ag-12/trial-approve-early` | Trial approve early | src/lib/trial.ts:119 |
| `agency/ag-13/cancel-subscription` | Cancel subscription | src/sections/account/AccountSection.tsx:145 |
| `agency/ag-15/monthly-post-cap` | Monthly post cap | src/design-os/routes/Schedule.tsx:152 |
| `agency/ag-17/seeded-rooms` | Seeded community rooms | src/design-os/routes/Community.tsx:59 |
| `agency/ag-18/community-chat` | Community chat home | src/design-os/community/CommunityChatHome.tsx:229 |
| `agency/ag-20/notifications-inbox` | Notifications inbox | src/shell/InboxSheet.tsx:147 |
| `agency/ag-21/announcements` | Announcement banner | src/design-os/components/AnnouncementBanner.tsx:161 |
| `agency/ag-23/agency-preview-gate` | Agency preview gate | src/components/paywall/AgencyPreviewBanner.tsx:82 |
| `agency/ag-24/boost-pack-purchase` | Boost pack purchase | src/design-os/schedule/ScheduleFromExportDrawer.tsx:339 |

### System cluster (reserved)

Growth-engine + backend nodes will land here in v1.1 once the coordinator is deployed to Railway.

---

## LLM hire/fire flow (HQ-owned)

Everything HQ controls end-to-end. Here's the exact form UX:

### Hire a bug-fix LLM to a node

1. Click the node row → **Assign LLM**.
2. Modal:
   - **Provider** dropdown: OpenAI · Anthropic · Moonshot (Kimi) · custom endpoint
   - **Model** dropdown: populated per provider (`gpt-4o`, `claude-opus-4-7`, `kimi-k2`, …)
   - **API key** password field · never re-displayed after save
   - **Monthly budget (cents)** number input · default 50000 ($500)
   - **System prompt** textarea · pre-filled with a template that includes the node's `label`, `source`, `cluster`, `owner`, and links to a runbook (I'll ship default templates when the coordinator lands)
3. **Hire** button → POST `/admin/constellation/nodes/{id}/assign-llm`.
4. Row now shows the model + `hired-since` + a green dot.

### Fire an LLM

1. Node detail → **Fire this LLM**.
2. Confirm modal.
3. POST `/admin/constellation/nodes/{id}/fire`.
4. Row reverts to Claude 1 fallback.

### Approve / reject a proposed patch

1. Yellow row shows `patch proposed 2m ago`.
2. **View diff** → modal renders unified diff from `/admin/constellation/patches/{id}/diff` (I'll ship this endpoint too).
3. **Approve** → coordinator commits to a `constellation/patch_<id>` branch, pushes, opens PR against `master`. Daniel merges (or you if HQ has repo write access).
4. **Reject** → optional feedback → coordinator re-dispatches the LLM with the feedback appended to system prompt.

---

## My fallback role (always-on)

**If no LLM is assigned to a node → I take it on my Anthropic key.**

- I install `ANTHROPIC_API_KEY` on Railway as `CONSTELLATION_FALLBACK_ANTHROPIC_KEY`.
- Coordinator config: `fallback.model = "claude-opus-4-7"` · `fallback.budget_cents = null` (uncapped for cohort 0 · we'll cap post-launch).
- Rendered on the state page: **Fallback key ✅ set** header pill.
- When a node crosses RED and has no assignment, the coordinator calls Anthropic directly with the same context payload it would send to an assigned LLM.
- HQ hiring an LLM to a node **overrides** the fallback for that specific node · the fallback only fires where HQ hasn't hired yet.

This means: **no node is ever un-owned.** Every RED trip has someone on the fix path. Fastest cohort-0 posture.

---

## Preemptive Q&A (things I expect HQ will ask)

**Q: Where does the state page get its data? Same admin proxy pattern?**
Yes. Add these paths to the `READ_PATHS` allow-list in `account-app/src/app/api/admin/[...path]/route.ts`:
```
/admin/constellation/state
/admin/constellation/nodes/*/patches
/admin/constellation/patches/*/diff
```
And to `WRITE_PATHS`:
```
/admin/constellation/nodes/*/assign-llm
/admin/constellation/nodes/*/fire
/admin/constellation/nodes/*/override
/admin/constellation/nodes/*/dispatch
/admin/constellation/patches/*/approve
/admin/constellation/patches/*/reject
```
Auth is unchanged — `x-internal-secret` injected by the proxy.

**Q: Do I need my own Railway env vars for the LLM keys?**
No. Every LLM key is entered per-node in the HQ UI and stored encrypted in `node_assignments`. No Railway env vars for per-node LLMs. Only Railway env var is `CONSTELLATION_FALLBACK_ANTHROPIC_KEY` (my key) and Constellation's own `CONSTELLATION_ENCRYPTION_KEY` (for key-at-rest encryption).

**Q: What's the polling cadence?**
- State page: 5s (matches existing HQ tabs).
- Client (desktop-2): 30s pull on `/hq/nodes/state` for admin override updates.
- Coordinator RED check: on every failure ingest (event-driven, not polled).

**Q: How does the desktop actually report failures?**
Watchdog primitive already POSTs to `/hq/nodes/intercession` with `{ nodeId, ts, weight, message, stack, context }`. Fire-and-forget · no client-side state · matches the "nothing client-side" constraint.

**Q: Can HQ trigger downtime from the dashboard?**
Yes — POST `/admin/constellation/nodes/{id}/override` with `{ disabled: true }` renders a "temporarily paused by admin" placeholder to users instead of running the node. Use this as a manual circuit breaker if a fix goes wrong.

**Q: What about cluster-level actions (pause all money nodes, etc.)?**
Not in v1. If HQ wants a cluster-level pause, drop a `PASTE_BACK_CONSTELLATION.md` and I'll add cluster override endpoints in v1.1.

**Q: How do I test my mockup without live data?**
The mock JSON above is drop-in — save it as `constellation-state.mock.json` in your HQ dashboard and bind against it. The shipping endpoint will return an identically-shaped payload.

**Q: When will the endpoints be live?**
Coordinator ships to Railway this session. Estimate live at `api.liquidclips.app/admin/constellation/state` within 3-4 hours from this handoff timestamp. I'll drop a `HQ_CONSTELLATION_LIVE.md` note when the deploy finishes.

**Q: Does this affect the Cohort 0 push?**
No. Constellation is additive · zero regressions to existing surfaces (Watchdog wraps already landed and tsc-green). Push stays on the standing halt until Daniel says go — Constellation is not a ship-blocker for Cohort 0, it's the safety net *for* Cohort 0.

**Q: Who owns the diff-viewer UI in the patch approval modal?**
HQ renders the diff (you already have `react-diff-viewer` or similar in the dashboard). Coordinator provides raw diff text from `/admin/constellation/patches/{id}/diff` (returns `{ diff: "…", touched_files: [...], node_id, proposed_by }`).

**Q: What happens if the LLM proposes a patch that fails tsc?**
Coordinator runs tsc on the patch branch before surfacing it to HQ. If tsc fails, patch is marked `status: "failed_tsc"` and re-dispatched with the tsc errors as feedback. HQ never sees broken patches.

**Q: Can HQ see per-LLM spend across all nodes?**
Yes — GET `/admin/constellation/spend` returns `{ by_provider: {...}, by_node: {...}, month_total_cents }`. Shape TBD in v1.1 · I'll spec this in a follow-up if HQ wants it in cohort 0.

---

## Timing + build order (my end)

Locked sequence:

1. **Backend v1** (~2 hrs · in flight after this handoff)
   - `junior-backend/app/routes/constellation.py` · 7 endpoints
   - Postgres tables: `node_failures`, `node_overrides`, `node_assignments`, `node_patches`
   - `junior-backend/app/constellation/coordinator.py` · threshold logic + LLM dispatch adapter
   - `CONSTELLATION_FALLBACK_ANTHROPIC_KEY` env var wire · my key installed
2. **Admin proxy allow-list** · patch `account-app/src/app/api/admin/[...path]/route.ts`
3. **Client polling** · desktop-2 subscribes to `/hq/nodes/state` for override updates
4. **Docs** · update `PROTOCOL_SELF_HEALING_NODES.md` v2 section with the live endpoints
5. **Railway deploy** · `railway up --service junior-backend --detach` from `junior-backend/`
6. **Verify** · call the endpoints from Daniel's machine · confirm shape matches this spec exactly
7. **Handoff** · drop `HQ_CONSTELLATION_LIVE.md` so HQ can flip mock to live

Total: 3-4 hours. No push, no tag, no release — this is backend-only + local desktop wire.

---

## What HQ can do right now (parallel to my build)

1. **Create the Constellation tab** in your HQ Railway dashboard (empty shell + nav entry).
2. **Bind the tab to the mock JSON above** — get the sky-map render + expanded node modal + assign-LLM form all rendering against static data. This is 100% frontend work · zero backend dependency.
3. **Design the diff-viewer modal** for patch approval.
4. **Pre-populate LLM provider dropdown** — OpenAI + Anthropic + Moonshot (Kimi) + custom endpoint. Model list per provider.
5. **Ping back** in `PASTE_BACK_CONSTELLATION.md` with anything unclear or any additional endpoint you want in v1.

When the backend lands, you swap `constellation-state.mock.json` for the live endpoint · the payload shape is identical · zero rewire.

---

## Ownership summary

- **Claude 1 (me):** Watchdog primitive · coordinator · Railway backend · per-node LLM dispatch · fallback on my Anthropic key · admin proxy path additions · docs.
- **HQ:** Constellation state page · sky-map render · hire/fire UX · patch approval UX · dashboard tab wiring · diff viewer.
- **Daniel:** approves patches · approves LLM hires for money-critical nodes (mo-* cluster) · owns the pause-on-ship kill switch if needed.
- **CM lane (Claude 2):** owns the money+agency+demo wrapping · not part of Constellation coordinator build · will report failures on the same bus.

---

## The name

**Constellation.** Every node is a star with fixed coordinates (cluster / journey-id / component). HQ is the astronomer mapping the sky. Bug-fix LLMs are astronomers-per-star · each dedicated to one point of light. When a star goes dark, the sky notices, the closest astronomer looks up, the star relights. Nobody looks at all 49 stars at once — nobody has to.

Named. My baby. Shipping this session.

— Claude 1
