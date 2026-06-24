# P1-4-a · Installer + Update Pipeline Audit (desktop-2)
### Pre-build investigation · NO CODE · file/path inventory only

*Date · 2026-06-19 · Author · Claude · Audit-only deliverable*

The purpose: inventory the current state of desktop-2's installer / notarisation / auto-update pipeline against the proven legacy `desktop/` chain · produce a gap matrix · recommend the exact P1-4-b through P1-4-e build order · identify what blocks the 100-clipper beta.

No code changes. No Cargo edits. No CI edits. No packaging changes.

---

## 0 · Headline

- **desktop-2's installer + updater pipeline is ZERO-WIRED.** No signing identity · no notarisation · no updater plugin · no CI · no release scripts · no entitlements file · `createUpdaterArtifacts: false`. The Cargo + tauri.conf are at "raw shell" defaults.
- **Legacy `desktop/` ships a fully working IG-013-locked pipeline** for macOS · proven through v0.7.51 (2026-06-11). 10 GH secrets · per-arch + universal DMG · auto-update via `https://updates.liquidclips.app/latest.json` · backend manifest upload via `junior-backend`.
- **The legacy chain ports MOSTLY clean** because both apps share `app.liquidclips.desktop` identifier · `Developer ID Application: KT68NGT4LX` cert · same updater URL · same minisign pubkey. Risks: Tauri 1→2 syntax (already on 2.x for both), and the `version: "0.8.0-shell"` semver suffix that does not parse cleanly as a release version.
- **Windows installer = greenfield · not wired in legacy either.** Per `desktop/CLAUDE.md` legacy is "Tauri 2 macOS app" · no Windows path shipped. Beta scope decision needed before P1-4-c.
- **100-clipper beta blockers (3) ·** macOS notarised installer · auto-update wiring · CI publish chain. Linux is not in scope per ROADMAP_LOCK.
- **Recommended order (4 sub-units, audit-only this phase) ·** P1-4-b macOS installer port → P1-4-c Windows installer scope decision (or defer) → P1-4-d auto-update wiring → P1-4-e release docs.

---

## 1 · desktop-2 current state (file/path inventory)

### 1.1 · Tauri shell

| File | State | Notes |
|---|---|---|
| `desktop-2/src-tauri/tauri.conf.json` | **shell-grade** | `version: "0.8.0-shell"` (non-semver suffix) · `identifier: app.liquidclips.desktop` ✓ · `bundle.targets: "all"` · `bundle.icon: ["icons/icon.png"]` (no icns / no full icon set) · `createUpdaterArtifacts: false` · **NO** `macOS.signingIdentity` · **NO** `macOS.entitlements` · **NO** `bundle.macOS.minimumSystemVersion` · **NO** `bundle.resources` · **NO** `plugins.updater` |
| `desktop-2/src-tauri/Cargo.toml` | **minimal** | `tauri = "2"` · `tauri-plugin-deep-link = "2"` · `serde` · `serde_json` · `keyring = "3"` (P1-1F-b) · **NO** `tauri-plugin-updater` |
| `desktop-2/src-tauri/src/lib.rs` | Updated P1-1F-b | 3 keychain commands · deep-link plugin · no updater wiring |
| `desktop-2/src-tauri/capabilities/default.json` | exists | default permissions only |
| `desktop-2/src-tauri/icons/` | **minimal** | `icon.png` only · no `icon.icns` · no Windows `.ico` · no per-resolution PNGs (16/32/64/128/512) |
| `desktop-2/src-tauri/build.rs` | default | unchanged from `tauri init` |

### 1.2 · JS / package.json

| File | Updater dep? | Release script? |
|---|---|---|
| `desktop-2/package.json` `dependencies` | **NO `@tauri-apps/plugin-updater`** | scripts: `dev` · `build` · `preview` · `tauri` · `guard` (assert-shell-contracts) · **no release/ship/notarize entries** |

### 1.3 · CI / release infrastructure

