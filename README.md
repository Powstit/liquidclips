# Liquid Clips (formerly Junior / JNR Employee Pro)

Mac desktop app that turns long-form video into ready-to-post short clips with animated captions, social publishing, and a built-in affiliate flywheel.

> Code-name `jnr` / `junior-desktop` in the source tree. Public brand: **Liquid Clips**. Bundle identifier: `app.liquidclips.desktop`. See [`liquid_clips_rebrand.md`](https://github.com/Powstit/Jnr-employee) commit notes for the 2026-05-28 rebrand.

## What lives where

| Folder | Purpose |
|---|---|
| `desktop/` | Tauri 2 macOS app — React 18 + TS frontend, Rust shell, Python sidecar |
| `junior-backend/` | FastAPI on Railway — license JWTs, webhooks (Clerk/Whop/Stripe), Ayrshare proxy, tier resolution |
| `account-app/` | Next.js — account.jnremployee.com — auth, subscription self-serve, pricing |
| `partner-app/` | Next.js — partner.jnremployee.com — affiliate dashboard |
| `simulator/` | Web preview demo (mock sidecar, localStorage) |
| `updates-proxy/` | Release artifact staging |
| `marketing/` | Marketing assets (separate `liquidclips-marketing` repo planned per COMPLETION_SPRINT.md) |
| `docs/` | Specs, handoff notes, release docs |

## Build status

- **Desktop:** v0.4.43 latest installed locally, properly Apple-signed via Developer ID Application (`KT68NGT4LX`). Not yet notarized — see COMPLETION_SPRINT.md item #1.
- **Backend:** Live at `junior-backend-production.up.railway.app` + `api.jnremployee.com`. Ayrshare publishing path live.
- **Account-app:** Live at `account.jnremployee.com`.
- **CI:** `.github/workflows/release.yml` configured but blocked on cert + xattr issue — see COMPLETION_SPRINT.md item #9.

## Working on this with multiple AI agents?

- Master sprint spec: `~/Desktop/COMPLETION_SPRINT.md` (local to Daniel's machine)
- File locks: [`SPRINT_LOCKS.md`](./SPRINT_LOCKS.md)
- End-of-session handoff: [`SPRINT_HANDOFF.md`](./SPRINT_HANDOFF.md)

## Sub-project guides

- Desktop: [`desktop/CLAUDE.md`](./desktop/CLAUDE.md)
- Backend: [`junior-backend/CLAUDE.md`](./junior-backend/CLAUDE.md)
- Account-app: [`account-app/CLAUDE.md`](./account-app/CLAUDE.md)
- Partner-app: [`partner-app/CLAUDE.md`](./partner-app/CLAUDE.md)
