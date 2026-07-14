# Liquid Clips · Local Setup

For a new engineer joining the Nigerian dev team. Target: boot desktop-2 + backend + account-app locally in **15 minutes**.

Read this alongside [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md) and [`desktop-2/CLAUDE.md`](../CLAUDE.md) before writing any code.

---

## Prerequisites

- **Node 20+** and **npm 10+** (a `pnpm-lock.yaml` and `package-lock.json` both exist; npm is what CI uses).
- **Xcode command-line tools** on macOS: `xcode-select --install`.
- **Rust toolchain** (`rustup default stable`) — **only if you're touching the shell.** The shell is FROZEN, so most contributors never build Rust.
- **Python 3.12** for `junior-backend/` — pinned in `junior-backend/.python-version` to match Railway prod's Nixpacks image. Install via `brew install python@3.12`. The one-command bootstrap script `junior-backend/scripts/bootstrap-venv.sh` fails loudly with that install hint if a different interpreter is on PATH — no committed `.venv/`, no machine-specific symlinks.
- **Python 3.11+** — only if you're touching the sidecar under `desktop/python-sidecar/`.
- **Railway CLI** (`brew install railway`) — backend deploys.
- **Vercel CLI** (`npm i -g vercel`) — marketing + account-app deploys.
- **1Password CLI** (`brew install 1password-cli`) — optional, used by `scripts/dev-with-keys.sh` to inject OPENAI_API_KEY at boot.

## Clone

```bash
git clone https://github.com/Powstit/liquidclips.git ~/code/jnr
cd ~/code/jnr
```

Remote confirmed via `git remote -v` at repo root: `origin https://github.com/Powstit/liquidclips.git`.

## Install

Every surface has its own `node_modules` / `.venv`. Run each install in its own directory.

```bash
# Desktop frontend (Tauri 2 shell + Vite React)
cd ~/code/jnr/desktop-2 && npm install

# FastAPI backend · one-command reproducible venv
# (Python 3.12 pinned in .python-version to match Railway prod;
# script fails loudly with `brew install python@3.12` hint if missing.)
cd ~/code/jnr/junior-backend && bash scripts/bootstrap-venv.sh

# Next.js account app
cd ~/code/jnr/account-app && npm install
```

## Env vars — `.env.example` template names only

Do NOT commit real secrets. Mirror local secrets from `~/.claude-credentials/` (chmod 600) if you have them; otherwise ask Daniel for a fresh mint.

### `desktop-2/.env` (Vite reads `VITE_*` at build time)

Required for build (validated by [`scripts/assert-env.mjs`](../scripts/assert-env.mjs) — see [`required-env.json`](../required-env.json)):

- `VITE_CLERK_PUBLISHABLE_KEY` (shape `pk_live_…` or `pk_test_…`)
- `VITE_BACKEND_URL` (shape `https://…` or `http://…`) — default `https://api.liquidclips.app`

Optional (grepped from `src/**/*.ts` + `*.tsx`):

- `VITE_AGENCY_WELCOME_DISABLED`
- `VITE_GIT_SHA`
- `VITE_GOOGLE_OAUTH_CLIENT_ID`
- `VITE_GOOGLE_REDIRECT_URI`
- `VITE_LC_QA`
- `VITE_LIQUIDCLIPS_QA`
- `VITE_NOTIFICATIONS_API_BASE`
- `VITE_POSTHOG_KEY`
- `VITE_SENTRY_DSN`
- `VITE_WHOP_FOUNDER_PLAN_ID`

### `junior-backend/.env` (pydantic-settings)

Env-var names from [`app/config.py`](../../junior-backend/app/config.py) — full list documented there. Common ones for local dev:

