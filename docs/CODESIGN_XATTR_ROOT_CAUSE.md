# Codesign xattr loop — root cause + fix

Task #49 diagnostic. Static audit only — no build was run. The doc captures what is actually on disk today (2026-06-03), what each existing mitigation does, why the local loop keeps recurring, and the concrete next step.

> Constraints honoured: no `npm run tauri build`, no edits to `package.json` or `tauri.conf.json` (v0.5.0 is locked for an in-flight release). Recommendations below are proposals for Daniel to review.

---

## 1. What xattrs are actually present (observed, not theoretical)

Captured from `ls -la@` on the existing build output at
`/Users/dipdip/Desktop/jnr/desktop/src-tauri/target/release/bundle/macos/`.

### 1a. On the freshly-built `.app` (after Tauri finished, before any manual fix)

```
drwxr-xr-x@ 3 dipdip  staff  96  2 Jun 13:28 Liquid Clips.app
    com.apple.FinderInfo            32
    com.apple.fileprovider.fpfs#P    4

drwxr-xr-x@ 5 dipdip  staff 160  2 Jun 13:28 Contents
    com.apple.FinderInfo            32
    com.apple.fileprovider.fpfs#P    4
```

Nothing inside `Contents/MacOS/junior-desktop`, `Contents/Resources/`, or `Contents/Resources/_up_/python-sidecar/bin/{ffmpeg,ffprobe,junior-face-detect}` carries xattrs. The `python-sidecar/` source tree is also clean. **The xattrs are on the `.app` bundle directory and on `Contents/` only.**

### 1b. On every ancestor directory of the build

```
~/Desktop/                                          (Desktop itself)
    com.apple.file-provider-domain-id   80
    com.apple.fileprovider.detached#B  875
    com.apple.icloud.desktop            11
    com.apple.macl                     144

~/Desktop/jnr/
    com.apple.macl                      72

~/Desktop/jnr/desktop/                              (parent has macl set on it)
~/Desktop/jnr/desktop/.DS_Store
    com.apple.FinderInfo                32
~/Desktop/jnr/desktop/CLAUDE.md
    com.apple.provenance                11
```

`defaults read com.apple.finder FXICloudDriveDesktop` → `1`. **iCloud Desktop & Documents sync is ENABLED, and the entire `~/Desktop/jnr/` tree is under macOS File Provider control.** That is the single fact that explains the whole loop.

---

## 2. Which step injects them

Tauri's bundler is not creating these xattrs. ffmpeg / ffprobe / the Python sidecar files have **no** xattrs in either the source tree or the bundle. Tauri's own `codesign` call is also not the source — codesign is the *victim*, it's what trips over them.

The injector is the **macOS File Provider daemon (`fileproviderd`)**, driven by iCloud Desktop & Documents sync. The keys observed prove it:

| Key                              | Owner / meaning                                                                                                       |
|----------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| `com.apple.fileprovider.fpfs#P`  | File Provider FS placeholder marker — added by `fileproviderd` when it begins tracking a directory                    |
| `com.apple.fileprovider.detached#B` | File Provider detached/offline state                                                                                 |
| `com.apple.file-provider-domain-id` | File Provider domain ID (iCloud Drive domain on `~/Desktop`)                                                       |
| `com.apple.icloud.desktop`       | iCloud Desktop & Documents domain marker on `~/Desktop`                                                               |
| `com.apple.FinderInfo`           | Finder / Spotlight metadata — what codesign explicitly rejects as "resource fork, Finder information, or similar detritus" |
| `com.apple.macl`                 | Sandbox/TCC managed app-list reference (harmless to codesign but appears alongside)                                   |
| `com.apple.provenance`           | Gatekeeper provenance — set on edited files                                                                           |
| `com.apple.quarantine`           | Standard download quarantine — not present on the build artefacts today, but commonly observed after fresh fetches    |

The lifecycle of one local build is therefore:

