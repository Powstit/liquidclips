# v0.7.32 + v0.7.33 Ship Ledger

**Locked:** 2026-06-09. **Owner:** Overseer (this terminal) tracks; Streams A/B/C/D execute.

**Definition of "shipped and perfect":**
- v0.7.32 + v0.7.33 tagged, CI green, draft release published, auto-updater serves new version, install works end-to-end.
- All lens-flagged P0/P1/P2 findings resolved (no known UI bugs).
- All 4 ship blockers (B1-B4) green per `SHIP_v0.7.32_BLOCKERS.md`.
- Visual walk over the 5 B2 surfaces returns "no regressions, brand coherent."

---

## Progress snapshot

**Overall: 30% complete · 70% to go · No known blockers**

| Phase | Weight | State | % done |
|---|---|---|---|
| 1. UI Impeccable Pass | 30% | ✅ DONE | 30% |
| 2. Build + Install (Stream A) | 10% | 🟡 PENDING | 0% |
| 3. 5-Surface Visual Walk (Stream D + Daniel) | 10% | 🟡 PENDING | 0% |
| 4. Whop OAuth smoke (Stream B + Daniel env work) | 5% | 🟡 PENDING | 0% |
| 5. ship.sh v0.7.32 (Stream A) | 10% | 🟡 PENDING | 0% |
| 6. Post-ship verify (Stream D D.3) | 5% | 🟡 PENDING | 0% |
| 7. v0.7.33 layer + ship (Overseer + Stream A) | 30% | 🟡 IN PROGRESS | ~5% (Sentry infra + AyrshareRateLimited + backoff column done; reconcile/sync/frontend wiring pending) |

---

## Phase 1 — UI Impeccable Pass ✅ DONE (30/30%)

Where we started this session vs where we are now.

**Started with:**
- LibraryCard 3-line chip stack regression (READY + IMPORTED + bottom overlay)
- Yellow palette `#EAB308 / #FACC15 / #7A5400` leaking across Pill primitive + FirstRun + bounty-fit
- Amber `#F59E0B` hardcoded across 11+ surfaces (ChannelRow, ChannelPicker, GridMasterToolbar, etc.)
- ~80 hardcoded `#DC2626` Tailwind arbitrary hex (no centralised token)
- AuroraBackground stripes layer (`repeating-linear-gradient` — explicit impeccable ban)
- Pill primitive used non-brand emerald/sky/yellow for success/info/warning
- Missing brand-system state tokens (`--color-danger`, `--color-warn`)
- No `text-wrap: balance` on h1-h3
- Stale file-header comments in LibraryCard.tsx
- No PRODUCT.md for the impeccable skill to anchor against

**Now (all DONE — tsc green, 0 non-brand Tailwind hex hits):**
- [x] LibraryCard calm-wall — ONE status chip TL (only when not-ready or source-missing), ONE bounty/reaction chip TR, persistent overlay + action row reverted to hover-only
- [x] `source_exists === false` branch restored (lens P1-002)
- [x] Imported + Archived provenance surfaced in hover meta line (lens P2-003)
- [x] Archived state — opacity-55 always (signal preserved at hover) (lens P2-007)
- [x] Pill — 6 brand-locked tones, visually distinct (lens P1-001): neutral / fuchsia / fuchsia-bright fill (success) / fuchsia-deep restraint (warning) / cyan-cool (info) / danger token
- [x] Yellow palette swept from FirstRun + bounty-fit
- [x] Amber `#F59E0B` swept across 12 files → `fuchsia-deep` (lens P1-005)
- [x] `[#DC2626]` / `[#F87171]` Tailwind arbitrary → `[var(--color-danger)]` / `[var(--color-danger-bright)]` across ~60 files (lens P2-006)
- [x] AuroraBackground stripes removed (CSS + component) + header comment updated (lens P2-004)
- [x] Brand state tokens added to `index.css`
- [x] `text-wrap: balance` on h1-h3, `text-wrap: pretty` on p
- [x] `PRODUCT.md` written (anchors impeccable skill)
- [x] Stale LibraryCard file-header comments updated to v0.7.32 reality
- [x] tsc green
- [x] ship-lens-reviewer dispatched + all findings addressed

**Verification:**
- `grep -rEn '\[#(F59E0B|EAB308|10B981|3B82F6)\]' src` → 0 hits
- `grep -rEn '\[#(DC2626|F87171)\]' src` → 0 hits
- `npx tsc --noEmit` → exit 0
- `grep -rn "IRON GATE" <touched files>` → 0 sentinel edits

---

## Phase 2 — Build + Install 🟡 PENDING (0/10%)

**Owner:** Stream A.
**Trigger:** Overseer pings A with "Phase 1 done — rebuild."

- [ ] Stream A bumps `package.json` + `tauri.conf.json` patch version (0.7.32 if not already)
- [ ] `npm run tauri build -- --bundles app` (LOCAL signed build — not CI release yet)
- [ ] `bash scripts/local-install.sh` atomic swap into `/Applications/Liquid Clips.app`
- [ ] `mdls -name kMDItemVersion "/Applications/Liquid Clips.app"` returns `0.7.32`
- [ ] Stream A reports up: "install done"

---

## Phase 3 — 5-Surface Visual Walk 🟡 PENDING (0/10%)

