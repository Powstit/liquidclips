# Mobile Responsiveness + Desktop Auto-Update — Scope & Fix Plan

**Status:** scope only. No code changed. Written against the live code at the paths cited.
**Date:** 2026-05-25 · **Target:** the 0.4.18 desktop cut + public launch web surfaces.

---

## ⚡ CRITICAL PATH (do this for the flip)

**Auto-update (blocking for 0.4.18 → 0.4.19 to ever update):**
1. **0.4.18 MUST ship with the updater config intact** (it already is — `tauri.conf.json` `plugins.updater` has the endpoint + pubkey, and `createUpdaterArtifacts: true`). If 0.4.18 ships *without* these, no 0.4.18 install can ever auto-update. ✅ currently present — just don't regress it.
2. **The backend `/updates/latest.json` must serve a real, populated `manifest.json` for the SAME target the installed app reports.** Today the prod default `JUNIOR_RELEASES_DIR` points at a local dev path that does not exist on Railway → endpoint returns 204 forever → "you're up to date" lie. **This is the #1 gap.**
3. **Decide + lock the build target.** The shipped binary's triple (`darwin-aarch64` vs `darwin-x86_64`) must match the `target` key in `manifest.json`. `release.sh` derives it from the *build host*; if you build 0.4.18 on Apple Silicon it'll be `darwin-aarch64`, but `updates.py` *defaults* missing targets to `darwin-x86_64`. Mismatch = silent no-update.
4. **Host the signed artifact where the backend can stream it.** `manifest.json` currently stores a `local_path` on the build machine — that path doesn't exist on Railway. Either (a) commit/upload the `.app.tar.gz` into the releases dir on the server, or (b) point `url` at S3/CDN.
5. **Cut 0.4.19 and prove the loop end-to-end** before relying on it: install 0.4.18, run `release.sh` for 0.4.19, publish manifest+artifact, relaunch 0.4.18, confirm it self-updates.

**Mobile (blocking for public launch):**
1. `marketing/index.html` is the public site and is **already strongly responsive** (viewport meta, clamp() headings, 3 breakpoint tiers, scrollable comparison table). One real gap: **mobile nav has no menu** — links are `display:none` ≤900px, only Download survives. Add a hamburger or a compact link row.
2. `account-app/src/app/upgrade/page.tsx` renders a **second `<Nav />`** on top of the global one from `layout.tsx` → double sticky header. Remove the local `<Nav />`.
3. Everything else in account-app/partner-app is Tailwind-responsive already; the punch-list below is mostly hardening, not rewrites.

---

# PART 1 — Mobile responsiveness

### What's already responsive (do NOT rewrite)
- **Tailwind breakpoints everywhere:** `sm:`/`md:`/`lg:` grids, stacked-to-row flex (`flex-col sm:flex-row`), `clamp()` headings across account-app and partner-app.
- **`PricingComparison.tsx`** — wraps the table in `overflow-x-auto` with `min-w-[720px]` and a **sticky first column** (`sticky left-0`). Correct mobile table pattern. Same pattern repeats in every `AdminHQ` table.
- **`Carousel.tsx`** — `scroll-snap` track with card width `min(100%, 720px)`, so cards become full-width on phones automatically. Good.
- **`ComparisonToggle.tsx`** — collapses on mobile, header stacks `flex-col sm:flex-row`.
- **`marketing/index.html`** — viewport meta present (line 5), `@media` at 900/600/560/480, hero CTAs stack full-width ≤480, comparison table switches to horizontal scroll with `min-width` ≤480, drip calendar shrinks its 7-col grid, footer grid collapses 4→2→1.
- **Auth pages** — sign-in/up use `grid-cols-1 lg:grid-cols-[…]`, Clerk widget is responsive by default.

The plan below is **additive hardening**, prioritized.

---

## P0 — must fix before launch

### 1. account-app — double nav on `/upgrade`
- **File:** `account-app/src/app/upgrade/page.tsx` (line 3 import, line 32 `<Nav />`)
- **Wrong:** `layout.tsx` already renders `<Nav />` globally (layout.tsx line 52). `/upgrade` renders a second `<Nav />` inside its own page → two stacked sticky bars, doubled height, broken on mobile where vertical space is scarce.
- **Fix:** delete the local `import { Nav }` and `<Nav />` from `upgrade/page.tsx`; let the layout nav stand. (Also drops the redundant `min-h-screen bg-paper` wrapper that the layout already provides.)

