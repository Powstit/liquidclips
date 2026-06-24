# HQ Build · Session Resume

**Date:** 2026-06-24
**Session id:** d11d2b24-4ee6-48c4-8d62-09daf0dac363
**Final main HEAD:** `f8c2030` (5 HQ-build branches merged + 2 patches)

## How to resume this exact conversation

```bash
claude --resume d11d2b24-4ee6-48c4-8d62-09daf0dac363
# or simply: claude --continue
```

If those flags don't surface this session, run `claude` and start with:
> "Continue HQ build session. See HQ_SESSION_RESUME.md at repo root."

## What's been built (all merged on main, LOCAL ONLY — no push, no deploy)

| Agent | Surface | Commit |
|---|---|---|
| 1 · Security Gate | `middleware.ts` IP allowlist (404 fail-closed) + 5-email allowlist + 2FA enforcement + recovery exemption | `9f30811` |
| 2 · Brand Pass | 28 admin tabs → Liquid Clips tokens via `_brand/tokens.css` + `AdminBrandHeader` | `50fd707` |
| 3 · Mgmt Gaps | 11 admin endpoints (refund / ban / tier-change / agent kill/restart/rotate / campaign CRUD / sales feed / audit log) + 2 new tables (AdminAuditLog, AgentPersona) | `70f55d2` |
| 4 · AI Terminal MVP | Claude-only read-only terminal at `/admin/ai-terminal` + cost guard ($0.50/run, 50k input tokens, 30 req/hr) | `d724b8f` |
| 5 · Recovery Flow | 3-of-5 emails + PIN + auth code, IP fast-path (allowlisted IP → PIN only), bcrypt hashes, 3 attempts/24h/IP, fresh TOTP issued on success | `1b676d9` |

## Conflict resolutions (manual, in main thread)

- `junior-backend/app/main.py` — preserved all original router imports (agency_campaigns, carrot, me_lifetime_views, campaign_asset_links) AND added admin_mutations + admin_recovery
- `junior-backend/app/models.py` — preserved ExternalCredential, CampaignAssetSource, AssetSourceIngestionJob, CampaignAssetLink AND added 4 new tables

## Env vars Daniel must set before HQ becomes reachable (Vercel + Railway)

```
ADMIN_ALLOWED_IPS=<csv of your home IP, Tailscale mesh IP, mobile hotspot IP>
JUNIOR_ADMIN_EMAILS=danieldiyepriye@gmail.com,mrddokubo@gmail.com,crazycatjackkids@gmail.com,thedoks2019@gmail.com
CLAUDE_ADMIN_API_KEY=<Anthropic console key for AI Terminal>
```

Removed (do NOT re-set):
- `ADMIN_MASTER_EMAILS` — DELETED in P0-001. Single allowlist is now
  `JUNIOR_ADMIN_EMAILS`, read by both frontend (`@/lib/admin-allowlist`)
  and backend (`features.is_admin_email` + `admin_recovery._master_email_list`).
- `RECOVERY_PIN_HASH` / `RECOVERY_AUTH_CODE_HASH` — DELETED in P1-006.
  Set PIN + auth code via the HQ Security Gate UI (`/admin/_security/PinSetup`
  and `/admin/_security/AuthCodeSetup`); the bcrypt hashes are persisted to
  the `admin_recovery_config` singleton row. Until set, `/verify` fails
  closed — that's intentional (no PIN configured = no recovery possible
  = no stale env-var backdoor).

(Empty `ADMIN_ALLOWED_IPS` = fail-closed = `/admin/*` returns 404 from every IP. That's the safe default. IP source is the SIGNED `x-vercel-forwarded-for` header per P1-005, not the spoofable `x-forwarded-for`.)

## What was running in background when session ended

- `npm run verify-app` (desktop-2 Playwright + aggregator) — background ID `bj18wqbef`
- `ship-lens-reviewer` agent over HQ scope — agent ID `ae8c292aa36b7d737`

Both die with the process. If session is interrupted, re-run:
```bash
cd /Users/dipdip/code/jnr/desktop-2 && npm run verify-app
```
And re-dispatch ship-lens via the Agent tool.

## Verified manually before background tasks fired

- ✅ Backend `from app.main import app` → 161 routes, 44 admin routes registered
- ✅ All 4 new HQ tables in models.py (AdminAuditLog, AgentPersona, AdminRecoveryConfig, AdminRecoveryAttempt)
- ✅ All 4 original v2 tables preserved (ExternalCredential, CampaignAssetSource, AssetSourceIngestionJob, CampaignAssetLink)
- ✅ Frontend `npx tsc --noEmit` green
- ✅ `@anthropic-ai/sdk@0.105.0` installed in account-app

## Iron Gate sentinels added (pre-commit hook will enforce)

- `IG-HQ-001` — admin IP gate in `middleware.ts`
- `IG-HQ-002` — brand tokens in `_brand/tokens.css`
- `IG-HQ-003` — AI Terminal route in `api/admin/ai/run/route.ts`

## Pending (per task list, not yet done)

- #91 Whop submission POST scope
- #92 Settings page completion
- #93 First-run tile-tour
- #105 Refactor agent scaffold (WHOP_AGENT_PERSONAS not 100 keys)
- #107 Whop main-lead on /connect-desktop
- Phase D · Full AI Terminal (Claude + Codex + Kimi, action buttons, cost dashboard)
- Push / deploy decision (BLOCKED on Daniel's review + greenlight)

## Hard constraints carried into next session

- Stay LOCAL — no push, no deploy until Daniel signs off
- Backend env vars must be set before `/admin/*` works
- IP gate is fail-closed by design
- Recovery is the break-glass — exempt from IP gate, but rate-limited 3/24h/IP
- AI Terminal API keys go in Vercel env (`CLAUDE_ADMIN_API_KEY`), never in code
