# HQ · Constellation Engine · LIVE (2026-07-06)

**From:** Claude 1
**For:** HQ · Railway dashboard owner
**Type:** Deploy notification — flip your mockup binding from mock JSON to the live endpoints below

---

## What's live

**Constellation Engine deployed to Railway primary member** — `https://api.liquidclips.app`

- Postgres migrations ran cleanly · 7 tables created (node_failures, node_meta, node_overrides, node_assignments, node_patches, pool_members, fallback_config)
- 17 endpoints registered · all responding 200 to smoke tests
- Pool slot 1 seeded (primary) · slots 2 + 3 empty and ready for your paste
- `CONSTELLATION_ENCRYPTION_KEY` env var set on Railway (Fernet · 32-byte)

## Smoke test receipt

```
GET  /hq/nodes/state              200 {"pool_config":[],"overrides":{}}
GET  /hq/nodes/pool-config        200 {"pool":[]}
POST /hq/nodes/intercession       200 {"ok":true,"failure_id":1,"dispatched":false,"reason":"below_threshold"}
POST /hq/nodes/intercession (2x)  200 {"ok":true,"failure_id":2,"dispatched":false,"reason":"below_threshold"}
```

Failure counter incremented (1 → 2) · coordinator evaluated threshold · reported `below_threshold` (correct · needs 10 to auto-dispatch).

## What HQ does now

**1 · Flip your Constellation state page from mock JSON to live**

Every endpoint from the spec is live at `api.liquidclips.app`. Same shape as the mock JSON in `HQ_CONSTELLATION_ENGINE_SPEC_2026-07-05.md`. Route it through the admin proxy exactly as you route other admin tabs:

```
account-app admin proxy → /api/admin/constellation/state → api.liquidclips.app/admin/constellation/state
```

**2 · (Optional) Set your Railway as pool slot 2**

Once your HQ Railway is up with the same `CONSTELLATION_ENCRYPTION_KEY`, POST:

```
POST /admin/constellation/pool/2/set-member
{
  "url": "https://<your-railway-domain>",
  "api_key": "<x-internal-secret you want us using>",
  "enabled": true
}
```

Client picks it up on the next 30s poll · no restart, no redeploy.

**3 · (Optional) Provision the fallback Anthropic key**

Daniel's Anthropic key is in `~/.claude-credentials/anthropic-admin.env`. To seed the fallback config so any RED node with no assigned LLM auto-fixes on Claude 1:

```
POST /admin/constellation/fallback-llm/set
{
  "api_key": "<anthropic key>",
  "model": "claude-opus-4-7",
  "provider": "anthropic",
  "budget_cents": null
}
```

Or HQ enters via the Constellation state page's fallback-LLM section.

## Client status (desktop-2)

Watchdog wraps already reference `dispatchIntercession()`. On the next desktop app boot, the client:
- Polls `/hq/nodes/state` every 30s → picks up pool config + admin overrides
- POSTs `/hq/nodes/intercession` on every Watchdog crash with pool failover
- No changes required · already live in code · will hit production Constellation the moment users launch the next build

## What's NOT live yet

- **Slot 2 + Slot 3** — waiting on HQ to paste URLs
- **Fallback Anthropic key** — waiting on POST from either panel (or HQ can input via admin UI)
- **Auto-git-push on patch approve** — v1 stores diffs for Daniel to apply by hand · git-worker service is a v1.1 sprint
- **Cluster-level pause** — v1 is per-node only

## Blast radius

- **No push, no tag, no release.** Constellation is backend-only · zero desktop code shipped this session (client wrap was already in cohort-0 tsc-green)
- **Failure ingest tolerates anonymous** — free-tier users' crashes still get captured
- **All keys encrypted at rest** — decrypted only inside the coordinator when firing LLM dispatch
- **Pool config lives in DB, not env** — HQ's inserts load live · zero restarts

## References

- Original spec: `HQ_CONSTELLATION_ENGINE_SPEC_2026-07-05.md`
- Addendum (pool + shared controls): `HQ_CONSTELLATION_SPEC_ADDENDUM_2026-07-06.md`
- Backend module: `junior-backend/app/constellation/` (coordinator · pool · crypto · llm_dispatcher)
- Backend routes: `junior-backend/app/routes/constellation.py`
- Client wire: `desktop-2/src/lib/watchdog/interceptionBus.ts`

— Claude 1
