# desktop-2 v2.2.0 · morning resume

**Status as of 2026-06-24 ~9pm:** new shell built + signed + installed locally. Ready for hand-test. **NOT pushed, NOT tagged, NOT released** — per [[no-push-until-confirmed]], that needs your review first.

---

## What landed this session

### 1 · Sidecar wire-up · NEW SHELL CAN CLIP
desktop-2 (v2.2.0) now ships the Python sidecar end-to-end. Repo-root `python-sidecar/` is the canonical tree (BUG-017 superset of legacy); `desktop-2/src-tauri/tauri.conf.json` already pointed at it via `../../python-sidecar/`. The 19MB `liquid-clips-sidecar` PyInstaller binary is bundled. CI workflow `release-desktop-2.yml` re-armed with ffmpeg/whisper fetch + xattr strip.

### 2 · Keychain prompts killed (BUG A · IG-014 mirror)
`desktop-2/src/lib/authStorage.ts` no longer reads OS Keychain on boot. `Settings → OpenAI key` uses a localStorage presence flag (`lc.openai_key.present.v1`) instead of `invoke("openai_key_get")` on mount. All keychain access now behind explicit-auth-action functions: `resumeJwtFromKeychainForAuthAction()` · `setJwtKeychainForAuthAction()` · `clearJwtKeychainForAuthAction()`.

### 3 · Browser handoff wired (BUG B)
- Home → **Find Rewards** tile now opens BrowseOverlay at `https://whop.com/discover/content-rewards/`
- BrowseOverlay chrome: **Copy URL** button + existing **Use in Engine ↗** button
- Use in Engine fires `lc:browse-url-handoff` CustomEvent so InlineCreatePanel auto-opens on URL tab + pre-fills

### 4 · Settings → 4 tabs (split the long scroll)
`desktop-2/src/design-os/routes/Settings.tsx` now tabs into **Account · Connections · Plan · Diagnostics**. All 11 sections labelled with `data-tab="X"`. Single state var, CSS hides non-active tab. No JSX upheaval.

### 5 · HomeBanner above the 4-tile grid
New `desktop-2/src/design-os/components/HomeBanner.tsx`. Hero Kade celebration image + "Hunt paid bounties without leaving the app" copy + "Browse Whop" CTA. Whole banner clickable → opens BrowseOverlay. Clipper-mode only (agency stays clean).

### 6 · Version + repo drift fixes
- `desktop-2/package.json`: `0.8.0-shell` → `2.2.0` (matches tauri.conf)
- `desktop-2/RELEASING.md`: `Powstit/Jnr-employee` → `Powstit/liquidclips` (the real remote)

### 7 · Whop chat rooms scope · `docs/lc2/WHOP_CHAT_ROOMS_SCOPE.md`
Research-only. Recommendation: **Phase 2** (after v2.2.x ships). Free for all creators, embedded React SDK exists, App API Key already has the scopes. 30-min Tauri-webview spike needed before any wire-up.

---

## What to test in the morning (in order)

1. **Keychain · should be silent**
   - Launch `/Applications/Liquid Clips.app` from cold (quit first if running)
   - Click Settings → Account tab → no Keychain Access password prompt
   - (BUG A · landed in code)

2. **Settings tabs · should switch instantly**
   - Settings → click Connections / Plan / Diagnostics tabs
   - Each tab shows only its sections; URL bar / scroll position should be sane
   - (#137 · landed)

3. **HomeBanner · should sit above the 4-tile grid**
   - Home in clipper mode shows banner + 4 tiles + earn strip
   - Click banner → BrowseOverlay opens at Whop content rewards
   - (#138 · landed)

4. **Browser handoff · should pre-fill Create Clips**
   - From Home, click **Find Rewards** (or the banner)
   - BrowseOverlay opens at Whop
   - Browse to any Whop campaign URL
   - Click **Use in Engine ↗** in chrome
   - Should land you on Editor section AND InlineCreatePanel should pop open with URL pre-filled
   - Also test **Copy URL** button → toast "URL copied"
   - (BUG B · landed)

5. **Clipping engine · should generate real clips** ⚠️ **THE BIG TEST**
   - From Home, click **Create Clips** tile (or use the URL pre-fill from #4)
   - Paste any 5-15 min YouTube URL · hit Generate
   - Should see: stage progression (ingest → lift → pick → frame → export)
   - Should see: 6+ real clips with LLM-generated titles render in the grid
   - This is the [[feedback-clipping-engine-done-definition]] gate. If broken, that's a sidecar wire issue.

---

## What is NOT done

- **Push / tag / release** — code is committed locally to `main` but not pushed. When you've verified #1–#5 above and want to publish: `cd desktop-2 && bash scripts/ship.sh 2.2.1`. That tags `desktop-2-v2.2.1`, fires `release-desktop-2.yml` CI (~15-20 min), drafts a GH release. THIS WILL BE THE FIRST-EVER PUBLIC desktop-2 release.
- **Whop reward grab** — only the browse + URL handoff is wired. The legacy `whopBounties.ts` cached-JWT wrappers (whopListBounties / whopBounty / whopSubmission) are NOT ported. Defer to v2.2.2 or as you choose.
- **Whop chat rooms** — scoped only, defer to Phase 2 per `docs/lc2/WHOP_CHAT_ROOMS_SCOPE.md`.
- **IG-001 + IG-010 frontend sentinel mirror** — Plan agent flagged these as forward-compat work. Not blocking v2.2.1 (desktop-2 doesn't yet use the legacy code paths those gates protect). Defer.

---

## If the clipping engine is broken

Most likely failure mode: the bundled sidecar binary at `Contents/Resources/_up_/_up_/python-sidecar/dist/sidecar-bundle/liquid-clips-sidecar` doesn't spawn or doesn't find ffmpeg. Diagnostics:

```bash
# Check sidecar.log
ls -la ~/Library/Logs/LiquidClips/

# Spawn binary directly
/Applications/Liquid\ Clips.app/Contents/Resources/_up_/_up_/python-sidecar/dist/sidecar-bundle/liquid-clips-sidecar --check
```

If `--check` returns missing deps, the PyInstaller bundle was built before the dep was added. Rebuild the sidecar bundle from `python-sidecar/build_sidecar.sh`.

---

## Task list at sleep

- #135 BUG B browser handoff — landed in code, marked completed after build verifies
- #136 Ship desktop-2-v2.2.1 — pending (your sign-off needed)
- #137 Settings tabs — landed in code, marked completed after build verifies
- #138 Sponsored banner — landed in code, marked completed after build verifies

Sleep well — wake up to a clipping new shell.
