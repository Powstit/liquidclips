# Changelog

All notable changes to Liquid Clips (desktop-2 architecture) are
recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

The desktop-2 architecture is the planned successor to legacy
`desktop/` · it ships a new design-OS shell, an Iron-Gate-locked
auth surface, and a tier-aware route gate. It does NOT yet ship the
Python sidecar + clip pipeline · those land in a future feature
sprint and are explicitly out of 0.8.0 scope.

---

## [0.8.0-beta] · 2026-06-19

**Phase 1 critical-path beta · shell + auth + tier + settings only.**

This is the first desktop-2 build with a packaged installer + signed
auto-update chain. It is intentionally a foundation release · the
clip workbench, transcribe + publish, and rewards surfaces are NOT
in this build. Legacy `desktop/` users should stay on 0.7.51 until
the next desktop-2 release closes the feature gap.

### Added

- **Boot + intro chain** · cinematic boot intro · Kade-guided welcome
  flow · sim-route grammar (`sim-stage` / `sim-welcome` / `sim-eb` /
  `sim-h1` / `sim-sub`).
- **Auth surface** · `LoginOnboarding` flow (7 states + already-activated
  branch) · system-browser sign-in via deep link · activation state
  machine + parser at `lib/activation.ts` · Tauri-native deep link
  subscriber at `lib/deepLinkBoot.ts` · post-activation orchestrator
  with try/catch hardening · App-root boot wiring.
- **Auth storage** · central `lib/authStorage.ts` module with 3-layer
  fallback (in-memory · localStorage · native Keychain via Tauri
  command bridge) · `app.liquidclips.auth.v1` namespace (Iron Gate
  IG-014 forward-compat with legacy desktop).
- **401/403 self-heal** · `FetchOutcome<T>` discriminated union
  drives `lib/activation.ts` · session-scoped dampener prevents auth
  storms while permitting one clean sign-out per session.
- **Native macOS Keychain bridge** · 3 Tauri commands
  (`secret_get_jwt` / `secret_set_jwt` / `secret_delete_jwt`) via the
  `keyring v3` crate (apple-native + windows-native + secret-service).
- **Migration backfill** · upgrading legacy desktop users land here
  with their license JWT in localStorage · `initAuthStorage`
  silently primes the native Keychain on first boot.
- **`useMe()` hook** · single-flight `/me` loader · MeSnapshot with
  email · userId · clerkId · whopUserId · affiliateId · rawTier ·
  effectiveTier · adminOverride · billingProvider · subscriptionStatus ·
  paidUntil · network/500 preserves last snapshot (degraded mode).
- **Tier surface** · `useTierCaps()` reads `/me` → resolves with
  source-aware ladder (debug-override > real-http > session-cache >
  fixture-fallback > unknown) · `mapBackendTier()` covers v1+v2 tier
  spellings · `TierSource` + `loading` + `adminOverride` exposed to
  consumers.
- **Boot gate** · `AuthGate` wraps `<AppShell />` · re-evaluates on
  every activation transition · network/500 preserves JWT so the gate
  stays open during outages · invalid auth flips to LoginOnboarding.
- **Agency action gate** · `canUseAgencyActions({tier, source})` ·
  requires agency tier AND trusted source (real-http or
  session-cache) · fixture-fallback users cannot accidentally open
  write surfaces · debug-override is explicitly NOT trusted.
- **Settings surface** · 9 sections (Account · Connection status ·
  Connected accounts · Plan & access · Whop role · Storage & security
  · Beta diagnostics · Support & help · Actions) · tier pill reads
  from real `/me` · refresh button reloads activation + `/me` in
  parallel · 3-state connection vocabulary (Connected / Not connected
  / Not checked yet) · honest copy throughout.
- **macOS installer** · clean semver `0.8.0` · full 8-icon set ·
  `bundle.macOS` config with Apple Developer ID `KT68NGT4LX` · slim
  `entitlements-direct.plist` (WebView JIT only · sidecar flags
  preserved as commented stubs).
- **Helper scripts** · `bump_patch.sh` · `strip-xattrs.sh` ·
  `sign-clean-macos-app.sh` · `package-signed-macos-artifacts.sh` ·
  `notarize.sh` · `local-install.sh` (slim ports of legacy
  · `liquid-clips-shell` binary name) · `ship.sh` for end-to-end
  release.
- **Auto-update chain** · `tauri-plugin-updater` + `tauri-plugin-process`
  wired · `plugins.updater` config block (endpoint
  `https://updates.liquidclips.app/latest.json` · minisign pubkey
  `B1E037066BFCE444` shared with legacy · Windows installMode passive)
  · `createUpdaterArtifacts: true`.
- **CI release workflow** · `.github/workflows/release-desktop-2.yml`
  triggered by `desktop-2-v*.*.*` tags · 2-arch matrix (aarch64 +
  x86_64) · Iron Gate IG-013 notarisation chain inherited from
  legacy · slimmed by removing Python-sidecar build steps.
- **Release runbook** · `RELEASING.md` documents the full chain end-
  to-end.

### Known limits (NOT in 0.8.0)

- No clip workbench. No transcribe. No reframe. No animated captions.
- No Python sidecar. No ffmpeg / faster-whisper bundling.
- No publishing (Ayrshare integration).
- No Earn tab. No Browse Rewards. No campaign builder.
- No Settings "Check for updates" button · the `lib/updater.ts` API
  is wired but no UI consumer exists yet · the auto-update prompt
  still fires on app launch.
- No Windows installer · post-beta scope.

### Security

- License JWT lives in native Keychain (preferred) · localStorage
  fallback · in-memory cache.
- No JWT value is ever logged · console.log audit clean.
- No JWT value is ever surfaced in UI · Settings → Storage shows the
  storage key constant only.
- Hardened runtime entitlements + Apple Developer ID notarisation on
  every CI build.

### Infrastructure

- All 6 GitHub Actions secrets verified present on
  `Powstit/Jnr-employee` (APPLE_CERTIFICATE · APPLE_CERTIFICATE_PASSWORD
  · APPLE_ID · APPLE_PASSWORD · APPLE_TEAM_ID · TAURI_SIGNING_PRIVATE_KEY).
- Updater manifest endpoint live at
  `https://updates.liquidclips.app/latest.json` (HTTP 200).
- Backend `POST /updates/upload` gated by `INTERNAL_API_SECRET` ·
  unchanged from legacy chain.

---

## Pre-0.8.0

The desktop-2 architecture was built up across June 2026 as a slim
shell beside the live legacy `desktop/` v0.7.x line. There are no
public pre-0.8.0 desktop-2 releases · the iteration history lives in
`docs/PHASE_1_CRITICAL_PATH.md` and the per-phase audit docs in
`docs/`.
