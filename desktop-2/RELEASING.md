# Releasing Liquid Clips · desktop-2

Single source of truth for cutting a desktop-2 release. If anything else
disagrees with this file, this file wins.

The release chain is CI-first · the script in §3 only bumps the
version + pushes a tag · GitHub Actions does the build + sign +
notarise + publish, and the script then mirrors the signed updater
artefacts to the backend so the auto-update manifest flips.

---

## 1 · Pre-reqs (one-time)

| Item | Where |
|---|---|
| Apple Developer ID cert in login Keychain | `security find-identity -p codesigning -v` shows `Developer ID Application: daniel diyepriye dokubo (KT68NGT4LX)` |
| notarytool keychain profile `LIQUIDCLIPS_NOTARY` | `xcrun notarytool store-credentials …` (only needed for LOCAL rehearsal of P1-4-b · CI uses APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID secrets directly) |
| GitHub CLI auth | `gh auth status` returns logged-in to `Powstit/liquidclips` |
| Backend secret on PATH | `INTERNAL_API_SECRET` env var · either exported or in `~/.claude-credentials/junior-internal.env` (the script sources it automatically) |
| Tooling | `node`, `npm`, `cargo`, `git`, `gh`, `jq`, `curl` |
| 6 GitHub secrets on `Powstit/liquidclips` | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY` (verified P1-4-d) |

A passphrased Tauri signing key would also need
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The current key is unpassphrased
· the workflow already references the env var but it can stay empty.

---

## 2 · What a ship is, exactly

A version is only shipped when ALL of:

1. The tag `desktop-2-vX.Y.Z` exists on `origin`.
2. GitHub Actions run `Release desktop-2` is **green** for both
   `aarch64` and `x86_64` matrix jobs.
3. The draft GitHub release `Liquid Clips desktop-2-vX.Y.Z` contains:
   - `Liquid.Clips_X.Y.Z_aarch64.dmg`
   - `Liquid.Clips_X.Y.Z_x86_64.dmg`
   - `Liquid.Clips_aarch64.app.tar.gz` + `.sig`
   - `Liquid.Clips_x86_64.app.tar.gz` + `.sig`
4. `POST https://api.jnremployee.com/updates/upload` has accepted both
   `darwin-aarch64` and `darwin-x86_64` artefacts.
5. `GET https://updates.liquidclips.app/latest.json?target=…` reports
   `"version": "X.Y.Z"` for **both** target slugs.

Steps 1-2 are CI's job. Step 3 is `gh release` content. Steps 4-5 are
what `scripts/ship.sh` finishes the chain with.

Local installs from the DMG attached to the draft release are fine for
review · but a user-facing release isn't done until step 5 above
returns the new version.

---

## 3 · Quick command

```bash
cd desktop-2
./scripts/ship.sh 0.8.0 "Phase 1 critical-path beta"
```

The script:

1. Preflights (tools · clean tree · branch · backend secret · GH auth).
2. Bumps `package.json` + `src-tauri/tauri.conf.json` to the new
   version.
3. Frontend type-check + build (fail-fast before the 15-min Rust CI).
4. Commits the bump + tags `desktop-2-vX.Y.Z`.
5. Pushes the current branch and the tag to `origin`.
6. `gh run watch` until both matrix arches go green (~15-25 min/arch).
7. `gh release download desktop-2-vX.Y.Z` to a temp dir.
8. `POST /updates/upload` × 2 (once per arch) with the
   `x-internal-secret` + signed `.app.tar.gz` body.
9. `curl https://updates.liquidclips.app/latest.json?target=…` × 2 ·
   asserts the manifest reports the new version.
10. Prints a summary with verified URLs.

Fail-fast on every step · if anything errors, the ship is incomplete
and the script exits non-zero before claiming success.

---

## 4 · Step-by-step what happens behind the script

This is what the script does, narrated so a human can shadow it if
something hangs.

### 4.a · Preflight

- Clean working tree (`git status --porcelain` must be empty)
- On `main` or `master` (refuses feature branches)
- `package.json` version is LOWER than the new version (no
  re-shipping)
- All 7 CLI tools resolve on PATH
- `INTERNAL_API_SECRET` is exported or sourced
- `gh auth status` returns OK

### 4.b · Bump

Edits two files:

- `package.json` → `"version": "X.Y.Z"`
- `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`

This is the only place version lives. Cargo.toml DOES carry a version
too but it tracks tauri.conf via the build · no need to bump
separately (the `liquid-clips-shell` package name + `[package].version`
are independent from the user-facing version).

### 4.c · Frontend build (fail-fast)

`npm run build` runs `tsc -b && vite build`. If types or bundling
break, we catch it now instead of after a 15-min CI run.

### 4.d · Commit + tag + push

- Commit message · `chore(desktop-2): bump version → X.Y.Z\n\n<notes>`
- Tag · `desktop-2-vX.Y.Z` (matches the workflow trigger in
  `.github/workflows/release-desktop-2.yml`)
- Push · branch + tag together, single push

### 4.e · CI watch

`gh run watch --exit-status` blocks until the workflow run that fired
on the tag-push reaches a terminal state. Exits non-zero on any
failure.

If CI fails · the artefacts will not exist in the draft release · the
script bails before any upload step touches the backend.

### 4.f · Download artefacts