1. `cargo build` + Tauri bundling produces `Liquid Clips.app/` with no xattrs.
2. The bundle is created inside `target/release/bundle/macos/`. Within seconds `fileproviderd` notices the new directory and stamps `com.apple.fileprovider.fpfs#P` and `com.apple.FinderInfo` on the new `.app` and `Contents/` directories (these are *directory* xattrs, not file xattrs — that is why `strip-xattrs.sh` running before the bundle phase cannot help).
3. Tauri's signing pass walks the bundle and calls `codesign --force --deep --sign …`. codesign opens the directory, finds `com.apple.FinderInfo`, and aborts with `resource fork, Finder information, or similar detritus not allowed`.
4. Daniel manually `xattr -cr "<app>"`, re-signs, re-runs `local-install.sh`. By the time the second `codesign` runs, no new sync event has happened — so it succeeds.

CI passes because the GitHub `macos-latest` runner has no iCloud account signed in, so `fileproviderd` is inert. The same source tree, same Tauri config, same scripts — different host behaviour.

---

## 3. What `scripts/strip-xattrs.sh` does and why it isn't enough

`scripts/strip-xattrs.sh` exists (executable, 929 bytes) and is wired into `tauri.conf.json` as `build.beforeBundleCommand`. It strips xattrs from:

- `python-sidecar/*.py`, `python-sidecar/requirements.txt`, `python-sidecar/bin/`, `python-sidecar/models/`
- `src/`, `public/`, `assets/`, `dist/`
- `src-tauri/icons/`, `src-tauri/entitlements*`, `src-tauri/*.xcprivacy`
- `src-tauri/target/release/`

It is correct for what it does, but it can't fix the local loop because:

1. **It runs `beforeBundleCommand`, i.e. before Tauri creates the `.app`.** The xattrs that break codesign get stamped onto the `.app` and `Contents/` directories *after* the bundle is written — by `fileproviderd`, asynchronously. No amount of pre-bundle stripping reaches them.
2. **It strips inputs, but the offending xattrs live on the output bundle's directory inodes.** Even on a perfectly clean source tree, the freshly-created `.app/` will pick up `com.apple.fileprovider.fpfs#P` + `com.apple.FinderInfo` within seconds of being written under `~/Desktop`.
3. **Tauri does not expose an `afterBundleCommand` hook**, and the codesign call is internal to Tauri's bundler — there's no documented hook that fires between "bundle written" and "codesign". So a post-bundle strip script can only run after Tauri has already failed.

The same script in CI (`.github/workflows/release.yml` lines 95–110) works for a different reason: the runner has no File Provider domain, so the inputs being clean is the whole story.

---

## 4. Fix recommendations — ranked by effort vs. permanence

### Recommendation A (permanent, recommended): move the build out from under iCloud

Move the build output away from `~/Desktop/` to a path the File Provider does not own.

Two flavours:

**A1 — Cheap: relocate the target dir only.** Set
```bash
export CARGO_TARGET_DIR="$HOME/.cache/jnr-target"
```
in `~/.zshrc` (or in a wrapper `scripts/local-build.sh`). The source tree stays where it is. Tauri reads `target/` from cargo, so the bundle will be produced at
`$HOME/.cache/jnr-target/release/bundle/macos/Liquid Clips.app`,
outside any File Provider domain. `local-install.sh`'s `SRC=` would need to follow the same env var.

This kills the loop without touching `tauri.conf.json` or moving the repo.

**A2 — Cleanest: relocate the whole repo.** Move `~/Desktop/jnr` to `~/Code/jnr` (or `~/src/jnr`). Eliminates the problem class entirely (no more `com.apple.provenance` stamping on edited files, no more `.DS_Store` xattr churn, faster `git status`). Recommended once v0.5.0 ships; out of scope while the release is in flight.

### Recommendation B (immediate, no-move workaround): strip on the bundle *directory* right before signing

Tauri does not expose an `afterBundleCommand`, but it does shell out to `codesign` internally. The cheapest no-config patch is a wrapper script that:

1. Runs `npm run tauri build -- --bundles app` *without* the internal signing identity.
2. Strips xattrs on the resulting `.app` and recursively.
3. Calls `codesign` manually.

Concretely — new script `scripts/build-local.sh`:

