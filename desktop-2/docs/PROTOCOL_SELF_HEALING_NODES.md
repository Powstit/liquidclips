# Protocol · Self-Healing Nodes (Sovereign Operator)

**Status:** v1 primitive landed 2026-07-06. Backend + Admin dashboard scoped for post-Cohort 0 sprint.
**Owner:** Daniel · Executor: Claude.
**Companion:** `account-app/src/components/admin/JourneyMapTab.tsx` (customer-flow completeness) + a new `NodeHealthTab` (planned) that consumes this.

## Why

Every customer journey in Liquid Clips (`JourneyMapTab.tsx` lists 80) is a Node. Historically a bug inside one Node crashed the whole app, and silent failures faked success (see Slice 3 audit: `startAssistedHandoff` swallowing every catch and toasting "Opened composer" regardless of what actually opened). Cohort 0 cold-email launch cannot tolerate either failure mode.

The Sovereign Operator answer: wrap every Node in a **Watchdog** so:
1. A crash inside a Node renders a friendly `KadeRepairScreen` — the app keeps working elsewhere.
2. A silent-swallow becomes impossible — the Watchdog dispatches an `Intercession` event to HQ Admin the instant a fail happens.
3. Every Node exposes an **AdminKey override** so Daniel can force-disable a section or inject an API key from HQ Admin without redeploying.
4. HQ Admin sees per-Node **FailureScore + health** in real time — green (0–2) · yellow (3–9) · red (≥10). Red trips the Intercession LLM.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  desktop-2 app                                                  │
│                                                                 │
│  ┌───────────────────────────────────────────┐                  │
│  │ <Watchdog nodeId="money/mo-01/...">      │                  │
│  │   <PublishModule … />                    │  ← React nodes    │
│  │ </Watchdog>                              │                  │
│  └───────────────────────────────────────────┘                  │
│                                                                 │
│  watchdogWrap({...}, async (…) => …)                            │
│   ← async RPC / event handlers                                  │
│                                                                 │
│  ┌───────────────────────────────────────────┐                  │
│  │ nodeRegistry (localStorage-backed)        │                  │
│  │  • per-Node FailureScore                  │                  │
│  │  • per-Node AdminOverride                 │                  │
│  │  • subscribe(fn) → HMR reactivity         │                  │
│  └───────────────────────────────────────────┘                  │
│                    │ dispatchIntercession()                     │
│                    ▼                                            │
│  ┌───────────────────────────────────────────┐                  │
│  │ interceptionBus                           │                  │
│  │  • local: bus.emit("system:intercession") │                  │
│  │  • remote: POST /hq/nodes/intercession    │                  │
│  └───────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
                     │
                     ▼ (planned · Sprint N+1)
┌─────────────────────────────────────────────────────────────────┐
│  junior-backend                                                 │
│  POST /hq/nodes/intercession   ← insert FailureRecord           │
│  GET  /hq/nodes/state          ← current NodeState per node     │
│  POST /hq/nodes/{id}/override  ← disable / inject apiKey / clear│
└─────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  account-app HQ Admin                                           │
│  NodeHealthTab                                                  │
│  • Live health grid (green/yellow/red per cluster)              │
│  • Line-of-code pinpoint per failure                            │
│  • One-click "Pause Node" (disable override)                    │
│  • Per-Node API-key injection form                              │
│  • Intercession LLM trigger button                              │
└─────────────────────────────────────────────────────────────────┘
```

## v1 · what shipped 2026-07-06 (this turn)

**Frontend primitives** at `desktop-2/src/lib/watchdog/`:

| File | Purpose |
|---|---|
| `types.ts` | `NodeId`, `NodeHealth`, `FailureRecord`, `AdminOverride`, `NodeState` shapes + thresholds |
| `nodeRegistry.ts` | In-memory Map + localStorage persistence · `registerNode` / `recordFailure` / `setOverride` / `subscribe` |
| `interceptionBus.ts` | `dispatchIntercession(record)` · local bus event + best-effort POST |
| `KadeRepairScreen.tsx` | Fallback UI · Kade error avatar + 5:00 countdown + fuchsia pulse ring · CSS motion echoes Remotion aesthetic |
| `KadeRepairScreen.css` | Motion + layout · respects `prefers-reduced-motion` |
| `Watchdog.tsx` | `<Watchdog>` React error boundary + `watchdogWrap()` async HOF + `useNodeState()` hook |
| `index.ts` | Barrel exports |

**5 first-customer nodes** wrapped this turn (the ship-lens YELLOWs):
- `money/mo-01/assisted-handoff` — Publish walk-around per-leg truth
- `pipeline/cp-16/overlay-gallery` — OverlayTemplateGallery Remotion-style "picked" pill
- `money/mo-13/reward-rules` — Sui payout copy honesty
- `money/mo-14/stripe-connect-honesty` — JourneyMapTab citation fix
- `agency/ag-07/campaigns-grid` — AgencyCampaigns responsive collapse

## v2 · Backend + Admin (planned · Post-Cohort 0)

### Backend routes (`junior-backend/app/routes/hq_nodes.py`)

```python
class InterventionRecord(BaseModel):
    nodeId: str
    ts: int
    weight: int
    message: str
    stack: Optional[str] = None
    context: Optional[dict] = None