- `DATABASE_URL` (defaults to `sqlite:///./junior-backend.db` — no Postgres needed locally)
- `PORT` (defaults `8000`)
- `JUNIOR_ENV` (`development` locally; `production` on Railway — fails closed if signature secrets missing)
- `CLERK_WEBHOOK_SECRET`, `CLERK_SECRET_KEY`
- `WHOP_WEBHOOK_SECRET`, `WHOP_API_KEY`, `WHOP_OAUTH_CLIENT_ID`, `WHOP_OAUTH_CLIENT_SECRET`
- `JWT_PRIVATE_PEM`, `JWT_PUBLIC_PEM` (auto-generated to `.junior-keys/` on first boot; do NOT commit)
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO`
- `AYRSHARE_API_KEY` (retired but still wired; may be empty)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `INTERNAL_API_SECRET` (Admin HQ proxy gate; must match account-app value)
- `POSTHOG_KEY`, `POSTHOG_HOST`

### `account-app/.env.local` (Next.js reads `NEXT_PUBLIC_*` at build time)

Names grepped from `account-app/src/`:

- `NEXT_PUBLIC_JUNIOR_BACKEND_URL`
- `NEXT_PUBLIC_WHOP_AGENCY_PLAN_ID`, `NEXT_PUBLIC_WHOP_GROWTH_PLAN_ID`, `NEXT_PUBLIC_WHOP_PRO_PLAN_ID`, `NEXT_PUBLIC_WHOP_SOLO_PLAN_ID`
- `NEXT_PUBLIC_WHOP_PRODUCT_AFFILIATE_URL`, `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED`
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- Server-only: `CLERK_SECRET_KEY`, `INTERNAL_API_SECRET`, `HQ_INTERNAL_SECRET`, `AGENCY_JWT_COOKIE_SECRET`, `CLAUDE_API_KEY`, `CLAUDE_AGENT_API_KEY`, `CLAUDE_ADMIN_API_KEY`, `OPENAI_API_KEY`, `ADMIN_ALLOWED_IPS`, `JUNIOR_ADMIN_EMAILS`, `AYRSHARE_API_KEY`, `POSTIZ_API_KEY`

## Dev workflow per surface

### Desktop — frontend HMR (default path for pure-frontend edits)

```bash
cd ~/code/jnr/desktop-2 && npm run dev
```

Vite HMR at **http://localhost:1420** (config: [`vite.config.ts`](../vite.config.ts) — port env override `VITE_DEV_PORT`). Full `tauri build` is **not** required for React / CSS / copy edits per the `feedback_use_tauri_dev_for_iteration` rule.

### Desktop — Tauri dev (only if you need native shell/sidecar behaviour)

```bash
cd ~/code/jnr/desktop-2 && npm run tauri:dev
```

Or with 1Password-injected OpenAI key: `bash scripts/dev-with-keys.sh`.

### Backend — local uvicorn

```bash
cd ~/code/jnr/junior-backend
.venv/bin/uvicorn app.main:app --reload --port 8000
```

First boot generates an Ed25519 keypair in `.junior-keys/`. Smoke: `curl http://localhost:8000/healthcheck` → `{status:"ok", ...}`. See [`junior-backend/CLAUDE.md`](../../junior-backend/CLAUDE.md) for the fake-Clerk webhook + license JWT mint recipes.

### Account app — Next.js dev

```bash
cd ~/code/jnr/account-app && npm run dev
```

Default URL **http://localhost:3000**. Middleware at `src/middleware.ts` owns the frame-header policy that keeps `/embed/earn` iframe-mountable from the desktop.

## Testing

Everything below runs from `desktop-2/`.

- **Type check:** `npx tsc -b`
- **Unit tests:** `npm test` (Vitest)
- **Targeted Playwright:** `PW_PORT=1420 npx playwright test tests/e2e/<spec>.spec.ts --reporter=list`
- **Full D1 sweep:** `PW_PORT=1420 npx playwright test --reporter=list` (~46 min · 56 specs)
- **Shell guard:** `bash scripts/assert-shell-contracts.sh` (or `npm run guard`)
- **Full invariant sweep:** `npm run test:invariant` (tsc + shell guard + brand-kit drift + agency-preview paywall gate + verify-app)

Playwright drives the Vite dev server on port 1420 by default. Set `PW_PORT` per worktree to avoid port collisions when running parallel agents (config: [`playwright.config.ts`](../playwright.config.ts)).

## Builds

- **`npm run build`** — vite production build only (~30s). Safe.
- **`npm run tauri build`** — full native rebuild + codesign + notarise. **5–13 min.** Do NOT auto-trigger. Batch all fixes first, land ONE build. Never rebuild per edit. See the `feedback_batch_fixes_before_build` and `build-gate` skill rules.
- **`bash scripts/runtime-ship.sh <channel> <version>`** — ships a frontend hot-swap bundle without reinstalling the .app. See [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md) § "Runtime update flow".
- **`bash desktop/scripts/ship.sh <version> "notes"`** — the ONLY sanctioned way to cut a public desktop release. Never hand out DMGs manually.

## Shell contracts