```bash
#!/usr/bin/env bash
# build-local.sh — work around iCloud File Provider stamping xattrs onto the
# newly-bundled .app under ~/Desktop, which makes Tauri's internal codesign fail.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

APP="src-tauri/target/release/bundle/macos/Liquid Clips.app"
IDENTITY="Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)"

npm run tauri build -- --bundles app
# Wait a beat for fileproviderd to settle, then strip directory-level xattrs.
sleep 1
xattr -cr "$APP"
# Belt-and-braces: explicitly nuke FinderInfo on the two directories observed.
xattr -d com.apple.FinderInfo "$APP" 2>/dev/null || true
xattr -d com.apple.FinderInfo "$APP/Contents" 2>/dev/null || true
codesign --force --deep --options runtime --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
```

Trade-off: this works because we accept Tauri's signing may have failed mid-pass and we re-sign cleanly afterwards. The downside is that Tauri's signing already wrote some signatures into nested binaries before failing; a manual `--force --deep` overwrites them — that's fine for Developer ID signing, and the CI path (which is the source of truth for shipped releases) is unaffected.

**This is the smallest change that ends the manual loop today.**

### Recommendation C (helpful regardless of A/B): also add a Spotlight exclusion

`mdutil -i off "$HOME/Desktop/jnr/desktop/src-tauri/target"`

Spotlight does not stamp `FinderInfo` (the File Provider daemon does), but mdworker indexing the same tree adds wall-clock pressure and can race with codesign on file inodes. Cheap and reversible.

### Recommendation D (do NOT do)

- Do **not** disable iCloud Desktop & Documents wholesale — Daniel uses it for other directories. Move the build out instead.
- Do **not** add an `afterBundleCommand`-style hook into `tauri.conf.json`. The config is locked for v0.5.0, and Tauri 2 does not expose a stable post-bundle pre-sign hook. The wrapper script in Rec B keeps everything outside the locked config.
- Do **not** keep extending `strip-xattrs.sh` to strip more source paths. The source tree was already clean in the captured run; the issue is on the output `.app` directory.

---

## 5. Suggested patch to `scripts/local-install.sh`

`local-install.sh` already clears `com.apple.quarantine` on the *installed* app at `/Applications/Liquid Clips.app` (line 82). It does not strip xattrs on the source bundle before copying. A two-line addition gives the install path the same safety net as the build path:

```diff
 step "Preflight"
 [ -d "$SRC" ] || fail "Built bundle not found at $SRC — run 'npm run tauri build -- --bundles app' first"
+# Strip File Provider / Finder xattrs that get stamped onto the .app while it
+# sits under ~/Desktop (iCloud Desktop & Documents). codesign rejects these.
+xattr -cr "$SRC" 2>/dev/null || true
 SRC_VER="$(plutil -p "$SRC/Contents/Info.plist" | awk -F'"' '/CFBundleShortVersionString/{print $4}')"
```

This is safe (idempotent, no-op when there are no xattrs) and removes one common manual step even without Recommendation A or B.

---

## 6. Summary

- **Root cause**: iCloud Desktop & Documents (`FXICloudDriveDesktop=1`) puts the entire `~/Desktop/jnr/` tree under a macOS File Provider domain. After Tauri writes the `.app`, `fileproviderd` stamps `com.apple.FinderInfo` and `com.apple.fileprovider.fpfs#P` onto the new `.app/` and `Contents/` directories. Tauri's internal `codesign` then aborts with "resource fork, Finder information, or similar detritus not allowed". `strip-xattrs.sh` runs *before* the bundle is created, so it can't help. CI works because the runner has no iCloud account.
- **Fix (now)**: add `xattr -cr "$SRC"` to `local-install.sh` (one-line, safe). Add a thin `scripts/build-local.sh` wrapper that calls `tauri build`, strips xattrs on the output bundle, then re-signs manually with `--force --deep --options runtime`. Optionally `mdutil -i off` the target dir.
- **Fix (permanent)**: set `CARGO_TARGET_DIR=$HOME/.cache/jnr-target` (and update `local-install.sh`'s `SRC=`) so the build output lives outside any File Provider domain. Or move the whole repo to `~/Code/jnr` after v0.5.0 ships.
- **Do not touch**: `package.json`, `tauri.conf.json` (locked for v0.5.0), or `strip-xattrs.sh` (it's correct for what it does, just insufficient on its own).
