# j004 · Connect Whop · Native Walk Prep

**Journey ID:** `j004-connect-whop`
**Capability:** `capability.identity-trust` / `capability.affiliate-revenue`
**Simulatable:** `false` — external OAuth dance (Whop authorize → callback) requires the OS browser + a real Whop account.
**Beta gate item satisfied:** *Whop refresh no-reload* + *Whop chip resolves to a live, non-Guest tier*.

---

## Purpose

Prove — end-to-end and reversibly — that a fresh Liquid Clips user can connect a Whop account through the shell's deep-link handoff, and that after the OS-browser round-trip completes, the app renders the correct tier chip without a manual reload.

The automated slice of this walk (Playwright) covers everything up to the moment the deep-link fires; the manual slice picks up in the OS browser + returns to the app.

---

## Prerequisites

### Credentials

- `INTERNAL_API_SECRET` — from `~/.claude-credentials/junior-internal.env`. Required by `scripts/rc1-beta/mint-jwt.sh` when seeding the pre-Whop user.
- `WHOP_API_KEY` — from `~/.claude-credentials/` (`whop-api-key.env` or `constellation.env`). NOT used by the walk directly · used by backend to satisfy `/auth/whop/*` routes.
- Whop test account credentials (email + password). See BC-006 note below on how to obtain one without polluting production tenant data.

### Test accounts

- One clean Whop membership on the `biz_0IMrpJRrTJID1u` company (Liquid Clips company) with the desired tier attached (Base or Agency). Use a spare @gmail alias so the account is disposable per-walk.
- One clean Liquid Clips backend user seeded via `scripts/rc1-beta/seed-fresh-user.sh`. This user starts with `identity_kind="email-local"` and NO Whop link.

### Env + processes

- Backend `junior-backend` running on `http://localhost:8000` (real `WHOP_API_KEY` in env).
- Frontend Vite dev on `http://localhost:5173`.
- Desktop 2 shell installed locally at `~/Applications/Liquid Clips.app` if the walk exercises the `liquidclips://` deep link path.
- macOS default browser set (Safari, Chrome, or Arc). The walk records which browser was used so a Whop-side race can be attributed later.

### Test files

- N/A · this journey does not upload media.

### State

- SQLite dev DB reset via `scripts/rc1-beta/reset-test-env.sh` before every walk. This ensures the fresh user has no prior Whop link.

---

## Step-by-step walk

### Step 1 · Seed fresh user (automated)

Run `scripts/rc1-beta/seed-fresh-user.sh` with a unique clerk_user_id like `user_walk_j004_$(date +%s)`. This POSTs to `/desktop/connect` with the internal secret and returns a fresh 1008-char Ed25519 JWT. Write the JWT into localStorage via the Playwright harness (or paste into `activation.dev.setToken` in dev mode).

**Automated?** Yes · covered by Playwright `j004-whop-oauth.spec.ts` `beforeAll`.

### Step 2 · Boot app · confirm Guest → non-Guest post-JWT

Load `http://localhost:5173/`. Observe TopHud identity chip. Before JWT seed → `data-identity-kind="email-local"` (or `"pending"` mid-hydration). After JWT seed + reload → `data-identity-kind` in the ladder set (handle | lc-id | email-local). **Never `"Guest"`** — this is INV-001.

Capture: screenshot, `canonical-state.json` from `window.__LCOS_PROBE__.canonicalState()`, telemetry buffer.

**Automated?** Yes.

### Step 3 · Navigate to Settings · Whop Sync panel

Design-OS route: click Console Nav → Settings, then click "Whop Sync" tab (`whop-sync` in `Settings.tsx` tab set).

Assert:
- `WhopStatusChip` shows `data-whop-state="not_connected"` OR the copy `"Not connected"`.
- Button `[data-testid="whop-connect"]` (or the button whose text is "Connect Whop") is present + enabled.
- No stale-tier state leaking (should be default `Base` or unresolved).

Capture: screenshot, canonical state.

**Automated?** Yes.

### Step 4 · Click "Connect Whop" · deep-link handshake

Frontend calls `handleConnectWhop` (Settings.tsx:349). This:
1. Generates a random challenge string.
2. Opens `${lcBackendUrl()}/auth/whop/start?challenge=<c>` in the OS browser via `@tauri-apps/plugin-shell`'s `open` command.
3. Records `connectingWhop=true` state locally.

