# Liquid Clips — repo root agent guide

This file orients any AI agent (or human) working across the whole
Liquid Clips system. Surface-specific guides live in each project's
own `CLAUDE.md`; this root file owns the cross-cutting rules.

## Read these first, in order

1. **`DEPLOYMENT.md`** — single source of truth for shipping any
   surface (account-app, marketing, backend, desktop). Replaces all
   prior memory about which surface auto-deploys vs which needs a
   manual CLI. **If memory disagrees with `DEPLOYMENT.md`, this file
   wins.**
2. **`desktop/CLAUDE.md`** — desktop app (Tauri + Python sidecar)
   architecture, iron gates, build commands.
3. **`account-app/CLAUDE.md`** — Next.js 16 account / embed app.
4. **`junior-backend/CLAUDE.md`** — FastAPI backend on Railway.

## Cross-cutting rules

### Deployment topology (canonical — see `DEPLOYMENT.md` for detail)

* `account-app` → **manual** `vercel deploy --prod` from `account-app/`.
* `liquidclips-marketing` → **manual** `vercel deploy --prod` from
  `liquidclips-marketing/`.
* `junior-backend` → **manual** `railway up --service junior-backend
  --detach` from `junior-backend/`. GitHub source is disconnected on
  Railway intentionally.
* Desktop → **tag-triggered** CI via `desktop/scripts/ship.sh`. Main
  push does **not** ship desktop.

### Seed semantics

Both `junior-backend` seed scripts run automatically during lifespan
startup (since `d849b69`):
* `scripts/seed_community_channels.py` — 9 default rooms.
* `scripts/seed_uncle_daniel_campaigns.py` — 3 mission-lane rows.

Both upsert by slug; pre-existing values pasted via Admin HQ (e.g.
`whop_channel_id`) survive every redeploy. Do not attempt local seed
runs against production — the Railway `DATABASE_URL` uses
`postgres.railway.internal` which only resolves inside the Railway
private network.

### Brand kit + iron gates

* `IG-012` enforces brand-token parity between `desktop/src/index.css`
  and the demo HTML mirrors. Run
  `bash desktop/scripts/brand-kit-drift-check.sh` after any change
  that touches the token list.
* Iron gate sentinels (`IRON GATE IG-NNN`) are checked by the
  pre-commit hook. Never delete a sentinel without the documented
  override.

### Secret hygiene

* Never echo, `cat`, or `grep` raw secret values into chat output.
* If a secret must be shown, show only the first 4 characters + `…`.
* Mirrored credential files live in `~/.claude-credentials/`. After
  any rotation, sync to every mirrored location AND to Vercel /
  Railway env vars per the table in `DEPLOYMENT.md` §7.

### v0.7.55 live state (as of last update)

* account-app: READY at `account.liquidclips.app`
* marketing: READY at `liquidclips.app`
* backend: HEALTHY at `api.liquidclips.app`
* community channels: 9 (auto-seeded)
* campaigns: 10 (7 legacy + 3 Uncle Daniel funnel)
* desktop: not yet released (awaiting smoke-test sign-off)

Update this section every release; older values rot fast.
