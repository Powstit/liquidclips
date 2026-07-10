# MAX_REPORT_phase-1 · Cold Entry Mode B completion

**Branch:** `phase1/cold-entry-mode-b-completion`
**Base:** `integration/cold-entry-mode-b @ ae858be`
**Status:** LOCAL only. No push, no deploy, no runtime publication. All commits stay in the worktree until Daniel greenlights push.

---

## 1. Commit SHAs

| # | SHA | Summary |
|---|---|---|
| 1 | `20e6ef9` | fix(learn): LearnTab typed state union + data-state exposure (P1-001) |
| 2 | `1447de5` | fix(hq/journey-map): derive money-surface pipeline+surface_type+mockup by citation basename (P1-002) |
| 3 | `04ec794` | fix(shell): wrap section shell mounts in Watchdog + EngineErrorBoundary (P1-003) |
| 4 | `f62cec3` | fix(catalog): delete DEMO_TILES fixture · honest empty state (P1-004) |
| 5 | `377411f` | feat(browse): mount InAppBrowser chrome inside BrowseOverlay (P1-005) |
| 6 | `1df4b57` | chore(wallet): delete unused useWalletSummary shared cache (P1-006) |
| 7 | `d3f5fb9` | chore(purge): remove SyncMailMoneyDrop DEMO_ROSTER + DEMO_CLIPS fixtures |
| 8 | `1d6c778` | chore(settings): remove Devices/Notifications/Streaks tabs completely |
| 9 | `fb9b656` | chore(purge): 7-category sweep · Cat 2 dead buttons + Cat 4 coming-soon |
| 10 | `8e4f564` | feat(backend): /admin/launch-war-room/summary endpoint |
| 11 | `186b2cb` | feat(hq/war-room): dual-signal Launch War Room · 16 systems · build + live health |

---

## 2. Per-P1 resolution

| P1 | File(s) | Fix summary | Grep proof |
|---|---|---|---|
| **P1-001** LearnTab has no 3+-state exposure | `desktop-2/src/routes/learn/LearnTab.tsx` | Added typed union `type LearnCardState = "idle" \| "playing" \| "focused" \| "error"`; wired `hasError` off `<video onError>`; threaded `data-state={cardState}` onto `.lt-card` | `grep -n "data-state={cardState}" desktop-2/src/routes/learn/LearnTab.tsx` → hit at line 205; `grep -n "type LearnCardState" desktop-2/src/routes/learn/LearnTab.tsx` → hit at line 138 |
| **P1-002** JourneyMap metadata mis-tags 7 money surfaces | `account-app/src/components/admin/JourneyMapTab.tsx` | Added `MONEY_SURFACE_ROUTES` table (7 route dirs → 7 mockup slugs) + `moneySurfaceMockupFor()`; `enrichJourney()` now forces `pipeline="section"` + `surface_type="money"` + `mockup_path` when the citation matches. Added explicit `mo-20 → cold-email-preview-embed-card` mapping so EmbedPreviewCard is addressable. | `grep -n "MONEY_SURFACE_ROUTES\|moneySurfaceMockupFor" account-app/src/components/admin/JourneyMapTab.tsx` → hits at ~lines 105, 118, 165, 167 |
| **P1-003** Watchdog / EngineErrorBoundary gaps at section mounts | `desktop-2/src/shell/AppShell.tsx` | Wrapped `<ActiveComponent />` in `Watchdog id="shell/section/<route>"` + `EngineErrorBoundary route={route} component="Section"` at the single mount point in the section registry. | `grep -n "shell/section/" desktop-2/src/shell/AppShell.tsx` → hit at line 129 |
| **P1-004** CatalogCarousel fixture data | `desktop-2/src/routes/catalog/CatalogCarousel.tsx` | Deleted `DEMO_TILES` array (10 Rick Astley thumbnails). `tiles = props.tiles ?? []` (empty default). Added `effectiveState` derivation that collapses `ready/focused/partial` → `empty` when no tiles are passed, so CampaignsSection's `<CatalogCarousel />` renders the honest empty banner from the approved mockup. | `grep -n "DEMO_TILES" desktop-2/src/routes/catalog/CatalogCarousel.tsx` → only the fix-comment remains |
| **P1-005** InAppBrowser not mounted | `desktop-2/src/components/browser/BrowseOverlay.tsx` | Mounted `<InAppBrowser>` inside a Watchdog-wrapped fallback branch of BrowseOverlay's webview slot. Fires when `loadState === "blocked"` — the honest navigation-failed / iframe-blocked / commerce-fallback path. Wires `onClose → close()`, `onSyncGmail → push("https://mail.google.com/...")`. Uses only pre-existing `browse.ts` runtime capabilities (`openBrowsePanel`, `updateBrowsePanelBounds`, `closeBrowsePanel`, `browseBack/Forward/Reload`, `browseHealthCheck`, `openSmart`). | `grep -n "import.*InAppBrowser" desktop-2/src/components/browser/BrowseOverlay.tsx` → hit at line 24; `grep -n "loadState === \"blocked\"" desktop-2/src/components/browser/BrowseOverlay.tsx` → hit at line 826 |
| **P1-006** useWalletSummary exported but never consumed | `desktop-2/src/lib/wallet.ts` | Deleted the entire subsystem: `WalletSubscriber` type, `walletSubs` Set, `walletCache`, `walletInflight`, `notifyWalletSubs()`, `fetchAndBroadcast()`, `UseWalletSummaryReturn` interface, `useWalletSummary()` hook. Total 87 lines removed. | `grep -rn "useWalletSummary" desktop-2/src/` → only the removal comment remains |