Assert (automated portion):
- Backend receives the `/auth/whop/start` request and returns a redirect URL to Whop's `authorize` endpoint.
- Playwright cannot follow the redirect further — it hits the external Whop domain and Playwright's context does not have the Whop session.
- Assert the "Continue in browser" copy is visible in-app while the OS browser opens.

**Automated?** UP TO the click. Beyond → `test.skip` in Playwright spec.

### Step 5 · Complete Whop OAuth (MANUAL)

In the OS browser:
1. Sign into Whop with the test account.
2. Grant the Liquid Clips Whop app the requested scopes.
3. Whop redirects back to `${JUNIOR_BACKEND}/auth/whop/callback?code=…&state=…`.
4. Backend exchanges the code for a Whop access token, extracts the user's tier from `/api/v2/memberships` (Whop API scope map: `liquidclips-whop-api` skill), and stores tier in `state.current-user.whop_link` + `state.current-user.tier`.
5. Backend fires `liquidclips://activate?token=<jwt>&challenge=<c>&source=whop` deep link.
6. macOS resolves `liquidclips://` to the installed shell; shell fires `useEvent("deep-link:activate")`.

Capture (manual):
- Screen recording of the browser round-trip (QuickTime screen capture is fine).
- Backend log slice showing `/auth/whop/callback` 302 + tier extraction line (grep `[auth.whop.callback]`).
- SQLite dump: `SELECT clerk_user_id, tier, whop_username, whop_user_id FROM users WHERE clerk_user_id = 'user_walk_j004_<ts>';`.

### Step 6 · Deep-link returns app to foreground · assert tier flip WITHOUT reload

Back in the running app (which was never quit):
1. App receives `deep-link:activate` event.
2. `useMe.ts` hydration re-fires; `WhopStatusChip` re-reads `me.whop_link_state`.
3. Chip flips from `"not_connected"` → `"connected"` in ≤ 1s.
4. Tier chip on TopHud flips from `Base` → `Agency` (or whatever the test tier is).
5. **NO WHITE FLASH · NO ROUTE REMOUNT · NO MANUAL Cmd+R** — this is the "Whop refresh no-reload" beta gate.

Assert (manual + partial automated):
- `data-whop-state="connected"` is present on the chip.
- No route mount count changed (dev probe tracks route mounts if wired · otherwise compare video timestamps).
- Telemetry buffer contains `whop_connect_completed` topic (once the topic is registered — see gap below).

Capture: screenshot of connected state, telemetry buffer, backend log tail showing the callback + subsequent `/me` call from the app.

**Automated?** Partial — the deep-link fire cannot be simulated inside Playwright's browser context because it targets the native shell URL scheme. The chip flip assertion CAN be automated once the walk manually pastes the JWT + fires `bus.emit("auth:whop-linked")` to shortcut the deep-link path.

### Step 7 · Reversibility · disconnect + reconnect

Not required for the beta gate but valuable regression:
1. Settings → Whop Sync → Disconnect (button copy: "Disconnect Whop"). Confirm chip returns to `"not_connected"` without reload.
2. Repeat step 4-6. Confirm the tier flips back without cross-run state bleed.

---

## Expected capture artifacts per step

| Step | screenshot | canonical-state | telemetry | backend.log | DB snapshot |
|---|---|---|---|---|---|
| 1 seed | — | — | — | ✅ (mint) | ✅ (fresh user row) |
| 2 boot | ✅ | ✅ | ✅ | — | — |
| 3 settings | ✅ | ✅ | ✅ | — | — |
| 4 handshake click | ✅ | ✅ | ✅ | ✅ (`/auth/whop/start`) | — |
| 5 whop OAuth (manual) | ✅ (browser video) | — | — | ✅ (`/auth/whop/callback`) | ✅ (whop link written) |
| 6 chip flip | ✅ | ✅ | ✅ | ✅ (`/me`) | ✅ (tier read) |
| 7 disconnect | ✅ | ✅ | ✅ | ✅ | ✅ (whop link cleared) |

All artifacts land under `lcos/reports/golden-path/capture/j004-connect-whop/<NN-step>/` following the golden-path harness convention.

