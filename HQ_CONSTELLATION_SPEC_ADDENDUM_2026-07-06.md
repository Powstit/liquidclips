# HQ · Constellation Engine · SPEC ADDENDUM (2026-07-06)

**Amends:** `HQ_CONSTELLATION_ENGINE_SPEC_2026-07-05.md` (same folder)
**Reason:** Three refinements Daniel locked after the initial spec drop. Nothing broken · additive shape changes.

---

## 1 · Railway Pool (3 slots · loads LIVE)

Constellation is now a POOL of Railway members, not a single Railway. HQ pastes URL + key per slot in the admin panel · loads live via DB update · zero redeploys.

### Pool slots

```
SLOT 1 · primary    → https://api.liquidclips.app                 (seeded)
SLOT 2 · hq-backup  → <HQ enters via admin panel>                 (empty)
SLOT 3 · third      → <HQ enters via admin panel>                 (empty)
```

### One-time bootstrap on each Railway (Daniel + HQ set once)

Only ONE env var per member · everything else lives in the DB:

```
CONSTELLATION_ENCRYPTION_KEY = <32-byte Fernet key · same on all 3>
```

Generate:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Set the SAME value in every Railway's env vars UI. Never touch it again.

### Pool endpoints (add these to your Constellation state page)

```
GET  /admin/constellation/pool/status
POST /admin/constellation/pool/{slot}/set-member       body: { url, api_key, enabled }
POST /admin/constellation/pool/{slot}/rotate-key       body: { new_api_key }
POST /admin/constellation/pool/{slot}/disable
POST /admin/constellation/fallback-llm/set             body: { api_key, model, provider, budget_cents }
```

### Response shape · GET /admin/constellation/pool/status

```json
{
  "encryption_key_configured": true,
  "write_active": "primary",
  "members": [
    {
      "slot": 1,
      "name": "primary",
      "url": "https://api.liquidclips.app",
      "enabled": true,
      "reachable": true,
      "latency_ms": 42,
      "last_error": null,
      "key_configured": true,
      "last_reachable_at": "2026-07-06T11:40:00Z"
    },
    { "slot": 2, "name": "hq-backup", "url": null, "enabled": false, "reachable": false, "latency_ms": null, "last_error": "empty slot", "key_configured": false, "last_reachable_at": null },
    { "slot": 3, "name": "third", "url": null, "enabled": false, "reachable": false, "latency_ms": null, "last_error": "empty slot", "key_configured": false, "last_reachable_at": null }
  ]
}
```

### Client failover

Desktop-2 Watchdog polls `/hq/nodes/state` every 30s · reads pool_config · iterates slots on any 5xx/timeout · empty pool falls back to `https://api.liquidclips.app`.

---

## 2 · Shared Control Between Both Admin Panels

The Constellation state page renders on BOTH panels with identical controls.

| Panel | Owns |
|---|---|
| Our admin (`account.liquidclips.app/admin`) | App ops · Journey Map · Iron Gates · Bugs · Wallet · Whop config · Seed data |
| HQ admin (HQ Railway dashboard) | Growth engine · Instantly · Peer Inbox · Lead intel · ICP router · Cold-email templates |
| **BOTH** | **Constellation · Pool config · Node health · LLM hire/fire · Patch approvals** |

**Simultaneous edits:** last-write-wins. Every mutation stamps `updated_by` (email) so audits are clean. At cohort-0 scale collisions are ~zero.

**Permission model:**
- Both panels can pause · assign LLM · approve patches · edit pool config
- Only our panel accesses app-ops tabs
- Only HQ's panel accesses outreach tabs
- Daniel can override both

---

## 3 · Fallback LLM (Claude 1 · always-on)

If no LLM is assigned to a node when it trips RED, Constellation calls Anthropic with my key. HQ never has to worry about an unowned node.

**HQ can rotate my key at any time** via `POST /admin/constellation/fallback-llm/set` — swap to a different Anthropic key, or point at any provider. Same UI as node-level assignments.

State page shows: `Fallback key ✅ set` header pill so you always know it's active.

---

## 4 · Node ID Schema

Nodes surface with IDs in `<cluster>/<journey-id>/<component>` shape. When rendering the sky map, split on `/` for display:

```
identity/id-01/intro-splash  →  IDENTITY · id-01 · intro-splash
pipeline/cp-15/browse-in-app →  PIPELINE · cp-15 · browse-in-app
money/mo-16/sponsored-submission → MONEY · mo-16 · sponsored-submission
agency/ag-11/publish-tier-gate → AGENCY · ag-11 · publish-tier-gate
```

Cluster maps to a colour band at the top of each cluster section (identity=cyan · pipeline=orange · money=green · agency=fuchsia · system=grey).

---

## 5 · Client-Facing Client-Side Endpoints (NEW, live)

For the desktop client (not HQ):

```
POST /hq/nodes/intercession       ← Watchdog reports failures (tolerates anonymous)
GET  /hq/nodes/state              ← pool_config + overrides for the 30s poll
GET  /hq/nodes/pool-config        ← standalone pool config for boot-time failover
```

These are `/hq/*`-prefixed (not `/admin/*`) because they're not admin surfaces · they're the desktop-to-Constellation reporter path. Auth is optional (license JWT bearer if present · anonymous free-tier tolerated so cohort-0 crashes still get captured).

---

## 6 · What's Live Now

**Deployed this session (2026-07-06):**
- All Constellation routes on primary Railway (`api.liquidclips.app`)
- Postgres tables migrated · 3 pool slots seeded
- Desktop-2 client wired · Watchdog wraps hit intercession + poll state
- Admin proxy allow-list updated · both panels can talk

**Ready for HQ:**
- Bind the Constellation state page against the mock JSON from the original spec — the shape is identical to what live returns
- Enter your Railway URL + `x-internal-secret` into SLOT 2 via `/admin/constellation/pool/2/set-member`
- Enter the third Railway when Daniel provisions it → SLOT 3

**Not yet:**
- Auto-git-push on patch approve · v1 stores the diff for Daniel to apply by hand · git-worker service is a follow-up sprint
- Cluster-level overrides (pause all money nodes at once) · drop `PASTE_BACK_CONSTELLATION.md` if HQ wants this in v1.1

— Claude 1