**Stop-and-report status for P1-005 (Q1 A):** Mounting InAppBrowser required **zero new native commands**. All Tauri commands used are pre-existing (verified in `desktop-2/src/lib/browse.ts` exports: `openBrowsePanel`, `updateBrowsePanelBounds`, `closeBrowsePanel`, `isBrowsePanelOpen`, `browseBack`, `browseForward`, `browseReload`, `browseHealthCheck`). No `Cargo.toml`, `tauri.conf.json`, `src-tauri/**/*.rs`, or `package.json` touched.

---

## 3. 7-category purge sweep

| # | Category | Hits found | Resolution |
|---|---|---|---|
| 1 | Demo fixtures on customer surfaces | `CatalogCarousel.DEMO_TILES` (P1-004); `SyncMailMoneyDrop.DEMO_ROSTER` fallback + `DEMO_CLIPS` array (commit 7) | DEMO_TILES **deleted**; DEMO_ROSTER JSX-fallback **deleted** (honest empty state instead), array kept as dev-only driver with production guard; DEMO_CLIPS array **deleted** + JSX **replaced** with honest empty copy |
| 2 | Dead buttons | InAppBrowser preview chrome — "Open in system browser ↗" chrome button, "Use in Engine" preview, 4 quick-link chips, error-state Retry + Open in system browser (commit 9) | All **disabled** with title tooltips pointing at outer BrowseOverlay's real actions. Preview mockup shape preserved. |
| 3 | Unreachable screens | None found in `desktop-2/src/routes/**` — all 7 route dirs (campaign-builder, cancellation-intercept, catalog, in-app-browser, learn, sync-mail-money-drop, wallet-detail) are now mounted (in-app-browser via P1-005). | n/a — all reachable |
| 4 | "Coming soon" strings | Settings.tsx Stripe Connect provider card + "Native payouts · Coming soon"; SubmissionsReview nav entry (rendered "Submissions · coming soon"); Library nav entry (rendered "Library · coming soon") (commit 9) | Stripe Connect placeholder **removed**; Submissions nav entry **removed** from ConsoleNav.tsx; Library direct entry **removed** from SimulatorRouter.tsx SURFACE_FOR (existing alias to workstation now takes over) |
| 5 | Orphan routes | None left that ship-lens flagged. LibraryRoute lazy import removed as dead code (no consumers after purge). | n/a |
| 6 | Placeholder cards | Settings > Devices, Notifications, Streaks tabs (commit 8) | All 3 tabs **completely removed** per Daniel Q2 C: SettingsTab union pruned, COMMON_SETTINGS_TABS + CLIPPER_SETTINGS_TABS pruned, 3 placeholder sections deleted, 4 CSS selectors deleted. usePresencePreference kept (also consumed by CommunityChatHome). |
| 7 | Fake statistics | None found · verified `grep -rn "12 active\|18 · 4 pending\|\$248.60" desktop-2/src/` returned no customer-surface hits. | n/a |

**Grep proof for Category 1:**
```
grep -rn "DEMO_TILES\|DEMO_CLIPS" desktop-2/src/ 2>&1 | grep -v ".test\.\|// Ship-lens P1"
→ (empty · only fix-comment references remain)
```

**Grep proof for Category 6 (Settings tabs completely gone):**
```
grep -n "\"devices\"\|\"notifications\"\|\"streaks\"" \
  desktop-2/src/design-os/routes/Settings.tsx \
  desktop-2/src/design-os/routes/Settings.css
→ (no output — clean)
```

---

## 4. Settings tab removal proof (Daniel Q2 C)

```
$ grep -n "\"devices\"\|\"notifications\"\|\"streaks\"" desktop-2/src/design-os/routes/Settings.tsx
(no output)

$ grep -n "\"devices\"\|\"notifications\"\|\"streaks\"" desktop-2/src/design-os/routes/Settings.css
(no output)

$ grep -rn "settings:open-tab.*devices\|settings:open-tab.*notifications\|settings:open-tab.*streaks\|data-tab=.devices\|data-tab=.notifications\|data-tab=.streaks" desktop-2/src/
(no output)
```

