# Beta walk-through · 2026-07-06 (v2.2.27)

**For:** Daniel · walk this list before you say push
**Format:** every item has a WHAT + WHERE + PASS-signal so you don't have to guess

---

## Boot flow

### 1 · Intro splash (should already look right · not changed this session)
- **Look:** Kade + Liquid Clips brand mark for ~3s
- **Pass:** you land on the shell without a white flash

### 2 · Mandatory update gate — Kade + Remotion (NEW)
- **How:** in the address bar of the tauri-dev window, append `?demoUpdateGate=1` and reload
- **Look for:**
  - Kade drifting up-down (2s cycle) inside a **fuchsia halo bloom** (pulses 1x/2s)
  - Copy: *"New Liquid Clips 2.2.28-demo is ready. Download to continue"*
  - One fuchsia CTA: **"Download update"**
  - No X button, no ESC exit, no click-outside dismiss (that's the point)
- **Pass:** ~15s of visual polish · Kade feels branded not generic
- **After walkthrough:** remove `?demoUpdateGate=1` from URL, reload · gate short-circuits to app

### 3 · Sign-in pill (TopHud)
- **Look:** small right-side pill with "Sign in" text
- **Click:** opens Whop checkout in default browser (not in-app)
- **Pass:** OS browser opens `whop.com/checkout/plan_NMKvKj8SVVKsY` (Founder plan)

---

## Constellation (self-healing loop · already live on Railway)

You can't literally "see" Constellation from the desktop side · it's silent-by-design. Here's how to verify:

### 4 · Watchdog wraps are mounted
- **How:** open browser DevTools → Console → run:
  ```js
  window.localStorage.getItem("lc.watchdog.nodes.v1")
  ```
- **Look for:** a JSON string with 40+ node entries (id-01, id-02, cp-10, cp-15, mo-08, ag-11, etc.)
- **Pass:** array is not empty · every node has `{ id, failureScore, override }`

### 5 · Pool config is polling
- **How:** in DevTools Console:
  ```js
  window.localStorage.getItem("lc.constellation.pool.v1")
  ```
- **Look for:** initially `null` or `[]` (pool has no active URLs yet from HQ). After 30s of app running, may still be `[]` since slot 1 URL isn't populated in the DB.
- **Pass:** no console errors from `interceptionBus`

### 6 · Force a Watchdog crash to see KadeRepairScreen
- **How:** open DevTools → Console → paste:
  ```js
  const err = new Error("Walk-through synthetic crash · you can ignore this");
  window.dispatchEvent(new ErrorEvent("error", { error: err, message: err.message }));
  ```
- Or navigate to Browse tab and try clicking things · if the Watchdog boundary catches anything, you'll see the KadeRepairScreen fallback (5:00 countdown + fuchsia pulse ring)
- **Pass:** app doesn't white-screen · KadeRepairScreen shows

---

## Real user paths (already shipped · sanity check)

### 7 · Wallet renders real data
- **Where:** click **Earn** in the side nav → **Wallet**
- **Pass:** ledger rows (fresh install shows empty state · that's correct)

### 8 · Community chat rooms exist
- **Where:** side nav → **Community**
- **Look for:** 9 seeded rooms (general · #hooks · #captions · #wins · etc.)
- **Pass:** rooms load · no "not connected" error

### 9 · Campaigns tab loads
- **Where:** side nav → **Campaigns**
- **Look for:** Uncle Daniel campaigns + any active reward clips
- **Pass:** grid renders without spinner-forever

### 10 · Browse (in-app browser)
- **Where:** side nav → **Browse**
- **Look for:** three source tiles (YouTube · Drive · URL) + "Open browser overlay →" primary CTA
- **Click:** the CTA · a Whop rewards page loads inside an overlay
- **Pass:** overlay opens · you can navigate inside · ESC closes

### 11 · Editor / clipping engine
- **Where:** side nav → **Clips** → open any project or create one
- **Pass:** editor loads · clip tiles render · no crash

### 12 · Settings
- **Where:** side nav → **Settings**
- **Look for:** connections · profile · notifications tabs
- **Pass:** every tab loads without a white-screen (this whole surface is wrapped in a Watchdog now)

---

## What I did NOT touch (still on prior state)

- **Whop dashboard config** (Founder plan visibility · initial_price · success_url · company profile logo) — you own this in the Whop admin
- **Cold-email infrastructure** — HQ owns
- **Anthropic account balance** — needs top-up · or you input Kimi key via HQ admin panel later

None of these block your local walk-through · they block cohort-0 outbound cadence.

---

## After walk-through · what "push" means

When you say push, the sequence is:
1. `git add` the modified files (I'll list the exact set)
2. `git commit -m "..."` with an honest message describing this session
3. `git push origin master`
4. Tag creation (`v2.2.27`) triggers CI → CI runs `tauri build` + notarises + signs + uploads
5. `latest.json` manifest bumps → next boot on existing installs → mandatory update gate fires → users click "Download update" → Constellation-armed build lands

**Nothing before your signoff.**

---

## Files changed this session (audit trail)

- `junior-backend/app/main.py` — imports constellation router · 6 new tables migrated · 2 include_router calls
- `junior-backend/app/routes/constellation.py` — NEW · 15 endpoints
- `junior-backend/app/constellation/` — NEW module (crypto · coordinator · pool · llm_dispatcher · recommendations)
- `account-app/src/app/api/admin/[...path]/route.ts` — added 5 read + 10 write proxy allow-list entries
- `desktop-2/src/lib/watchdog/interceptionBus.ts` — pool failover + state polling
- `desktop-2/src/lib/watchdog/index.ts` — export startInterceptionStatePolling
- `desktop-2/src/App.tsx` — boot state polling
- `desktop-2/src/components/update/HardUpdateGate.tsx` — Kade+Remotion visual + demo mode
- `desktop-2/src/components/update/UpdateKadeComposition.tsx` — NEW Remotion composition
- `desktop-2/package.json` + `package-lock.json` — remotion + @remotion/player installed
- `HQ_CONSTELLATION_ENGINE_SPEC_2026-07-05.md` — NEW (mirrored to Dropbox)
- `HQ_CONSTELLATION_SPEC_ADDENDUM_2026-07-06.md` — NEW (mirrored)
- `HQ_CONSTELLATION_LIVE_2026-07-06.md` — NEW (mirrored)
- `REPLY-FROM-APP-018-full-feature-list.md` — in Daniel Diyepriye/Liquidclips- Handoffs/
- `BETA_WALKTHROUGH_2026-07-06.md` — this file
- (Constellation code has also been deployed to Railway primary already · that's the live state you saw in smoke tests)