@router.post("/hq/nodes/intercession")
async def intercession(rec: InterventionRecord, user=Depends(auth_owner_only)):
    """Insert into node_failures table. Trigger Intercession LLM if
       cumulative score for this nodeId crosses RED threshold in last 5 min."""

@router.get("/hq/nodes/state")
async def state(user=Depends(auth_owner_only)) -> list[NodeStateResponse]:
    """Return every registered Node with rolling failure counts + overrides."""

@router.post("/hq/nodes/{node_id}/override")
async def set_override(node_id: str, body: AdminOverride, user=Depends(auth_owner_only)):
    """Persist disabled / apiKey / clearedAt override so all clients pick it up on next /sync."""
```

### DB schema

```sql
create table node_failures (
  id bigint primary key generated always as identity,
  node_id text not null,
  weight int not null,
  message text not null,
  stack text,
  context jsonb,
  captured_at timestamptz not null default now()
);
create index node_failures_node_id_captured_at on node_failures (node_id, captured_at desc);

create table node_overrides (
  node_id text primary key,
  disabled boolean not null default false,
  api_key text,
  cleared_at timestamptz,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
```

### Admin UI (`account-app/src/components/admin/NodeHealthTab.tsx`)

Grid grouped by cluster (identity / pipeline / money / agency / system). Per-Node row shows:
- Color chip (green / yellow / red)
- FailureScore (rolling 5-min window)
- Last failure message + line-of-code pinpoint (linkable via `NodeMeta.source`)
- One-click actions: **Pause** (set `disabled: true`), **Clear** (set `clearedAt: now()`), **Inject key** (form → set `apiKey`), **Ask Kade** (trigger Intercession LLM)

### Intercession LLM contract

When a Node's rolling 5-min failure score ≥ `RED_THRESHOLD`:
1. Backend gathers last N `FailureRecord`s + surrounding git diff via `NodeMeta.source`.
2. Calls Kade LLM with prompt: *"Node X failed with pattern Y. The Watchdog wrapped it here: [file:line]. Suggest a patch that:
   - Restores service availability (not perfection)
   - Doesn't change any other Node's contract
   - Has a one-line test case"*
3. LLM returns proposed patch. Backend surfaces it in HQ Admin as a **"Apply patch"** button (Daniel approves before commit).

## Node ID convention

`<cluster>/<journey-id>/<component>`

Examples:
- `money/mo-01/assisted-handoff`
- `pipeline/cp-16/overlay-gallery`
- `identity/id-02/sign-in-pill`
- `agency/ag-07/campaigns-grid`

Journey IDs match `JourneyMapTab.tsx` so HQ Admin can cross-link.

## Failure weights

| Cause | Weight |
|---|---|
| React error boundary catch (hard crash) | 10 |
| `watchdogWrap` async throw | 5 |
| Silent-fail flagged by caller (e.g. clipboard failed but composer opened) | 2 |
| Transient network hiccup (auto-retried) | 1 |

Thresholds: `YELLOW_THRESHOLD = 3` · `RED_THRESHOLD = 10`.

## Wire-in rollout

Node coverage grows Node-by-Node as regressions are found. Priority order:

1. **Money nodes** (mo-01 through mo-20) — revenue path · wrap all
2. **Pipeline nodes** (cp-01 through cp-19) — clipper's export = money-moment
3. **Agency nodes** (ag-01 through ag-29) — agency operator flow
4. **Identity nodes** (id-01 through id-12) — sign-in reliability

Each wrap is one commit. Ship-lens gates every wrap.

## Non-goals (do NOT drift into scope)

- Real-time WebSocket telemetry from every client → backend. Overkill for Cohort 0. Batch POST on failure is enough.
- Client-side auto-repair without Daniel approval. The LLM proposes; Daniel approves.
- Removing existing per-component error boundaries (e.g. `EngineErrorBoundary`). The Watchdog is complementary — Engine bricks stay their own boundary, but they now also participate in the Node registry.

## Success metric

Zero white-screen crashes reported by Cohort 0 users. Every incident surfaces in HQ Admin with a line-of-code pinpoint before the user opens a support ticket.