### 2. marketing — no mobile nav menu
- **File:** `marketing/index.html` — `.nav-links a:not(.nav-cta){display:none}` at line 1288 (≤900px)
- **Wrong:** below 900px, How it works / Pricing / Demo / Affiliates all vanish from the top nav; only the Download pill remains. On a phone the public site has no top-nav navigation. Footer still links everything, but discoverability above the fold is gone.
- **Fix:** add a minimal hamburger that toggles a dropdown of the same links, OR (cheaper, on-brand) keep links visible but shrink them into a horizontally-scrollable single row at ≤900px instead of hiding them. A hamburger is the launch-grade answer.

### 3. checkout — Whop embed min-height on small phones
- **File:** `account-app/src/app/checkout/page.tsx` (embed container line 231–245, `min-h-[540px]`)
- **Wrong:** the Whop checkout iframe sits in a `max-w-xl` card with a hard `min-h-[540px]`. The embed itself is responsive, but verify on a 360px-wide viewport that the iframe's internal form doesn't introduce its own horizontal scroll inside the card. The outer card padding drops to `p-2` on mobile which is fine.
- **Fix:** QA on real device; if the embed overflows, set the wrapper to `w-full` (already is) and ensure no fixed pixel width leaks from Whop. Likely no code change — flag for the QA pass. Keep the `key={affiliateId}` remount.

---

## P1 — should fix before launch

### 4. dashboard — fixed-height cards crowd small screens
- **File:** `account-app/src/app/dashboard/page.tsx`
  - `Stat` cards: `h-[180px]` (line 300)
  - `Card` (next-moves): `h-[340px]` (line 341), giant `text-[80px]` numeral (line 348), `text-[26px]` title (line 356)
  - `Tile`/`Milestone` on download page similar.
- **Wrong:** fixed heights are fine inside the Carousel (cards are full-width on mobile so height is acceptable), but the `h-[340px]` cards with `p-8` + 80px numerals can clip longer copy on a 320px screen, and the action button row (`flex-wrap gap-2`) can push past the card bottom.
- **Fix:** change `h-[340px]` → `min-h-[340px]` so content can grow; reduce padding on mobile (`p-6 sm:p-8`); clamp the numeral (`text-[56px] sm:text-[80px]`). Low risk, additive.

### 5. dashboard — debug grid label/value squeeze
- **File:** `account-app/src/app/dashboard/page.tsx` — `DebugLine` (line 407–430), grid `grid-cols-1 sm:grid-cols-2` (line 231)
- **Wrong:** each row is `flex justify-between` with a `truncate` value. On 320px the mono labels + long ids (clerk user id, affiliate id) collide; `truncate` hides data the user came to read for support.
- **Fix:** on mobile stack label-over-value (`flex-col sm:flex-row sm:justify-between`) and drop `truncate` on mobile (or keep a tap-to-reveal). It's a debug/support surface — readability beats density here.

### 6. AdminHQ — tab bar + dense tables on phones
- **File:** `account-app/src/components/admin/AdminHQ.tsx`
  - Tab nav: `flex flex-wrap gap-1.5` (line 153) — 8 tabs wrap to 3–4 rows on mobile (acceptable but tall).
  - Tables already use `overflow-x-auto` (lines 360, 627, 701, 828, 943) ✅.
  - Detail/stat grids use `grid-cols-2 sm:grid-cols-4` ✅.
- **Wrong:** mostly fine. The one real issue: tap targets — tab buttons are `px-3.5 py-1.5` (~28px tall) and inline row action buttons (`expire`/`resend`/`open`) are `py-0.5`/`py-1` → **well under the 44px touch minimum**. Admin is a low-frequency internal surface so this is P1 not P0, but it's annoying on a phone.
- **Fix:** bump action buttons to `py-2` min and tab buttons to `py-2`; optionally make the tab bar a horizontal scroll strip (`flex-nowrap overflow-x-auto`) instead of wrapping. No table rewrite needed — the scroll pattern is already correct.