| Path | Exists? |
|---|---|
| `desktop-2/.github/` | **DOES NOT EXIST** |
| `desktop-2/.github/workflows/release.yml` | absent |
| `desktop-2/.github/workflows/*.yml` | none |

### 1.4 · Scripts

| Path | Purpose | Release-related? |
|---|---|---|
| `desktop-2/scripts/assert-shell-contracts.sh` | shell-freeze guard | NO |
| `desktop-2/scripts/capture-*.cjs` × 7 | puppeteer screenshot harnesses | NO |
| `desktop-2/scripts/screenshot-*.cjs` × 2 | screenshot tools | NO |
| `desktop-2/scripts/bump_patch.sh` | **MISSING** (legacy has this) | n/a |
| `desktop-2/scripts/cloud-ship.sh` | **MISSING** | n/a |
| `desktop-2/scripts/local-install.sh` | **MISSING** | n/a |
| `desktop-2/scripts/sign-clean-macos-app.sh` | **MISSING** | n/a |
| `desktop-2/scripts/package-signed-macos-artifacts.sh` | **MISSING** | n/a |
| `desktop-2/scripts/notarize.sh` | **MISSING** | n/a |
| `desktop-2/scripts/strip-xattrs.sh` | **MISSING** | n/a |

### 1.5 · Signing / entitlements artifacts

| Path | Exists? |
|---|---|
| `desktop-2/src-tauri/entitlements*.plist` | **MISSING** (legacy has `entitlements-direct.plist`) |
| `desktop-2/src-tauri/Info.plist` | absent (Tauri generates from conf · OK) |
| Code-sign helpers | none |
| Notarytool keychain profile reference | none |

**Net ·** desktop-2 has zero of the 10 GH secrets configured · zero release scripts · zero CI workflows · zero entitlements file · zero updater wiring. It is greenfield in the installer/updater lane.

---

## 2 · Legacy reference (what to port)

| Component | Legacy file | Status | Portability |
|---|---|---|---|
| Bundle config + signing identity | `desktop/src-tauri/tauri.conf.json:74-83` | ✓ shipping `Developer ID Application: KT68NGT4LX` + updater URL + base64 pubkey | **Port clean** · same identifier + cert |
| Updater plugin (JS) | `@tauri-apps/plugin-updater` in `desktop/package.json` | wired | **Add to desktop-2 deps** |
| Updater plugin (Rust) | `tauri-plugin-updater = "2"` in `desktop/src-tauri/Cargo.toml` | wired | **Add to desktop-2 Cargo** |
| Hardened-runtime entitlements | `desktop/src-tauri/entitlements-direct.plist` | required for sidecar JIT (Whisper/NumPy) | **Re-evaluate** · desktop-2 doesn't have a Python sidecar yet · simpler entitlements possible |
| Tag-triggered release workflow | `desktop/.github/workflows/release.yml` | IG-013 locked · 14 steps · per-arch matrix · 10 secrets | **Port with adjustments** · drop sidecar steps · keep IG-013 chain verbatim |
| Notarisation script | `desktop/scripts/notarize.sh` | IG-013 locked · `xcrun notarytool submit --wait` + `xcrun stapler staple` | **Port verbatim** · contract frozen |
| Repair-sign workaround | `desktop/scripts/sign-clean-macos-app.sh` | rsync clean + xattr strip + re-sign · Tauri-default DMG-bug workaround | **Port verbatim** |
| DMG repack | `desktop/scripts/package-signed-macos-artifacts.sh` | rebuilds `.dmg` + `.app.tar.gz` from clean signed `.app` | **Port verbatim** |
| Cloud-ship local rehearsal | `desktop/scripts/cloud-ship.sh` | IG-009 8-step locked flow · used for local cycle test | **Port verbatim** · matches CI exactly |
| Version bump | `desktop/scripts/bump_patch.sh` | semver patch bump in `package.json` + `tauri.conf.json` | **Port clean** |
| Local install | `desktop/scripts/local-install.sh` | atomic install to `/Applications/` for visual review | **Port clean** |
| Updater manifest serving | `junior-backend` `/updates/upload` + `/updates/latest.json` proxy at `https://api.jnremployee.com/updates/*` + Vercel proxy at `https://updates.liquidclips.app/latest.json` | live · serves legacy | **Reuse as-is** · backend already serves both arches |
| Updater pubkey | base64 in legacy `tauri.conf.json:82` · fingerprint `B1E037066BFCE444` | live | **Copy verbatim** · same key serves both apps OR mint new key (changes user-facing trust dance) |

