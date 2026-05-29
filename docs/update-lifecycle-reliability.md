# Liquid Clips — update lifecycle reliability

Issued 2026-05-28 in response to Codex PM. The local install (drag-the-bundle-over) flow that worked for Daniel during the rebrand is **not** the production update experience. This doc separates the two and lists exactly what's wired, what's half-wired, and what's missing for a smooth-app update story.

---

## Current state — what's wired vs what isn't

| Layer | Wired | Half-wired | Missing |
|---|---|---|---|
| Tauri updater plugin in app | ✅ `tauri-plugin-updater = "2"` in Cargo; `updater:default` in capabilities | | |
| Endpoint URL | ✅ `https://updates.liquidclips.app/latest.json` in `tauri.conf.json` | | |
| Manifest proxy in production | ✅ `updates-proxy` Vercel project rewrites to backend | | |
| Backend manifest endpoint | ✅ Railway serves the manifest | ⚠️ Currently reports `version: 0.4.33`, single arch (`darwin-x86_64` only), `notes: "Junior 0.4.33"` (pre-rebrand) | |
| Minisign signing key | ✅ Public key embedded in `tauri.conf.json` `plugins.updater.pubkey`; private key at `.junior-updater/junior-updater.key` | | |
| `release.sh` Minisign re-sign + upload | ✅ Re-signs stapled `.app.tar.gz`, fan-outs to both `darwin-x86_64` and `darwin-aarch64` slots | ⚠️ Has never run for 0.4.34 — current live manifest is from a 0.4.33 manual upload | |
| Apple Developer ID code-signing + notarization | ✅ `release.sh` handles `codesign --verify`, `notarytool submit --wait`, `stapler staple`, `spctl --assess` | ⚠️ Skipped when `APPLE_SIGNING_IDENTITY` unset — produces ad-hoc-signed builds that need `xattr -d com.apple.quarantine` to install cleanly | |
| Frontend UI: silent check on boot | ✅ `App.tsx:113` runs `checkForUpdate()` in a fire-and-forget async IIFE | | |
| Frontend UI: banner when update available | ✅ `App.tsx:787` renders a banner with "Restart to install" action | | |
| Frontend UI: manual check in Settings | ✅ `Settings.tsx:34` "Check for updates" button | | |
| Apply update → relaunch | ✅ `lib/updater.ts:25` `applyUpdate()` calls `downloadAndInstall()` then `relaunch()` | | |
| Sidecar dies on graceful Cmd+Q | ✅ `sidecar.rs:73` `.kill_on_drop(true)` on the tokio `Command` — Child drops with SidecarState which drops on app exit | ⚠️ No explicit `RunEvent::ExitRequested` handler — if the parent itself is force-killed, the child orphans | |
| Sidecar dies on SIGKILL of parent | | | ❌ Not handled. macOS force-quit / crash orphans the sidecar. Mitigation: install script `pkill -f` sweep. |
| Soft-stop RPC to sidecar before kill | | | ❌ Currently we SIGKILL the sidecar mid-RPC. In-flight transcribe/ffmpeg jobs lose their work. |
| "Restart now" deferred UX | | ⚠️ Current `applyUpdate()` is synchronous: download + relaunch in one step. No "download done, click Restart when ready" stage. | |
| Version verification after relaunch | | | ❌ No assertion that the post-relaunch process actually loaded the new binary. |
| Rollback on failed update | | | ❌ If the new binary boot-loops or fails Gatekeeper, no recovery path. |

---

## What `scripts/local-install.sh` solves

- Atomic quit → wait → SIGKILL holdouts → replace bundle → clear quarantine → relaunch → verify version
- Catches stale sidecars that survived a previous force-quit
- Verifies built-bundle version matches installed-bundle version (no silent mismatches)
- Visible at every step (`✓` / `✗` lines)

## What `scripts/local-install.sh` does NOT solve

- It's **local-only**. Daniel's machine. Customers never run a shell script.
- Bypasses signature verification — copies whatever `.app` is in `target/release/bundle/` regardless of source. Production updater enforces Minisign signature against the public key in `tauri.conf.json`.
- Bypasses Gatekeeper — `xattr -d com.apple.quarantine` makes ad-hoc-signed builds runnable without right-click. Production builds must be Developer-ID signed + notarized so quarantine flag is irrelevant.
- No staged "Restart to update" UX — quits immediately.
- No rollback — if the new build crashes, you re-run the script with an older bundle manually.

**Bottom line: `local-install.sh` is the QA loop. The Tauri updater is the customer path. Don't conflate them.**

---