`gh release download desktop-2-vX.Y.Z --dir <tmp>` pulls the DMGs,
architecture-labelled `.app.tar.gz` and `.sig` files from the draft
release. The ship script must never mirror one architecture into both
manifest slots.

### 4.g · Upload to backend

For each `darwin-aarch64` / `darwin-x86_64`:

```http
POST https://api.jnremployee.com/updates/upload
x-internal-secret: ****
x-release-target: darwin-aarch64
x-release-version: 0.8.0
x-release-signature: <contents of .sig file>
x-release-filename: Liquid Clips.app.tar.gz
content-type: application/octet-stream
<binary body of .app.tar.gz>
```

Backend writes the artefact to the Railway persistent volume and
updates `manifest.json` with `{version, platforms.<target>.signature,
file}`.

### 4.h · Manifest verify

Calls the live updater endpoint with both target slugs:

```bash
curl -sS "https://updates.liquidclips.app/latest.json?target=darwin-aarch64&current_version=0.0.0" | jq -r .version
curl -sS "https://updates.liquidclips.app/latest.json?target=darwin-x86_64&current_version=0.0.0" | jq -r .version
```

Both must return `"X.Y.Z"`. If one returns a stale version, the upload
for that arch silently failed (most often INTERNAL_API_SECRET mismatch).

---

## 5 · After the script returns green

- Publish the draft GitHub release · `gh release edit desktop-2-vX.Y.Z --draft=false` (or via the GitHub web UI).
- Install the previous public build · launch it · wait for the in-app
  updater prompt (or trigger from Settings → Check for updates once
  P1-4-e ships that surface).
- Confirm the relaunched app shows `X.Y.Z` in the boot intro.
- Append a 2-3 line entry to `CHANGELOG.md` for the next ship.

---

## 6 · Rollback

The updater manifest is a single document on the Railway volume ·
whichever artefact was uploaded last wins. To roll back from `0.8.1`
to `0.8.0`:

```bash
# Re-upload the prior signed artefact from the prior draft release.
gh release download desktop-2-v0.8.0 --dir /tmp/rollback-0.8.0
SIG="$(cat '/tmp/rollback-0.8.0/Liquid.Clips_aarch64.app.tar.gz.sig')"
curl -X POST https://api.jnremployee.com/updates/upload \
  -H "x-internal-secret: $INTERNAL_API_SECRET" \
  -H "x-release-target: darwin-aarch64" \
  -H "x-release-version: 0.8.0" \
  -H "x-release-signature: $SIG" \
  -H "x-release-filename: Liquid Clips.app.tar.gz" \
  --data-binary "@/tmp/rollback-0.8.0/Liquid.Clips_aarch64.app.tar.gz"
# Repeat for darwin-x86_64.
```

Then verify the manifest flips back. Installed `0.8.1` users will NOT
auto-downgrade · tauri-plugin-updater only installs when the manifest
version is HIGHER than the installed version. Rollback is for
preventing new downloads of the broken version, not for unwinding
existing installs · that needs a `0.8.2` patch.

---

## 7 · Troubleshooting

| Symptom | Probable cause | Fix |
|---|---|---|
| Preflight fails on "working tree dirty" | uncommitted changes | `git stash` or commit · ship requires clean tree |
| CI verify-pubkey step fails | `TAURI_SIGNING_PRIVATE_KEY` secret out of sync with `plugins.updater.pubkey` in tauri.conf.json | regenerate via `npx tauri signer generate` · update both the secret AND the pubkey in tauri.conf.json |
| CI codesign step fails with "no identity found" | `apple-actions/import-codesign-certs` succeeded but keychain isn't in search list | check the `register codesign keychain` step output · ensure `signing_temp.keychain` is in the list |
| Notarize step fails with "missing entitlement" | desktop-2's slim `entitlements-direct.plist` excludes a flag the bundle needs | uncomment the relevant block in `entitlements-direct.plist` (the sidecar flags are already there, commented) |
| Backend upload returns 401 | wrong `INTERNAL_API_SECRET` | rotate via Railway env vars · re-sync to `~/.claude-credentials/junior-internal.env` |
| Manifest still shows old version after upload | platform slug mismatch between upload (e.g. `darwin-aarch64`) and check (e.g. `darwin-arm64`) | upload uses Tauri's slug · verify both sides use `darwin-aarch64` and `darwin-x86_64` |
| Installed app doesn't see the new version | local cache · in-flight check window | quit + relaunch · or call `lib/updater.ts → checkForUpdate()` from the diagnostics turn |

---

## 8 · Hard rules

- **NEVER ship from a feature branch.** The script enforces this.
- **NEVER skip the manifest verify.** The whole point of this chain is
  that "shipped" means users get it · without §4.h that promise is
  empty.
- **NEVER bump version + tag without running the script.** A bare
  `git tag desktop-2-vX.Y.Z && git push --tags` will trigger CI but
  the artefacts won't reach the backend volume · the manifest stays
  stale and you'll ship a tag nobody can install via auto-update.
- **NEVER edit `release-desktop-2.yml` mid-ship.** A workflow edit in
  the same push as the tag races against the trigger · the run might
  pick up the old or new YAML unpredictably.
- **Always read this file before shipping** if it's been more than a
  week. The chain has 3 moving parts (CI · backend · manifest proxy)
  and any one of them can drift.