---

## 3 · Gap matrix

### 3.1 · macOS pipeline

| Component | desktop-2 today | Legacy reference | Severity |
|---|---|---|---|
| Semver bundle version | `"0.8.0-shell"` (non-semver suffix) | `"0.7.78"` clean semver | **HIGH** · breaks tag-triggered CI (tag regex `v[0-9]+.[0-9]+.[0-9]+`) |
| `Developer ID` signing identity in tauri.conf | not declared | `Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)` | HIGH · build won't sign |
| Hardened-runtime entitlements | none | `entitlements-direct.plist` exists | HIGH · notarisation requires hardened runtime |
| Full icon set (`.icns` + `.ico`) | only `icon.png` | full set in `desktop/src-tauri/icons/` | MED · Tauri's bundle step requires `.icns` for macOS DMG |
| `createUpdaterArtifacts` | `false` | `true` | HIGH · no `.app.tar.gz` + `.app.tar.gz.sig` produced |
| Updater plugin (JS + Rust) | not installed | wired both sides | HIGH · update path completely absent |
| Updater config in `tauri.conf.json` | not declared | `endpoints + pubkey + installMode: passive` | HIGH |
| CI release workflow | none | `release.yml` 274 lines · 14 steps | HIGH · zero release automation |
| Notarisation script | none | `notarize.sh` 95 LOC | HIGH |
| Repair-sign script | none | `sign-clean-macos-app.sh` 100 LOC | HIGH |
| DMG repack script | none | `package-signed-macos-artifacts.sh` 91 LOC | HIGH |
| `cloud-ship.sh` local rehearsal | none | exists | MED · CI alone works · local rehearsal is operator confidence |
| `local-install.sh` | none | exists | LOW · review-only path |
| GH secrets | 0 set | 10 set on `Powstit/liquidclips` since 2026-06-02 | HIGH · cannot sign or notarise |

### 3.2 · Windows pipeline

| Component | desktop-2 | Legacy |
|---|---|---|
| Anything | **NONE** | **NONE** · legacy ships macOS-only per `desktop/CLAUDE.md` "Tauri 2 macOS app" |

Windows beta path is greenfield. Scope decision required.

### 3.3 · Auto-update plumbing