## Production Tauri updater path (target state)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. App boots → App.tsx fires checkForUpdate() (fire-and-forget) │
│    Hits updates.liquidclips.app/latest.json                     │
│    Response: { version, signature, url } per platform           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ semver compare
                           ▼
        ┌────────────────────────────────────┐
        │ newer? → setUpdateBanner({…available})│
        └─────────────┬──────────────────────┘
                      │
                      ▼
  ┌──────────────────────────────────────────────────┐
  │ App.tsx:787 banner appears: "0.4.X ready"       │
  │ User clicks "Restart to install"                │
  └─────────────────┬────────────────────────────────┘
                    │
                    ▼
   ┌────────────────────────────────────────────────────┐
   │ applyUpdate(update, onProgress):                  │
   │   - update.downloadAndInstall((evt) => onProgress)│
   │     * verifies Minisign signature against pubkey │
   │       embedded in tauri.conf.json                │
   │     * unpacks .app.tar.gz over current bundle    │
   │   - await relaunch()                              │
   │     * Tauri quits the process                     │
   │     * sidecar dies via kill_on_drop               │
   │     * new binary starts                           │
   │   - Logo's getVersion() reads new bundle version  │
   └────────────────────────────────────────────────────┘
```

For this loop to be production-smooth, four gaps need closing:

### Gap 1: Manifest is stale (immediate blocker for any update)

Live manifest:
```json
{
  "version": "0.4.33",
  "notes": "Junior 0.4.33",
  "platforms": { "darwin-x86_64": { ... } }
}
```

When `ship.sh 0.4.34` runs, `release.sh` re-uploads with:
- `version: "0.4.34"`
- `notes: "Liquid Clips 0.4.34"` (already fixed in `release.sh` 2026-05-28)
- Both `darwin-x86_64` AND `darwin-aarch64` slots (universal binary fan-out)

**No action until ship.sh runs.** Until then, every installed 0.4.33 client thinks they're on the latest version.

### Gap 2: Sidecar shutdown is best-effort only

Current behaviour:
- Graceful Cmd+Q → `SidecarState` drops → `Child` drops → `kill_on_drop` fires SIGKILL ✓
- macOS force-quit / process crash / OOM → parent dies before Drop runs → sidecar orphans ✗

For production smoothness, add (`src-tauri/src/lib.rs`):

```rust
.build(tauri::generate_context!())?
.run(|app, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
        // Soft-stop the sidecar with a 1s grace period for in-flight RPCs.
        if let Some(state) = app.try_state::<sidecar::SidecarState>() {
            let _ = tauri::async_runtime::block_on(async {
                tokio::time::timeout(
                    std::time::Duration::from_secs(1),
                    state.call("shutdown", serde_json::Value::Null),
                ).await
            });
        }
        // kill_on_drop in sidecar.rs still SIGKILLs on the way out.
    }
});
```

And the Python sidecar adds a `method_shutdown` that flushes any in-flight transcribe progress to disk and returns `{"ok": true}`.

### Gap 3: No "Restart later" UX

Current `applyUpdate()` is one shot: click → download → relaunch. A user mid-transcribe loses work.

Split into two steps:

```ts
// stage 1: download to a staged path (don't apply)
const staged = await update.download();   // hypothetical Tauri 2.x API
setUpdateBanner({ kind: "staged", staged });