### 7. Tap targets across web surfaces (<44px)
- **Files / spots:**
  - `account-app/src/components/Carousel.tsx` — Paddle buttons `h-8 w-8` (32px, line 81).
  - `AffiliateCard.tsx` — copy button `py-2.5`, input `py-2.5` (~38px) (lines 99–106).
  - `partner-app` `StatTiles.tsx` currency toggle `px-3 py-1` (~26px, line 35).
  - `AdminHQ` `FilterSelect` selects `py-1` (line 772).
  - Dashboard footer/legal links `text-[10px]` taps.
- **Fix:** raise interactive elements to ≥44px min in the tap dimension (`min-h-[44px]` or bump `py`). Carousel paddles → `h-11 w-11` on mobile or hide them on touch (snap-scroll works without them). This is a global polish pass, see QA checklist.

### 8. partner-app — ReferralLink can overflow long URLs
- **File:** `partner-app/src/components/ReferralLink.tsx` (line 27 `code` with `truncate`, line 26 `flex items-center gap-3`)
- **Wrong:** URL `<code>` is `flex-1 truncate` next to a Copy button — fine, but the row never stacks. On a narrow phone the Copy button eats width and the visible URL is a tiny truncated sliver. Functional (truncate prevents overflow) but ugly.
- **Fix:** `flex-col sm:flex-row` so the URL gets a full row on mobile and Copy sits below full-width. Mirror the pattern already used in `AffiliateCard.tsx` (which does `flex-col sm:flex-row`).

---

## P2 — nice to have / polish

### 9. partner-app StatTiles — 3 cols stay 3 cols on mobile
- **File:** `partner-app/src/components/StatTiles.tsx` (line 45 `grid-cols-3`)
- **Wrong:** three earnings tiles stay `grid-cols-3` at all widths; values use `text-xl sm:text-3xl` so they shrink, but on 320px three tiles + gaps get cramped.
- **Fix (optional):** `grid-cols-1 xs:grid-cols-3` or keep 3 but reduce gap on mobile. Low impact — values already responsive.

### 10. checkout/get hero numerals + splash tile
- **Files:** `checkout/page.tsx` right-hand splash uses `text-[88px]` `/` glyph (line 154); `get/page.tsx` h1 uses `clamp(36px,6vw,64px)` ✅.
- **Fix:** checkout splash is inside an `aspect-[4/3]` box so it scales; verify the 88px glyph doesn't overflow at 320px. Likely fine — QA only.

### 11. marketing — verify no horizontal scroll from decorative elements
- **File:** `marketing/index.html` — `.hero::before` is a 600px circle (line 148) but parent `.hero` is `overflow:hidden` (line 141) ✅. Icon-showcase `.hero-app-icon` 280px→220px→180px across breakpoints ✅.
- **Fix:** none expected; include "no horizontal scroll at 320/360/390px" in the QA checklist as the catch-all.

---

## Global mobile QA checklist (run before launch)

Test at **320px, 360px, 390px, 768px** (DevTools device toolbar) on every surface:

