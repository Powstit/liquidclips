# Ship 0.4.34 — preflight checklist

> **⏸ PAUSED 2026-05-28** — release no longer fires as soon as Apple clears.
> Strategy change: use Apple's enrollment-processing window as product build
> time. Browse Rewards moves from gated spike → real v1 feature; the launch
> hardening P0-3/P0-4 items (publish-beta-label, hosted-AI recopy) execute
> in this window. See `feature-roadmap-pre-ship.md` for the new gate list.
> This preflight stays valid; just don't fire it until F1–F4 are done.

Run this checklist immediately before `desktop/scripts/ship.sh 0.4.34`.
Each item must pass before signing/notarizing. Issued 2026-05-28 by Daniel
on release freeze (paused same day for feature inclusion).

## Apple-side prerequisites (Daniel handles, then confirms)

- [ ] Apple Developer Program membership ACTIVE (no "purchase processing" banner on developer.apple.com).
- [ ] **Developer ID Application** cert installed in login keychain.
  Verify: `security find-identity -v -p codesigning | grep "Developer ID Application"`
- [ ] **Notarytool keychain profile** stored.
  Verify: `xcrun notarytool history --keychain-profile JUNIOR_NOTARIZE` returns a list (not "No Keychain password item found").
- [ ] **`APPLE_SIGNING_IDENTITY`** exported in `~/.claude-credentials/junior-internal.env`,
  matching the exact cert string (e.g. `Developer ID Application: Daniel Diyepriye (TEAMID)`).

## Repo + build hygiene (Claude verifies before ship)

1. [ ] **Working tree clean** — no accidental secrets / env files staged.
   ```
   cd ~/Desktop/jnr && git status -s
   ```
   Expected: only the version-bump commit ship.sh will create. `.env.local`,
   `.claude-credentials/*`, `*.env` MUST NOT appear.

2. [ ] **Production build hides Browse Rewards.**
   - Confirm `desktop/src/lib/flags.ts` exports `BROWSE_PANEL_ENABLED` defaulting to `false`.
   - Confirm production build is run WITHOUT `VITE_BROWSE_PANEL=1` in the env.
   - `ship.sh` calls `tauri build`; verify the spike card is NOT in the bundled
     `dist/` HTML.
   ```
   grep -rE "spike · feasibility test|Browse Rewards" desktop/dist 2>/dev/null
   ```
   Expected: zero matches.

## Live infrastructure (Claude verifies via HTTP)

3. [ ] **Updater endpoint** returns HTTP 200 + valid Tauri manifest.
   ```
   curl -sS -w "%{http_code}\n" https://updates.liquidclips.app/latest.json -o /tmp/m.json && jq . /tmp/m.json
   ```
   Expected: 200, JSON with `version`, `pub_date`, `platforms.{darwin-x86_64,darwin-aarch64}.{signature,url}`.

4. [ ] **`liquidclips.app` + `www.liquidclips.app`** both return 200.
   ```
   for d in liquidclips.app www.liquidclips.app; do curl -sS -o /dev/null -w "$d -> %{http_code}\n" https://$d; done
   ```

5. [ ] **`jnremployee.com` 308-redirects to `liquidclips.app`.**
   ```
   curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" https://jnremployee.com
   ```
   Expected: `308 https://liquidclips.app/`

6. [ ] **`account.jnremployee.com` still serves 200.** Clerk callbacks live there.
   ```
   curl -sS -o /dev/null -w "%{http_code}\n" https://account.jnremployee.com
   ```

## Built .app integrity (Claude verifies after `tauri build`, before `ship.sh` continues)

7. [ ] **App name + icon read as Liquid Clips** in the built `.app` bundle.
   ```
   cd desktop && plutil -p src-tauri/target/release/bundle/macos/Liquid\ Clips.app/Contents/Info.plist | grep -E "CFBundleName|CFBundleIdentifier|CFBundleIconFile"
   ```
   Expected:
   - `CFBundleName = "Liquid Clips"`
   - `CFBundleIdentifier = "app.liquidclips.desktop"`
   - `CFBundleIconFile = "icon.icns"` (and `Resources/icon.icns` is the new fuchsia squircle, not old Junior art)

8. [ ] **No visible "Junior" branding in user-facing surfaces.** Smoke-test in
   the built `.app`:
   - First-run / onboarding screen
   - Settings panel (every section)
   - Paywall / Upgrade screens
   - Notifications inbox
   - Results grid + ClipPreview
   - Updater banner / "checking for updates"
   - Window title bar (`liquid/clips`)
   - Header wordmark (`liquid/clips`)
   - Dock icon (fuchsia squircle, white tile, fuchsia slash)

## Ship gate

9. [ ] **All items 1-8 PASS.** Only then:
   ```
   cd ~/Desktop/jnr/desktop
   source ~/.claude-credentials/junior-internal.env
   ./scripts/ship.sh 0.4.34 "Liquid Clips rebrand foundation. First signed, notarized, universal Mac release."
   ```

`ship.sh` will then:
- Universal Mac build → codesign → notarytool submit --wait → stapler staple → spctl assess
- Re-tar + re-sign with Minisign
- Upload `.app.tar.gz` + `.sig` to `darwin-x86_64` + `darwin-aarch64` update slots
- Verify the live manifest at `updates.liquidclips.app/latest.json` reports 0.4.34
- Push the version-bump commit to `origin/main`

If ANY codesign / notarytool / stapler / spctl step fails, the script aborts
BEFORE upload — no broken artifact reaches users.

## After ship.sh succeeds

- [ ] Confirm `updates.liquidclips.app/latest.json` reports `version: "0.4.34"`
  on both `darwin-x86_64` and `darwin-aarch64`.
- [ ] Download the fresh `.app.tar.gz` from
  https://api.jnremployee.com/updates/download/darwin-aarch64 (or x86_64) and
  open it on a clean machine to verify Gatekeeper passes.

## Deferred to 0.4.35

- Browse Rewards: enable the flag, add URL filter, resize handler, browser
  chrome (back/forward/refresh), Whop login + cookie persistence test,
  YouTube/video playback test, App Store reviewer notes.
- `account.liquidclips.app` migration (after re-registering Clerk callbacks
  at the new subdomain).
- OG card image (`liquidclips.app/og-product.png`).
- Mac App Store distribution (requires IAP integration — separate 0.5.x
  project).
