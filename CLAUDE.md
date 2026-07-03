# Liquid Clips — repo root agent guide

This file orients any AI agent (or human) working across the whole
Liquid Clips system. Surface-specific guides live in each project's
own `CLAUDE.md`; this root file owns the cross-cutting rules.

## Read these first, in order

1. **`SELF_ONBOARDING_RELEASE_MASTER.md`** — current highest-priority
   self-onboarding release gate. Execute Steps 2–9 in order, generate the
   required proof receipt for each step, and do not push, deploy, tag, or resume
   marketing until Cohort 0 is explicitly approved by Daniel.
2. **`CLAUDE_DESKTOP2_RELEASE_MASTER.md`** — temporary Desktop 2 repair and
   release-readiness handoff. It is subordinate to the self-onboarding gate
   while that gate is active.
3. **`CLAUDE_DESKTOP2_UI_MASTER.md`** — approved Desktop 2 visual direction,
   responsive behaviour, implementation order, and evidence gates. It is
   subordinate to the release master and does not authorize deployment.
4. **`DEPLOYMENT.md`** — single source of truth for shipping any
   surface (account-app, marketing, backend, desktop). Replaces all
   prior memory about which surface auto-deploys vs which needs a
   manual CLI. **If memory disagrees with `DEPLOYMENT.md`, this file
   wins.**
5. **`desktop/CLAUDE.md`** — desktop app (Tauri + Python sidecar)
   architecture, iron gates, build commands.
6. **`account-app/CLAUDE.md`** — Next.js 16 account / embed app.
7. **`junior-backend/CLAUDE.md`** — FastAPI backend on Railway.

## Cross-cutting rules

### Truthful completion gate — mandatory

Read and apply `~/.claude/skills/completion-discipline/SKILL.md` before every
status report and before using completion language such as **done, fixed,
complete, green, shipped, deployed, live, installed, verified, resolved,** or
**ready**.

Completion claims must name and prove the exact artifact and environment:

* Source code proves **on disk**, not built or visible.
* A successful build proves **built**, not installed or visually correct.
* Vite/dev proof does not prove the installed Tauri app.
* HTTP 200 proves reachability, not the changed feature.
* Anonymous 401 proves authentication, not cross-tenant isolation.
* Push, backend deploy, Vercel deploy, and desktop release are separate states.

After any mutation, report a table with: item, state, direct proof, regression
proof, and remaining gap. If direct or regression proof is missing, downgrade
the state and say exactly what remains. Never make Daniel type “prove”; evidence
collection and honest retraction are the agent's responsibility.

For UI changes, verify the requested element in the exact artifact Daniel is
viewing and inspect mount conditions plus CSS visibility rules. For security
claims, test the identities required by the claim (for tenant isolation,
authenticated A-versus-B). For deployment claims, record local SHA, remote SHA,
deployment ID, clean status, and a release-specific live behavior.

No claim of “fully live” is permitted while a required packaged/native smoke,
surface deployment, or requested journey remains unverified.

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
