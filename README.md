# Liquid Clips

Mac desktop app that helps clippers turn long-form video into short posts
and earn from Whop bounties. Local processing, honest telemetry, agency-tier
subscription.

**Current certified state**: commit `e446ddb7` · runtime `v2.2.36` · tag `rc1-dev-handover-2.2.36` · D1 138 pass / 0 fail / 32 documented skips.

---

## Read first (dev team onboarding)

Start here → **[desktop-2/docs/DEV_TEAM_HANDOVER.md](./desktop-2/docs/DEV_TEAM_HANDOVER.md)**

That index walks you through the 12-document handover pack in order.
The short version:

1. [Product overview](./desktop-2/docs/PRODUCT_OVERVIEW.md) — what Liquid Clips is
2. [Architecture map](./desktop-2/docs/ARCHITECTURE_MAP.md) — how it fits together (Mermaid)
3. [Feature inventory](./desktop-2/docs/FEATURE_INVENTORY.md) — the matrix
4. [Local setup](./desktop-2/docs/LOCAL_SETUP.md) — clone → boot in 15 min
5. [Test + release runbook](./desktop-2/docs/TEST_AND_RELEASE_RUNBOOK.md) — how to ship
6. [Known issues + debt](./desktop-2/docs/KNOWN_ISSUES_AND_DEBT.md) — nothing hidden
7. [Ownership + escalation](./desktop-2/docs/OWNERSHIP_AND_ESCALATION.md) — who owns what
8. [HQ + Codex operating model](./desktop-2/docs/HQ_CODEX_OPERATING_MODEL.md)
9. [HQ integration spec](./desktop-2/docs/HQ_INTEGRATION_SPEC.md)
10. [Codex guardrails](./desktop-2/docs/CODEX_GUARDRAILS.md)
11. [Self-healing roadmap](./desktop-2/docs/SELF_HEALING_ROADMAP.md)
12. [Self-extending roadmap](./desktop-2/docs/SELF_EXTENDING_ROADMAP.md)

Then [HANDOVER_SUMMARY.md](./desktop-2/docs/HANDOVER_SUMMARY.md) for week-1 tasks.

---

## Repo structure

| Folder | Purpose | Deploy |
|--------|---------|--------|
| `desktop-2/` | **Current** Tauri 2 shell + React runtime (v2.2.36) — the app users install | Tag-triggered CI (`desktop/scripts/ship.sh`) |
| `desktop/` | **Legacy** desktop (v0.7.x) — many primitives referenced by desktop-2 via `src/lib/*` ports | Not deployed |
| `junior-backend/` | FastAPI on Railway — auth, license JWTs, webhooks, HQ endpoints | Manual `railway up --service junior-backend` |
| `account-app/` | Next.js 16 · `account.liquidclips.app` — sign-in, subscription, HQ admin | Manual `vercel deploy --prod` |
| `liquidclips-marketing/` | Next.js · `liquidclips.app` — marketing site | Manual `vercel deploy --prod` |
| `lcos/` | Liquid Clips Ops — proof pack, reports, gate scripts | N/A |
| `docs/` (root) | Cross-cutting docs including [DEPLOYMENT.md](./DEPLOYMENT.md) | N/A |

**Which desktop repo?** Always `desktop-2/`. See [`liquid_clips_version_naming`](./desktop-2/CLAUDE.md) — everything with `-2` is the current shell.

---

## Setup + key commands

**Full local setup instructions**: [desktop-2/docs/LOCAL_SETUP.md](./desktop-2/docs/LOCAL_SETUP.md).

Quick reference:

```bash
# Desktop frontend dev (Vite HMR, pure-frontend edits)
cd desktop-2 && npm install && npm run dev
# → http://localhost:1420

# Type check
cd desktop-2 && npx tsc -b

# Unit tests
cd desktop-2 && npm test

# Targeted E2E spec (default port 1420; override PW_PORT for worktrees)
cd desktop-2 && npx playwright test tests/e2e/<spec>.spec.ts --reporter=list

# Full D1 sweep (~46 min)
cd desktop-2 && npx playwright test --reporter=list

# Shell contract guard
cd desktop-2 && bash scripts/assert-shell-contracts.sh
```

---

## Shell restriction

**The Tauri shell is FROZEN.** No `src-tauri/**` edits, no `tauri.conf.json`
changes, no new deps in `desktop-2/package.json` without written approval
from Daniel. All UI work lands as pure-frontend runtime edits. Runtime
bundle hot-swaps via the update manifest — no Apple notarization needed
for content changes. Full rationale in [ARCHITECTURE_MAP.md](./desktop-2/docs/ARCHITECTURE_MAP.md).

---

## Sub-project agent guides

- [Root `CLAUDE.md`](./CLAUDE.md) — cross-cutting rules
- [`desktop-2/CLAUDE.md`](./desktop-2/CLAUDE.md) — current desktop (READ FIRST)
- [`desktop/CLAUDE.md`](./desktop/CLAUDE.md) — legacy desktop (primitive reference only)
- [`junior-backend/CLAUDE.md`](./junior-backend/CLAUDE.md) — backend
- [`account-app/CLAUDE.md`](./account-app/CLAUDE.md) — account + HQ admin

---

## Certified state at handover

See [`AUTOMATED_RELEASE_STATE.md`](./desktop-2/AUTOMATED_RELEASE_STATE.md) —
the single source of truth for gate results at commit `e446ddb7`.