---

## Pass / fail criteria

| # | Criterion | Pass | Fail |
|---|---|---|---|
| P1 | Fresh user has no `whop_link` row before step 4 | ✅ if SQLite `whop_username IS NULL` | ❌ if any whop_* field is non-null |
| P2 | Step 4 click opens exactly one OS-browser tab · not an in-app webview | ✅ if Tauri `plugin-shell` fires and browser process observed via `pgrep` | ❌ if in-app webview navigation is used |
| P3 | Step 5 backend callback returns 302 to `liquidclips://activate?...` | ✅ if HTTP 302 + Location header contains the scheme | ❌ if 500 or missing header |
| P4 | Step 6 chip flips within 1 second of deep-link | ✅ if `data-whop-state` transitions before next tick | ❌ if manual reload required (BUG-004 / BUG-008 regression) |
| P5 | Body never renders "Guest" anywhere in the walk | ✅ if INV-001 held every step | ❌ any "Guest" render is a P0 |
| P6 | Tier chip matches `state.current-user.tier` from `/me` after step 6 | ✅ byte-identical value at the chip vs the JSON body | ❌ divergent value (BC-002) |
| P7 | Telemetry contains `whop_connect_started` + `whop_connect_completed` topics | ✅ both present in ring buffer | ❌ either missing (INV-011 gap · not blocking beta) |
| P8 | Zero `error` / `warn` lines with `whop` in backend log during the walk | ✅ log clean | ❌ any `whop` error = investigate |

Overall pass = P1 through P6 all pass. P7 + P8 are informational (log-level gaps).

---

## Known gaps · what cannot be automated

1. **The Whop authorize page itself.** Whop's login page runs on their domain; Playwright would need Whop-side credentials management + likely blocked by their bot detection. **Manual required.**
2. **The OS default browser open.** Tauri `plugin-shell::open` cannot be intercepted from JS in a way the walk can assert; the walk records the click + expects the manual watcher to confirm the browser opened.
3. **The `liquidclips://` deep-link resolution.** macOS URL scheme handoff is native; no Playwright hook exists. Simulatable inside the app via `bus.emit("deep-link:activate", {...})` in dev mode, but that skips the OS-level round-trip. Manual step required for the beta receipt.
4. **BC-006 · Same-worktree state.** If multiple agents run walks in parallel against the same backend, Whop link writes will collide. Serialise walks or scope by clerk_user_id.
5. **BUG-012 relationship (native).** This journey does not directly touch runtime hot-swap, but if the walk runs AFTER a runtime update without a quit+relaunch, the Whop tier resolver may read a stale bundle asset. See `j015-runtime-update.md` for the interaction note.

---

## Beta gate impact

Satisfies:
- ✅ *Whop refresh no-reload* — proven by P4.
- ✅ *No auth Guest* — proven by P5 across all steps.
- ✅ *Whop chip resolves to a live, non-Guest tier* — proven by P6.

Does NOT satisfy:
- ⏭ *Wallet / Affiliate / Payout agree* — separate journey (C2's Wallet journey).
- ⏭ *Real campaign ID* — separate journey (C3's campaign submit).

---

## Rollback / reversal

To reverse a walk:
1. `scripts/rc1-beta/reset-test-env.sh` wipes the SQLite dev DB.
2. In Whop admin (manual) revoke the test-user membership from the company. This prevents test data leaking to production dashboards.
3. Delete the JWT from `~/Library/Application Support/app.liquidclips.desktop/lc.license.jwt.v1` (or via localStorage clear).
4. Kill any lingering `junior-backend` uvicorn worker if it holds a stale Whop-token cache.

---

## Cross-references

- Backend routes: `junior-backend/app/routes/auth.py` (grep for `whop`), `/auth/whop/start`, `/auth/whop/callback`.
- Frontend entry point: `desktop-2/src/design-os/routes/Settings.tsx:349` (`handleConnectWhop`).
- Whop API map: `~/.claude/skills/liquidclips-whop-api/SKILL.md`.
- Related bugs: BUG-004 (Whop CTA source-of-truth · fixed A2), BUG-008 (tier propagation · fixed A2), BUG-014 (tier chip · fixed A2). All FIXED_UNPROVEN pre-Train-C · this walk PROVES them.