- [ ] No horizontal page scroll at any width (the #1 mobile smell — usually a fixed px width or unwrapped flex row).
- [ ] Every interactive element ≥44×44px touch target.
- [ ] All tables scroll horizontally (not the page) — verify the *table* scrolls, not the body: PricingComparison + all 5 AdminHQ tables.
- [ ] Hero headings clamp and never clip (account dashboard, /get, /download, /upgrade, marketing hero).
- [ ] CTA button rows stack full-width on mobile, no overflow (checkout, get, download, marketing hero/final-cta).
- [ ] Only ONE sticky nav renders per page (fix /upgrade double-nav).
- [ ] Marketing top nav is usable on mobile (after hamburger fix).
- [ ] Whop checkout embed has no internal horizontal scroll on a 360px phone.
- [ ] Inputs don't trigger iOS zoom — body/inputs should be ≥16px font where the user types (checkout claim email input is `text-[15px]` → bump to `text-base` to avoid iOS auto-zoom). Files: `get/page.tsx` ClaimForm input (line 425), `AdminHQ` SearchBar (line 348).
- [ ] Modals/sheets fit: desktop Settings sheet is `max-w-[640px]` `w-full` (desktop app, not mobile-web — N/A for phones).
- [ ] Footer link rows wrap, don't overflow.
- [ ] Forms: claim email + Copy buttons stack on narrow widths.

---

# PART 2 — Desktop auto-update readiness

### One-line state
The **entire client side is built and correct.** Tauri updater plugin is a Cargo + npm dependency, registered in `lib.rs`, permitted in capabilities, configured in `tauri.conf.json` with a real endpoint + pubkey, `createUpdaterArtifacts: true`, and the React UI checks on launch + offers Settings → check, with download progress and relaunch. The **gaps are all on the server/release side**: the backend manifest is unpopulated in production, the artifact host is a dev-only local path, and the build target is ambiguous.

---

## (a) What's in place vs missing

### ✅ In place
| Piece | Where | Notes |
|---|---|---|
| Updater Rust dep | `desktop/src-tauri/Cargo.toml` line 21 | `tauri-plugin-updater = "2"` |
| Process (relaunch) dep | `Cargo.toml` line 22 | `tauri-plugin-process = "2"` |
| Plugin registered | `desktop/src-tauri/src/lib.rs` lines 22–23 | `.plugin(tauri_plugin_updater::Builder::new().build())` + process |
| Permissions granted | `desktop/src-tauri/capabilities/default.json` lines 18–19 | `updater:default`, `process:default` |
| npm updater + process | `desktop/package.json` lines 17, 19 | `@tauri-apps/plugin-updater ^2.10.1`, `plugin-process ^2.3.1` |
| Updater config | `desktop/src-tauri/tauri.conf.json` lines 62–72 | endpoint `https://api.jnremployee.com/updates/latest.json`, pubkey, Windows `installMode: passive` |
| Artifact generation | `tauri.conf.json` line 39 | `"createUpdaterArtifacts": true` |
| Signing keypair (local) | `desktop/.junior-updater/junior-updater.key(.pub)` | private key **is gitignored** (verified) ✅ |
| Pubkey ↔ private key match | conf line 67 vs `.key.pub` | both contain `…RWRE5PxrBjfgsci38fZ6kc8ZH+cBk1dO6oHenn2z1+ePnRC1emj3wb8d` ✅ |
| In-app check logic | `desktop/src/lib/updater.ts` | `checkForUpdate()` → `check()`, `applyUpdate()` → `downloadAndInstall()` + `relaunch()` |
| Launch auto-check | `desktop/src/App.tsx` lines 89–93 | silent; surfaces a banner only if an update exists |
| Update banner UX | `App.tsx` lines 603–625 | "Junior {v} ready", Install + relaunch, % progress |
| Manual check | `desktop/src/components/Settings.tsx` lines 29–37 | Settings → check / apply |
| Release build script | `desktop/scripts/release.sh` | signs build, finds `.app.tar.gz` + `.sig`, writes `manifest.json` |
| Backend endpoint | `junior-backend/app/routes/updates.py` | `/updates/latest.json` + `/updates/download/{target}`, mounted in `main.py` line 64 |

### ❌ Missing / stubbed (the actual work)
1. **Production manifest is never populated.** `updates.py:releases_dir()` defaults to `~/Desktop/jnr/desktop/src-tauri/target/release/bundle` — a path that **does not exist on Railway**. With no `manifest.json` there, every request returns **204 No Content** → every installed app believes it is current forever. `JUNIOR_RELEASES_DIR` must be set in the Railway env AND a real `manifest.json` must live there.
2. **Artifact hosting is a local-disk stub.** `manifest.json` stores `local_path` (set by `release.sh` to the build machine's absolute path). `/updates/download/{target}` `FileResponse`s that path — which doesn't exist on Railway. Needs either the tarball uploaded next to the manifest on the server, or `url` pointed at S3/CDN (the code comments already flag "Sprint 9 swaps for S3/CDN").
3. **Target mismatch risk.** `release.sh` derives `TARGET` from the build host triple. `updates.py` defaults a *missing* `?target=` to `darwin-x86_64`. The desktop will send its real triple, so the manifest's target key MUST equal what the shipped binary reports. Today only **one** target is produced per build — there is no universal/dual-arch manifest. If you ship an Apple-Silicon `darwin-aarch64` build but the manifest only has `darwin-x86_64`, no update.
4. **No CI signing.** Signing happens via `release.sh` on the dev laptop using the local key. Fine for a solo founder, but the private key lives only on one machine (`.junior-updater/junior-updater.key`) — no backup, no rotation story. Lose it and you can never ship a verifiable update to existing installs again (the pubkey is baked into every shipped binary).
5. **No Windows artifact path.** `release.sh` only handles the macOS `.app.tar.gz`. Windows updater artifacts (`.msi`/`.nsis` + `.sig`) aren't produced/managed (Windows EV cert is deferred per the download page), so Windows auto-update is not yet wired even though the conf has `windows.installMode`.

---

## (b) Tauri v2 updater requirements (reference — all satisfied except hosting)

1. **Signing keypair** — `npx tauri signer generate -w <path>` → minisign-format private + public. Private signs; public is embedded. ✅ have it (`.junior-updater/`).
2. **`tauri.conf.json` updater config** — `plugins.updater.{endpoints[], pubkey}`. ✅ present.
3. **Updater plugin + permission** — Cargo dep + `lib.rs` registration + `updater:default` capability. ✅ all present.
4. **`createUpdaterArtifacts: true`** in `bundle` — produces the `.app.tar.gz`(+`.sig`) / `.msi`(+`.sig`) updater bundles. ✅ present.
5. **The JSON the server returns** (Tauri v2 "dynamic" updater shape):
   ```json
   {
     "version": "0.4.19",
     "notes": "…",
     "pub_date": "2026-05-25T12:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<contents of .sig file>",
         "url": "https://api.jnremployee.com/updates/download/darwin-aarch64"
       }
     }
   }
   ```
   `updates.py` already emits **exactly this shape** (lines 57–67). ✅ correct contract.
6. **Signing env at build** — `TAURI_SIGNING_PRIVATE_KEY` (key *contents*) + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. ✅ `release.sh` sets both.

---

## (c) Exact manifest the backend must serve

`/updates/latest.json?target=<triple>&current_version=<v>` must return, for the requested `target`:

```json
{
  "version": "0.4.19",
  "notes": "Junior 0.4.19",
  "pub_date": "<RFC3339 UTC>",
  "platforms": {
    "<target>": {
      "signature": "<raw contents of the .app.tar.gz.sig>",
      "url": "<https URL the client can GET the .app.tar.gz from>"
    }
  }
}
```
- Return **204** when `current_version == manifest.version` (already implemented) or when the target isn't in the manifest.
- The **`signature`** is the literal text inside the `.sig` file produced next to the artifact (NOT the pubkey, NOT a hash).
- The on-disk `manifest.json` (written by `release.sh`) keeps an extra `local_path` per platform; `updates.py` rewrites that into a public `url` before returning (lines 53–55). That indirection is fine **only if `local_path` actually exists on the server** — see gap #2.

---

## (d) Where signed artifacts get hosted

- **Today (dev):** local disk under `releases_dir()` / `JUNIOR_RELEASES_DIR`; `/updates/download/{target}` streams the file. Works on the dev box only.
- **For the flip (minimum viable):** set `JUNIOR_RELEASES_DIR` to a persistent path on Railway (a mounted volume), copy `manifest.json` + the `.app.tar.gz` there after each `release.sh`, and let the existing `/updates/download/{target}` stream it. Cheapest path that uses code as-is.
- **Production-grade (the code's own TODO):** upload `.app.tar.gz` to S3/Cloudflare R2, put the public/CDN URL directly in the manifest's `url`, and have `/updates/latest.json` return that URL (skip the download proxy, or 302-redirect). Survives Railway redeploys/ephemeral disk.

> ⚠️ Railway containers have ephemeral filesystems — a local `JUNIOR_RELEASES_DIR` on the app container will be **wiped on every redeploy**. Use a mounted volume or external object storage. This is why S3/R2 is the right answer, not just "set the env var."

---

## (e) In-app update UX (already built — for reference)

1. **Launch:** `App.tsx` (89–93) silently calls `checkForUpdate()`; only shows UI if `kind === "available"`.
2. **Notify:** bottom banner "● Junior {version} ready — auto-update available" + "Install + relaunch" button (App.tsx 603–617).
3. **Download:** `applyUpdate()` (updater.ts 23–50) streams progress → banner shows "↓ downloading update… NN%" (App.tsx 620–625).
4. **Install + relaunch:** `update.downloadAndInstall(...)` then `relaunch()` from `plugin-process`.
5. **Manual path:** Settings sheet → "Check for updates" → apply (Settings.tsx 29–37).

No UX work needed for the flip. Optional polish: surface `kind: "error"` in the banner (currently the launch path only acts on `available`; errors are swallowed on launch, shown only in Settings).

---

## (f) Precise critical path for 0.4.18

**Before 0.4.18 ships (so 0.4.19 can update it):**
1. ✅ Confirm `tauri.conf.json` still has `plugins.updater.endpoints`, `pubkey`, and `createUpdaterArtifacts: true`. (Present today — guard against regression.)
2. ✅ Confirm the pubkey in conf matches the private key you'll sign 0.4.19 with. (Matches `.junior-updater/junior-updater.key.pub` today.)
3. **Lock the build target.** Decide aarch64 vs x86_64 (or build both). The triple you ship as 0.4.18 is what those installs will report on every future check — the manifest target key must match it.
4. **Back up `.junior-updater/junior-updater.key`** somewhere safe (it is the ONLY key that can produce updates the 0.4.18 installs will trust). Store it like a credential, e.g. `~/.claude-credentials/`.
5. Bump `version` to `0.4.18` in **both** `tauri.conf.json` (line 4) and `desktop/package.json` (line 4) — they must agree; `release.sh` reads version from `package.json`.

**To actually ship a working 0.4.19 update:**
6. Set `JUNIOR_RELEASES_DIR` on Railway to a **persistent volume** path (or wire S3/R2).
7. Run `desktop/scripts/release.sh` for 0.4.19 → produces signed `.app.tar.gz`, `.sig`, and `manifest.json`.
8. Publish to the host: copy `manifest.json` + `.app.tar.gz` to `JUNIOR_RELEASES_DIR` (or upload artifact to S3 and edit the manifest `url`). **Fix the `local_path` problem** — on Railway the manifest's `local_path` must resolve, or switch `updates.py` to use an absolute `url`.
9. **Prove it:** install 0.4.18, then publish 0.4.19, relaunch 0.4.18, watch it self-update and relaunch into 0.4.19.

---

## Security notes
- **Sign only locally/CI, ship only the public key.** ✅ The private key (`.junior-updater/junior-updater.key`) is gitignored and never bundled; only the base64 pubkey is in `tauri.conf.json`. Keep it that way.
- **Update key ≠ license key.** They are deliberately separate: the **license JWT** key is Ed25519 via `cryptography`, stored in `junior-backend/.junior-keys/` and the `JWT_PRIVATE_PEM` Railway env (`jwt_signer.py`). The **update-signing** key is the Tauri/minisign key in `desktop/.junior-updater/`. The backend `updates.py` never touches the update key — it only serves a manifest + streams a pre-signed artifact. Correct separation; don't conflate them.
- **Endpoint is HTTPS** (`api.jnremployee.com`) and the artifact is signature-verified by the client against the baked pubkey, so a compromised manifest host still cannot push a malicious update without the private key. Good.
- **Single-key blast radius:** because the pubkey is immutable once baked into shipped binaries, losing/leaking the private key is unrecoverable for existing installs. Back it up; if it ever leaks, you must ship a new signed build with a new pubkey via the *old* key, then retire the old key.

---

# Executive summary

**Mobile readiness:** Good shape, not a rewrite. The public marketing site is already responsive (viewport, clamp headings, breakpoints, scrollable tables) and both Next.js apps lean on Tailwind responsive utilities throughout. Two real bugs to fix before launch — the **double `<Nav />` on `/upgrade`** and the **missing mobile menu on the marketing nav** — plus a tap-target/iOS-zoom polish pass and a 320/360/390px QA sweep using the checklist above.

**Auto-update — single most important gap to close before the flip:** **the production update manifest + artifact are not actually served.** The client (Tauri plugin, config, pubkey, in-app UX) is complete and correct, but `junior-backend`'s `/updates` endpoint defaults to a dev-only local path that doesn't exist on Railway, so it returns 204 ("up to date") forever and the stored `local_path` artifact can't be streamed. **Fix: set a persistent `JUNIOR_RELEASES_DIR` (volume) or host the signed `.app.tar.gz` on S3/R2 with the public URL in the manifest, then prove the 0.4.18→0.4.19 loop end-to-end before relying on it.** Also lock the build target so the manifest's platform key matches the shipped binary's triple, and back up the single update-signing private key.