- Iron-gate sentinels (`IRON GATE IG-NNN`) are enforced by the pre-commit hook. **Never delete a sentinel** without the documented override. Registry: `desktop/docs/IRON_GATES.md`.
- Brand-token drift is caught by [`scripts/brand-kit-drift-check.sh`](../scripts/brand-kit-drift-check.sh) — hex changes in `src/brand/brandTheme.css` must land the same PR as the marketing site mirror.
- Shell identity (`liquid-clips-shell`, `app.liquidclips.desktop`, product name `Liquid Clips`), route file presence, Kade poses, brand assets, and honesty strings are all guarded by [`scripts/assert-shell-contracts.sh`](../scripts/assert-shell-contracts.sh).

## QA reports

- Playwright outputs → `desktop-2/test-results/` + `desktop-2/playwright-report/`.
- Gate-run logs → `desktop-2/lcos/reports/` (constellation engine + ship-lens receipts).
- Boot baselines → `desktop-2/tests/e2e/boot-baseline-*.json` (one per timestamp).

## Dropbox for large assets

Team folder root: **`Dropbox: /Liquid Clips/RC1 Handover/`**.

Use Dropbox (not the repo) for:
- Original brand-kit source files (Illustrator / Figma exports)
- Mockup PNGs > 500KB
- Founder video walkthroughs (`public/brand/founder/*.mp4` — the shipped mp4 lives in-repo; the raw source stays in Dropbox)
- Screen recordings of QA sessions

Hydration warning: never batch-open Dropbox stubs in QuickTime + AppleScript close-all on macOS 26.6 — use Finder "Make Available Offline" or `qlmanage -p`.

---

## First-day checklist

Actual sequence to boot everything and see the app.

1. `git clone https://github.com/Powstit/liquidclips.git ~/code/jnr && cd ~/code/jnr`
2. `cd desktop-2 && npm install` (~2 min)
3. `cd ../junior-backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt` (~3 min)
4. `cd ../account-app && npm install` (~2 min)
5. Populate `.env` files per section above. Ask Daniel for the credentials pack if you can't mirror from `~/.claude-credentials/`.
6. Terminal 1 — backend: `cd ~/code/jnr/junior-backend && .venv/bin/uvicorn app.main:app --reload --port 8000`
7. Terminal 2 — smoke backend: `curl http://localhost:8000/healthcheck` → expect `{status:"ok", ...}`
8. Terminal 3 — desktop frontend: `cd ~/code/jnr/desktop-2 && npm run dev` → open http://localhost:1420
9. Terminal 4 — account-app: `cd ~/code/jnr/account-app && npm run dev` → open http://localhost:3000
10. Run the shell guard: `cd ~/code/jnr/desktop-2 && npm run guard` → expect `Shell guard: N passed, 0 failed`.
11. Run one Playwright spec end-to-end to confirm test infra works: `PW_PORT=1420 npx playwright test tests/e2e/cold-start-fresh.spec.ts --reporter=list`
12. Open `docs/mockups/approved/` and skim one money-surface mockup so you know what "money surface" looks like before you touch one.
13. Read [`ARCHITECTURE_MAP.md`](./ARCHITECTURE_MAP.md) + [`desktop-2/CLAUDE.md`](../CLAUDE.md).

---

## Verification checklist

Files inspected while drafting this doc:

- `/Users/dipdip/code/jnr/desktop-2/CLAUDE.md`
- `/Users/dipdip/code/jnr/desktop-2/package.json`
- `/Users/dipdip/code/jnr/desktop-2/vite.config.ts`
- `/Users/dipdip/code/jnr/desktop-2/playwright.config.ts`
- `/Users/dipdip/code/jnr/desktop-2/required-env.json`
- `/Users/dipdip/code/jnr/desktop-2/scripts/assert-env.mjs`
- `/Users/dipdip/code/jnr/desktop-2/scripts/dev-with-keys.sh`
- `/Users/dipdip/code/jnr/desktop-2/scripts/assert-shell-contracts.sh`
- `/Users/dipdip/code/jnr/desktop-2/scripts/brand-kit-drift-check.sh`
- `/Users/dipdip/code/jnr/desktop-2/scripts/runtime-ship.sh`
- `/Users/dipdip/code/jnr/desktop-2/src/` (env-var grep)
- `/Users/dipdip/code/jnr/desktop-2/tests/e2e/` (spec count)
- `/Users/dipdip/code/jnr/DEPLOYMENT.md`
- `/Users/dipdip/code/jnr/junior-backend/CLAUDE.md`
- `/Users/dipdip/code/jnr/junior-backend/app/config.py`
- `/Users/dipdip/code/jnr/junior-backend/requirements.txt`
- `/Users/dipdip/code/jnr/account-app/src/` (env-var grep)
- `git remote -v` (verified `origin https://github.com/Powstit/liquidclips.git`)