// stage 2: when user clicks "Restart now"
await staged.install();
await relaunch();
```

Tauri's `tauri-plugin-updater` does support `download()` separate from `install()` — we currently use the combined `downloadAndInstall()` shortcut. Splitting is ~10 LOC.

Banner text once staged: *"0.4.X downloaded — restart to install. **Restart now** · **Later**"*

### Gap 4: No post-relaunch verification

After `relaunch()` succeeds, the new binary launches but nothing asserts it's actually the new version. If the install was corrupted or the user reverts via timing magic, we don't know.

Add to `App.tsx` boot:
```ts
// Persist the version we *intended* to be running across the restart.
const intended = localStorage.getItem("liquidclips:post-update-version");
if (intended) {
  const actual = await getVersion();
  if (actual !== intended) {
    // Send to telemetry; surface a "update may not have completed" banner.
    void reportDesktopError("update_verification_failed", { intended, actual });
  }
  localStorage.removeItem("liquidclips:post-update-version");
}
```
Set it just before `relaunch()` in `applyUpdate()`.

### Gap 5: No rollback path

If 0.4.X boot-loops, the user can't get back to 0.4.X-1 without manual `.app` re-install. Tauri updater doesn't ship a rollback.

Workaround: keep a copy of the previous `.app` at install time (rename to `Liquid Clips.app.previous` inside the bundle's parent dir). If startup detects a "we just updated and it's the third boot in 60s" pattern, swap back and fire telemetry.

**Lower priority than Gaps 1-4.** Defer until we have a real boot-loop incident.

---

## Manifest requirements (`updates.liquidclips.app/latest.json`)

Required shape per Tauri 2 updater:
```json
{
  "version": "0.4.34",
  "notes": "Liquid Clips 0.4.34 — rebrand foundation",
  "pub_date": "2026-05-28T17:00:00Z",
  "platforms": {
    "darwin-x86_64":  { "signature": "<base64 minisign>", "url": "https://api.jnremployee.com/updates/download/darwin-x86_64" },
    "darwin-aarch64": { "signature": "<base64 minisign>", "url": "https://api.jnremployee.com/updates/download/darwin-aarch64" }
  }
}
```

Notes:
- The `signature` MUST be the Minisign signature of the `.app.tar.gz` that the `url` returns. Tauri downloads the .tar.gz, verifies against the public key in `tauri.conf.json`, then unpacks.
- Universal binary: we upload the SAME `.app.tar.gz` under both arch slots (`release.sh` fan-out loop). Either arch's installed app pulls the same bundle.
- Both arches MUST report the same `version` string — Tauri's per-arch check fails open if mismatched.

---

## Sidecar shutdown requirements

| Path | Mechanism | Status |
|---|---|---|
| User clicks Quit / Cmd+Q | SidecarState drops → Child drops → kill_on_drop SIGKILLs sidecar | ✅ works |
| Tauri updater calls relaunch() | App exits → SidecarState drops → kill_on_drop SIGKILLs sidecar | ✅ works (same path) |
| macOS force-quit (Activity Monitor → Force Quit) | parent SIGKILLed → no Rust Drop runs → sidecar orphans | ❌ unfixable from inside the app; `local-install.sh` reaps |
| App crashes on uncaught panic | parent dies → no Drop → sidecar orphans | ❌ same; mitigate via Sentry-style crash reporting later |
| In-flight RPC during quit (transcribe in progress) | SIGKILL mid-call → Python's process tree dies → in-flight ffmpeg/yt-dlp also die | ⚠️ no graceful save; soft-stop RPC (Gap 2) would let sidecar checkpoint progress |

---

## Version source of truth

Single chain: `package.json` → `tauri.conf.json` → built bundle's `Info.plist` → `getVersion()` in React → version pill in `Logo.tsx`.

Every link is automated:
- `ship.sh` writes both `package.json` and `tauri.conf.json` from the CLI arg.
- `tauri build` writes `Info.plist` from `tauri.conf.json` `.version`.
- `getVersion()` (from `@tauri-apps/api/app`) reads `Info.plist` at runtime.
- `Logo.tsx` renders `v{version}` from the hook.

**There is no hardcoded version string anywhere.** If the UI pill says `v0.4.33` while you think you're on 0.4.34, the bundle is genuinely 0.4.33 — not a display bug.

To verify before testing: `plutil -p "/Applications/Liquid Clips.app/Contents/Info.plist" | grep CFBundleShortVersionString`.

---

## Rollback / failure behaviour (today)

| Failure | Behaviour |
|---|---|
| Manifest 404 / network error | `checkForUpdate()` returns `{ kind: "error", message }` — no banner shown; existing app keeps running. |
| Signature verification fails | `downloadAndInstall()` throws — `applyUpdate()` catches, sets `{ kind: "error" }`. User sees "Update didn't finish — we'll retry next launch." |
| Download partial / corrupt | Same as signature failure (Tauri checks signature after download). |
| New binary won't launch | No automatic rollback (Gap 5). User must reinstall manually. |
| Sidecar fails to start in new binary | Splash hangs on "booting…" indefinitely. Currently no timeout banner. |

---

## QA checklist for every release

Before announcing "0.4.X is live":

1. [ ] **Source bump** — `package.json` + `tauri.conf.json` both report new version
2. [ ] **Build artifact** — `target/release/bundle/macos/Liquid Clips.app/Contents/Info.plist` reports new version
3. [ ] **Signature** — `codesign --verify --deep --strict --verbose=2 "Liquid Clips.app"` returns 0 (skip if APPLE_SIGNING_IDENTITY unset for local QA)
4. [ ] **Notarization** — `xcrun stapler validate "Liquid Clips.app"` returns "The validate action worked!" (skip for local QA)
5. [ ] **Manifest** — `curl https://updates.liquidclips.app/latest.json | jq '.version'` reports new version
6. [ ] **Both arches in manifest** — `jq '.platforms | keys'` returns `["darwin-aarch64", "darwin-x86_64"]`
7. [ ] **Notes text** — `jq '.notes'` doesn't contain "Junior" (rebrand sanity)
8. [ ] **Fresh install via Tauri updater** — install previous version on a clean account, wait for the banner, click "Restart to install", verify Logo pill shows new version after relaunch
9. [ ] **Sidecar reaped** — `pgrep -f sidecar.py` returns empty 5s after Cmd+Q
10. [ ] **Activation deep-link** — sign-in flow returns `liquidclips://activate?…` and app unlocks without macOS "no application found" dialog

If any step fails, the release isn't ready. Cycle back to the failed step, fix, rebuild.

---

## Two-track summary

| Track | Tool | Audience | Production? |
|---|---|---|---|
| Local QA install | `scripts/local-install.sh` | Daniel + future devs | ❌ never |
| Production update | Tauri updater + `ship.sh` + `release.sh` + updates.liquidclips.app | All customers | ✅ canonical |

The local script will keep existing for the inner dev loop. The customer experience must be Tauri updater + signed manifest, full stop.