- `SettingsTab` union — devices/notifications/streaks members removed
- `COMMON_SETTINGS_TABS` — devices + notifications entries removed
- `CLIPPER_SETTINGS_TABS` — streaks entry removed
- 3 `<section data-tab=...>` blocks — all removed
- 3 `.lc-settings[data-active-tab="..."]` CSS rules — all removed
- No `settings:open-tab` handlers reference the purged tab keys
- SettingsRoute Watchdog label updated: `"Settings (connections · profile · notifications)"` → `"Settings (connections · profile)"`

---

## 5. InAppBrowser mount proof (P1-005 · Daniel Q1 A)

**Import site:** `desktop-2/src/components/browser/BrowseOverlay.tsx` line 24
```
import { InAppBrowser } from "../../routes/in-app-browser/InAppBrowser";
import { Watchdog } from "../../lib/watchdog";
```

**Render diff:** the webview-slot branch now contains a React fragment with the empty slot div (native WKWebView slot) and a conditional `<InAppBrowser>` mount:
```
) : (
  <>
    <div ref={slotRef} className="lc-browse-webview-slot" aria-hidden="true" />
    {loadState === "blocked" && (
      <Watchdog
        id="pipeline/cp-15/in-app-browser-preview"
        label="In-app browser preview"
        cluster="pipeline"
        source="src/components/browser/BrowseOverlay.tsx:InAppBrowser"
      >
        <InAppBrowser
          onClose={close}
          onSyncGmail={() => push("https://mail.google.com/mail/u/0/#inbox")}
          onSyncOther={() => { /* mockup-only branch */ }}
        />
      </Watchdog>
    )}
  </>
)}
```

**Pre-existing Tauri commands used** (verified in `desktop-2/src/lib/browse.ts`):
- `openBrowsePanel(url, bounds)` → Rust `open_browse_panel`
- `updateBrowsePanelBounds(bounds)` → Rust `update_browse_panel_bounds`
- `closeBrowsePanel()` → Rust `close_browse_panel`
- `browseBack()` → Rust `browse_back`
- `browseForward()` → Rust `browse_forward`
- `browseReload()` → Rust `browse_reload`
- `browseHealthCheck()` → Rust `browse_health_check`
- `openSmart(url)` → existing shell-open wrapper (external-open fallback)

**No new Rust / Tauri / Cargo / package.json touches** — verified with:
```
$ git log --stat ae858be..HEAD | grep -E "\.(rs|toml|lock)$|tauri\.conf|package\.json|Cargo"
(no output)
```

---

## 6. War Room proof

**Tab registered:** `account-app/src/components/admin/AdminHQ.tsx`
- Import at line 30: `import { LaunchWarRoomTab } from "./LaunchWarRoomTab";`
- TABS entry added: `"Launch War Room"`
- Dispatch line added: `{tab === "Launch War Room" && <LaunchWarRoomTab />}`

**Component:** `account-app/src/components/admin/LaunchWarRoomTab.tsx` (416 lines)

**Backend endpoint:**
- Path: `GET /admin/launch-war-room/summary` (auth: `AdminUser` gate reuses `require_admin`)
- Router: `junior-backend/app/routes/admin_launch_war_room.py` (447 lines)
- Mounted in: `junior-backend/app/main.py` lines 1494-1496
- Cache: 30-second in-memory TTL keyed by admin id

**16 tiles enumerated (SYSTEMS constant in backend):**
1. Auth
2. Whop
3. Upload
4. URL ingest
5. AI clip generation
6. Export
7. Wallet
8. Affiliate
9. Payouts
10. Community
11. Notifications
12. Updates
13. Backend
14. Sidecar
15. Runtime
16. HQ

**Honest-state (AMBER) for missing telemetry:** The backend response always includes `events_pipeline_flowing: false` and an `honest_note`:

> "Live health signal for behavioural-event-based tiles is AMBER until the persisted events table lands (`/telemetry/diagnostic` logs to stdout only today · Phase 1 recovery brief). GREEN status requires actual observable proof."

Rendered as a fuchsia banner above the tile grid (`data-testid="hq-launch-war-room-honest-banner"`).

**Tile status derivation (backend `_tile_status`):**
- GREEN: `signal1.ready == True AND signal2.has_recent_proof == True AND recent_failure_rate < 0.10`
- AMBER: `signal1.ready == True AND signal2.has_recent_proof == False`
- RED: `signal1.ready == False OR signal2.recent_failure_rate >= 0.10`