**Owner:** Stream D drives + Daniel walks.
**Trigger:** Stream A reports "install done."

- [ ] D.1 — pre-walk lens sweep on installed app (ship-lens phases + system-audit + iron-gate)
- [ ] Library tab — multi-platform ClipCard, no badge overlap, brand glyphs, calm-wall confirmed
- [ ] Workbench — ClipWindow top-right badge consistent
- [ ] Schedule → Channels — ch-row pattern, channel-stale override behaves
- [ ] Settings → Connections — ch-row consistent with Schedule
- [ ] Routes modal — ch-row, `isEffectivelyActive` gate behaves
- [ ] Snapshots captured + diffed against `docs/clip-dashboard-demo.html`
- [ ] Daniel posts "B2 green" OR returns specific regression
- [ ] If regression → return to Phase 1 → loop until green

---

## Phase 4 — Whop OAuth Smoke 🟡 PENDING (0/5%)

**Owner:** Stream B + Daniel's hands.
**Independent of Phase 2/3.**

- [ ] Daniel: Whop dashboard adds redirect URI `https://api.liquidclips.app/auth/whop/callback` to existing app `app_hLphExdFzjEQsM`
- [ ] Daniel: Railway sets `WHOP_OAUTH_CLIENT_SECRET` (junior-backend), redeploys
- [ ] Daniel: Vercel sets `NEXT_PUBLIC_WHOP_SIGNIN_ENABLED=true` + `NEXT_PUBLIC_WHOP_PRODUCT_AFFILIATE_URL=…` (account-app), redeploys
- [ ] Stream B: `curl https://account.liquidclips.app/connect-desktop | grep "Continue with Whop"` → hit
- [ ] Stream B: full OAuth round-trip on staging passes
- [ ] Stream B reports up: "B green"

---

## Phase 5 — ship.sh v0.7.32 🟡 PENDING (0/10%)

**Owner:** Stream A.
**Trigger:** Phase 3 green AND Phase 4 green AND Overseer authorises push.

- [ ] `cd ~/Desktop/jnr/desktop && bash scripts/ship.sh 0.7.32 "v0.7.32 — calm-wall LibraryCard, brand-pure Pill, channel-stale defensive override, Whop OAuth live"`
- [ ] ship.sh verifies live manifest pre-push (refuses to push if manifest stale)
- [ ] Tag push → GitHub Actions CI builds signed + notarized DMG
- [ ] Draft GH release published with .dmg / .dmg.sig / .app.tar.gz / .app.tar.gz.sig / latest.json

---

## Phase 6 — Post-ship Verify 🟡 PENDING (0/5%)

**Owner:** Stream D D.3.
**Trigger:** Phase 5 ship.sh succeeds.

- [ ] `curl https://api.jnremployee.com/updates/latest.json` returns `"version":"0.7.32"`
- [ ] `curl https://updates.liquidclips.app/latest.json` returns `"version":"0.7.32"`
- [ ] `curl https://liquidclips.app/download` DMG link points to v0.7.32
- [ ] `gh release view v0.7.32` published, all 5 assets present
- [ ] Auto-updater rehearsal: launch the previous installed app, confirm updater prompt shows v0.7.32

---

## Phase 7 — v0.7.33 layer + ship 🟡 IN PROGRESS (~5/30%)

**Owner:** Overseer (backend + frontend wiring) + Stream A (rebuild + ship).
**Can run in parallel with Phases 2-6, but ships AFTER v0.7.32.**

**Done (~5%):**
- [x] `sentry-sdk[fastapi]` added to `requirements.txt`
- [x] Sentry init in `app/main.py` (gated on `SENTRY_DSN` env var)
- [x] `sentry_dsn / sentry_environment / sentry_traces_sample_rate` settings in `app/config.py`
- [x] `AyrshareRateLimited` typed exception in `app/ayrshare.py` (inherits `httpx.HTTPStatusError`)
- [x] `_raise_for_status()` helper applied across 9 ayrshare call sites
- [x] `users.ayrshare_backoff_until` column migration in `main.py` lifespan

**Pending (~25% to go):**
- [ ] TTL cache on `reconcile_channels_against_ayrshare()` (30s per-user in-memory)
- [ ] Per-user backoff check + stamp on `AyrshareRateLimited` in channels.py reconcile
- [ ] `social_reconcile_status` field on `/sync` response (`"ok" | "deferred" | "rate_limited"`)
- [ ] Daniel: Railway sets `SENTRY_DSN` env var
- [ ] Frontend: "Syncing channels — try again in a minute" pill in Settings → ConnectionsChannelsList
- [ ] Frontend: wire `lc:channel-stale` listener (currently dispatched with no listener)
- [ ] Frontend: dedup `socialGetConnection()` via shared hook in Settings
- [ ] Stream A: bump → build → install → walk → `ship.sh 0.7.33`
- [ ] Post-ship verify (curl manifests + GH release)

---

## How to read this ledger

- **Update after every step.** When a checkbox closes, the phase % advances.
- **Phase weights add to 100% per ship cycle.** v0.7.32 = Phases 1-6 (70%). v0.7.33 = Phase 7 (30%).
- **Blockers:** if any phase reveals a regression that loops back to an earlier phase, mark "BLOCKED" + cite the regression. No silently moving on.
- **Overseer maintains this file.** Other streams report state changes up; overseer writes the checkbox.