| Component | desktop-2 | Legacy | Action |
|---|---|---|---|
| `tauri-plugin-updater` JS dep | NO | YES | Add `@tauri-apps/plugin-updater` to deps |
| `tauri-plugin-updater` Rust dep | NO | YES | Add `tauri-plugin-updater = "2"` to `Cargo.toml` |
| Plugin `init()` in `lib.rs` | NO | YES | Wire in `.plugin(tauri_plugin_updater::Builder::new().build())` |
| `tauri.conf.json` plugins.updater block | NO | YES (endpoints · pubkey · installMode) | Copy verbatim from legacy |
| Updater pubkey (Tauri side) | NO | base64 string in conf | Reuse or rotate |
| Updater signing key (CI side) | NO env vars | `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Reuse or rotate · if reuse, no user trust break |
| Backend `/updates/upload` + `/updates/latest.json` | live | live | **Reuse as-is** · zero backend work |
| Updater UI prompt | none | Tauri default | acceptable v1 |

---

## 4 · Recommended build order

Per Daniel's stop-and-report protocol · each sub-unit ships independently · `npx tsc --noEmit` + manual smoke before moving on.

### P1-4-b · macOS installer port (~1d)

**Sub-units:**

- **P1-4-b-1 ·** Version semver fix · `tauri.conf.json` `0.8.0-shell` → `0.8.0` (or `0.8.0-beta.1` if Daniel wants a pre-release tag prefix · CI tag regex would then need adjustment).
- **P1-4-b-2 ·** Bundle config · add `bundle.macOS.signingIdentity: "Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)"` + `bundle.macOS.entitlements: "./entitlements-direct.plist"` + `bundle.macOS.minimumSystemVersion: "11.0"` + full icon set (port `desktop/src-tauri/icons/` verbatim).
- **P1-4-b-3 ·** Entitlements file · port `desktop/src-tauri/entitlements-direct.plist` · evaluate which flags desktop-2 actually needs (no Python sidecar yet · could be simpler).
- **P1-4-b-4 ·** Helper scripts · port `bump_patch.sh` · `strip-xattrs.sh` · `sign-clean-macos-app.sh` · `package-signed-macos-artifacts.sh` · `notarize.sh` · `local-install.sh`. Adjust paths where they reference legacy-only artifacts (Python sidecar bins).
- **P1-4-b-5 ·** Confirm `Developer ID` + Apple-ID + app-specific password in local Keychain for solo notarize rehearsal. NO secret commits.

**Verification:** local `tauri build` produces signed `.app` · local `notarize.sh` succeeds · `xcrun stapler validate` clean.

### P1-4-c · Windows installer scope decision (audit-only · ~0.25d)

Before any Windows build:

- **Decision needed:** Is Windows in beta scope at all? Per `desktop/CLAUDE.md` legacy is macOS-only. If Windows is post-beta, **skip entirely · defer to P2**.
- **If in scope ·** P1-4-c-1: add Windows icon `.ico` to `icons/` · P1-4-c-2: `tauri.conf.json` `bundle.windows` config + WiX or NSIS choice · P1-4-c-3: Windows code-signing cert (separate from Apple Developer ID · either EV cert from a Windows CA or sigstore alternative · Daniel-decision required).
- **Recommend ·** defer to post-beta unless Daniel explicitly needs Windows for the 100-clipper beta. macOS-only is the proven path.

### P1-4-d · Auto-update pipeline (~0.5d)

- **P1-4-d-1 ·** Add `@tauri-apps/plugin-updater` to `package.json` deps + `tauri-plugin-updater = "2"` to `src-tauri/Cargo.toml`.
- **P1-4-d-2 ·** Wire `.plugin(tauri_plugin_updater::Builder::new().build())` in `src-tauri/src/lib.rs` (alongside existing `tauri_plugin_deep_link::init()`).
- **P1-4-d-3 ·** `tauri.conf.json` `plugins.updater` block · endpoints `https://updates.liquidclips.app/latest.json` · pubkey verbatim from legacy · `installMode: "passive"` (matches legacy).
- **P1-4-d-4 ·** Flip `bundle.createUpdaterArtifacts: true` so CI produces `.app.tar.gz` + `.app.tar.gz.sig`.
- **P1-4-d-5 ·** CI workflow · port `desktop/.github/workflows/release.yml` to `desktop-2/.github/workflows/release.yml` · drop the sidecar bin + Whisper model steps (no Python sidecar in desktop-2 yet · just the React + Tauri shell) · keep IG-013 chain verbatim · drop `GIPHY_API_KEY` / `PEXELS_API_KEY` / `PIXABAY_API_KEY` env vars (desktop-2 doesn't use them).
- **P1-4-d-6 ·** Configure 7 GH secrets on the desktop-2 repo · `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Daniel needs to copy from `Powstit/liquidclips` to wherever desktop-2 lives.
- **P1-4-d-7 ·** First rehearsal · tag `v0.8.0-rehearsal` · push · CI builds + notarises + uploads · check `latest.json` resolves.
- **P1-4-d-8 ·** Live update test · install older build → newer tag-triggered build → check passive update prompt + relaunch.

### P1-4-e · Release docs (~0.25d)

- `desktop-2/docs/RELEASING.md` · the 5-line "tag v0.8.X and push" runbook with rollback notes.
- Update `desktop-2/CLAUDE.md` (or create one) with: `Ship path = CI only` + the same IG-013 framing as legacy.
- Update `PHASE_1_CRITICAL_PATH.md` final status.

**Total P1-4 estimated effort (audit-only scoped today) · ~2 days for b+d+e if Windows deferred. ~3 days if Windows in beta.**

---

## 5 · macOS beta path (recommended)

```
[Day 1] P1-4-b · macOS installer port
  └── semver fix · bundle config · entitlements port · helper scripts
  └── verification · local tauri build + notarize.sh + stapler validate

[Day 2] P1-4-d · Auto-update pipeline
  └── plugin install · conf block · CI workflow port · 7 GH secrets
  └── verification · tag rehearsal · live update test

[Day 2.5] P1-4-e · Release docs
  └── RELEASING.md · update CLAUDE.md · close PHASE_1_CRITICAL_PATH.md
```

Single-machine cert + secrets transfer (from `Powstit/liquidclips` to wherever desktop-2 lives) is the highest-effort manual step · the rest is mechanical porting.

---

## 6 · Windows beta path

**Defer to post-beta unless Daniel says otherwise.** Legacy never shipped Windows · adding it adds 1-2 days of scope and a new code-signing cert procurement (~$200-400/yr · time to obtain). 100-clipper beta on macOS-only is the safest move.

**If Windows is required for 100-clipper beta:** add P1-4-c-1/2/3 between P1-4-b and P1-4-d · estimate +1.5d total · plus the Windows cert procurement timeline (1-3 days from EV CA · faster with self-signed but Windows SmartScreen warns).

---

## 7 · 100-clipper beta blockers

The 3 hard gates between today and 100-clipper readiness:

| # | Blocker | Sub-unit that closes it | Estimated effort |
|---|---|---|---|
| 1 | **No notarised installer ·** users hit Gatekeeper "cannot be opened" warning on first launch · the deal-killer for non-technical clippers | P1-4-b | 1d |
| 2 | **No auto-update pipeline ·** every patch ship requires every user to manually re-download · unscalable at 100 | P1-4-d | 0.5d |
| 3 | **No CI release workflow ·** every release requires manual macOS build + sign + notarise · no operator other than Daniel can ship | P1-4-d (CI port) | 0d additional (covered by d) |

Total clearance time · **~2 days** assuming Daniel can configure the 7 GH secrets quickly and the cert + secrets transfer doesn't hit a permissions snag.

---

## 8 · Risk table

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| **Cert + secret rotation breaks signing** · Apple Developer ID expires (typically 5y from issue) · app-specific password rotates · minisign key compromised | HIGH if missed · LOW per year | Pin cert expiry date in `RELEASING.md` · rotate audit alongside notarisation rehearsal · spare Apple Developer ID account ready |
| **Per-arch upload missing one slot** · users on the missing arch see "no update available" forever · v0.7.50 history | HIGH user-pain · MED likelihood without enforcement | Port `cloud-ship.sh` two-slot loop verbatim · add a CI gate that fails the run if only one slot uploads |
| **Unstapled DMG ships** · v0.7.50 actual incident · `find \| head -1` picked wrong file | HIGH · happened before | Port legacy's `rm` of stale tauri-default DMG before repack step + `xcrun stapler validate` hard gate |
| **Semver tag regex fails** · `0.8.0-shell` doesn't match `v[0-9]+.[0-9]+.[0-9]+` | HIGH · would silently skip CI | Semver fix in P1-4-b-1 first thing |
| **Hardened runtime config too restrictive (or too permissive)** · desktop-2 doesn't yet have a Python sidecar · legacy entitlements may be over-broad | LOW · cosmetic | Audit `entitlements-direct.plist` · drop JIT flags if not needed (re-add when sidecar lands) |
| **Updater pubkey rotation** · if Daniel rotates to a desktop-2-specific minisign key, all legacy users would lose update path | LOW (desktop-2 is a separate identifier · `app.liquidclips.desktop` collision) · MED if shared | Reuse legacy pubkey + private key for v1 simplicity · revisit per security review |
| **Vercel proxy at `updates.liquidclips.app` mistargets desktop-2 vs legacy** · both hit same `latest.json` | MED | Backend `/updates/upload` uses `x-release-*` headers per arch · investigate if it differentiates by bundle ID · may need a separate manifest endpoint for desktop-2 |
| **CI runner cost ·** matrix of arm64 + x86_64 macOS · per-tag · GH Actions paid minutes | LOW · ~$0.16 per build at current usage | Acceptable v1 |
| **Tauri 1 → 2 syntax in ported scripts** · both apps already on Tauri 2 · low risk | LOW | Already on 2 · audit confirmed |
| **Apple notarytool throughput** · 3-15 min queue time during peak · CI timeout if >30 min | LOW · rare | Inherits legacy's `--wait` retry pattern · no polling |
| **Backend `/updates/upload` not configured to receive desktop-2 builds** | MED if separate manifest needed | Backend audit during P1-4-d-1 · simple `if bundle_id === "app.liquidclips.desktop" → which manifest` decision |
| **Live walk verification depends on Daniel** | INHERENT · same constraint that has held throughout |

---

## 9 · Tracker update

`desktop-2/docs/PHASE_1_CRITICAL_PATH.md` should reflect:

- **Complete ·** add P1-4-a audit row
- **In progress ·** flip from P1-4-a to P1-4-b (queued, not started · per Daniel's stop-after-audit rule)
- **Current next action ·** P1-4-b · macOS installer port · semver + bundle config + entitlements + helper scripts
- **100-clipper readiness ·** still NO until P1-4-b + P1-4-d ship · estimated ~2 days post-authorization

Will write that update verbatim in the next step.

---

## 10 · File / path inventory (verification · no code changed)

| Inventory item | Verification |
|---|---|
| `tauri.conf.json` read · `0.8.0-shell` version confirmed · `createUpdaterArtifacts: false` confirmed | ✓ via `cat` only |
| `Cargo.toml` read · 5 deps (tauri · deep-link · serde · serde_json · keyring) · no updater | ✓ via `cat` only |
| `package.json` read · 7 plugin deps · no `@tauri-apps/plugin-updater` | ✓ via `grep` only |
| `.github/` absence confirmed | ✓ via `find` only |
| `scripts/` listed · 11 entries · all puppeteer/screenshot/assert · no release/sign/notarize | ✓ via `ls` only |
| `entitlements*.plist` absence confirmed | ✓ via `find` only |
| `icons/` content confirmed · `icon.png` only (no `.icns` / `.ico`) | ✓ via `ls` only |
| Legacy reference inventory at `desktop/` (tauri.conf · Cargo · CI · scripts · IG-013 chain · 10 secrets · updater serving) | ✓ via Explore agent · NO file modifications |
| Backend `/updates/upload` + `latest.json` reuse path | ✓ documented via legacy reference · no backend touched |

**Zero files modified · zero commands executed beyond `cat` · `ls` · `grep` · `find`.**

---

## 11 · TL;DR

- desktop-2 installer + updater pipeline = **zero-wired** · Cargo + tauri.conf at "raw shell" defaults.
- Legacy `desktop/` ships a proven IG-013-locked macOS chain through v0.7.51.
- 80% of legacy ports verbatim · 20% needs adjustment (semver fix · drop Python sidecar steps · entitlements re-evaluate · 7 GH secrets transfer).
- **3 blockers for 100-clipper beta ·** notarised installer · auto-update · CI workflow.
- **~2 days total** for P1-4-b + P1-4-d + P1-4-e if Windows deferred · the recommended path.
- **Windows · defer to post-beta** unless Daniel explicitly says otherwise.

---

*Audit complete · no code · no Cargo edits · no CI edits · no packaging changes · no UI · no auth · no rewards · no campaigns. Awaiting explicit P1-4-b authorization.*