**data-testid list per tile:**
- `hq-launch-war-room-root`
- `hq-launch-war-room-refresh`
- `hq-launch-war-room-honest-banner`
- `hq-launch-war-room-fetch-error`
- `hq-launch-war-room-tiles`
- `hq-launch-war-room-rollup-green`
- `hq-launch-war-room-rollup-amber`
- `hq-launch-war-room-rollup-red`
- `hq-war-room-tile-<slug>` (per tile; e.g. `hq-war-room-tile-auth`, `hq-war-room-tile-ai-clip-generation`)
- `hq-war-room-tile-<slug>-last-success`
- `hq-war-room-tile-<slug>-last-failure`
- `hq-war-room-tile-<slug>-affected-count`
- `hq-war-room-tile-<slug>-journey-map-link`
- `hq-war-room-tile-<slug>-hq-detail-link`

**Per-tile fields displayed:**
- system name + status pill
- last successful proof time (relative + absolute in tooltip)
- latest failure summary (msg + timestamp)
- affected journey count
- link to Journey Map (with system filter as `?q=<hint>`)
- link to relevant HQ detail tab (Clip Runs, Sign-in Ops, Bonus Ledger, etc.)
- fail rate + window (if numeric)

**Proxy allow-list update:** `account-app/src/app/api/admin/[...path]/route.ts` READ_PATHS list now includes:
```
/^launch-war-room\/summary$/,
```

---

## 7. Final ship-lens result

Ship-lens was run manually via grep sweeps. Original 6 P1s all resolved (see §2). No new P1s introduced. Sweep results:

- No `DEMO_TILES` / `useWalletSummary` remaining on the customer bundle (verified §2)
- No Devices / Notifications / Streaks Settings tab references (verified §4)
- No `Coming soon` / `coming soon` copy on any customer-navigable Settings/Design-OS route (`Library` → alias, `Submissions` nav-hidden, Stripe Connect placeholder removed)
- No new native / shell touches (verified §5)

Grep confirming zero P1-regression:
```
$ grep -rn "DEMO_TILES\|useWalletSummary" desktop-2/src/ 2>&1 | grep -v ".test\.\|// Ship-lens\|Ship-lens P1"
desktop-2/src/lib/wallet.ts:385:// `useWalletSummary` (module-level cache + subscribers set + inflight
(only the removal-note comment remains)
```

---

## 8. desktop-2 `npx tsc --noEmit`

```
$ cd desktop-2 && npx tsc --noEmit
(exit 0 · no output)
```

Clean.

---

## 9. desktop-2 `npm test`

```
Test Files  18 passed (18)
     Tests  147 passed (147)
  Duration  7.74s
```

All 147 tests pass. (Log noise from `SectionWithFallback.test.tsx` is expected — the test deliberately throws to verify the boundary catches.)

---

## 10. desktop-2 `npm run build`

```
✓ built in 16.63s
```

Vite production build succeeded. All 25+ chunks emitted. Bundle warning about the main `index-*.js` chunk being over 500kB is pre-existing (unchanged from baseline).

---

## 11. account-app `npx tsc --noEmit`

```
$ cd account-app && npx tsc --noEmit
(exit 0 · no output)
```

Clean.

---

## 12. account-app build

`npm run build` produced a full Next.js production route map (43+ routes rendered, no errors). Middleware bundled successfully. No documented gap.

---

## 13. Grep proof: no Rust / Cargo / tauri.conf / sidecar / package.json touches

```
$ git log --stat ae858be..HEAD | grep -E "\.(rs|toml|lock)$|tauri\.conf|package\.json|Cargo|sidecar\.py"
(no output)
```

No forbidden files modified.

---

## 14. Grep proof: no `git push` / `railway up` / `vercel deploy` invoked

Session command log confirms only `git add` + `git commit` + local `npm install / tsc / test / build` invocations. No `git push` was called. No `railway up`. No `vercel deploy`.

---

## Summary

- **6 P1s resolved** (P1-001..P1-006)
- **7-category purge complete** across `desktop-2/src/**` + `account-app/src/**` (settings tabs completely removed per Daniel Q2 C, InAppBrowser mounted per Daniel Q1 A, fixture data purged, coming-soon copy purged, dead buttons disabled)
- **Launch War Room built** with dual-signal contract (build readiness + live health), honest AMBER default until telemetry pipeline persists, 16 systems, 30s cache both sides
- **desktop-2 tsc + tests (147) + build** — all green
- **account-app tsc + build** — all green
- **11 logical commits**, each independent
- **Zero native / Rust / Cargo / Tauri config / package.json touches**
- **No push / no deploy / no publish** — all commits stay LOCAL until Daniel greenlights

Ready for Daniel review. Awaiting greenlight before push.
