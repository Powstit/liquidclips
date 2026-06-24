# Liquid Clips desktop — LLM ship runbook (main → public download)

**Audience:** the next LLM agent (or human operator) shipping a desktop
release.

**Outcome:** the version on `main` reaches an installed user as a working
signed + notarised + stapled DMG, downloadable from
https://liquidclips.app/#download, and discoverable by already-installed
clients via the updater endpoint at `https://updates.liquidclips.app/latest.json`.

**Do not deviate from this runbook.** Every step has a verification gate.
If a gate fails, **STOP** — fix the root cause, then re-enter at the
failing step. Do not silently skip a gate.

---

## 0. STOP — refusal rules (read every time)

You may **only** execute steps 4–9 (the tag/push and beyond) when ALL of:

1. Daniel said **"ship"**, **"tag"**, **"release"**, or an equally explicit
   greenlight **in the same conversational turn** as the action.
   Inferred intent ("I think he'd want this shipped") = REFUSE.
2. Daniel has **read this turn's plan** and confirmed.
3. The current branch is `main` and the working tree is clean.
4. Steps 1–3 (preflight, version bump, smoke tests) all passed in this
   session.
5. No active iron-gate sentinel was touched without explicit override.

If any of those is false: stop, write a one-line summary of what's
blocking, and ask Daniel.

Carry-forward memory hooks:

- `[[feedback_ship_gate]]` — no public release without sign-off.
- `[[feedback_build_gate]]` — no auto-build/install/ship.
- `[[feedback_no_push_until_confirmed]]` — multi-phase work stays local
  until green-lit.
- `[[junior_ship_protocol]]` — version bump ≠ ship; use ship.sh; verify
  live manifest before claiming success.
- `[[liquid_clips_notarisation_pipeline]]` — IG-013 locks the chain;
  ship.sh post-v0.7.51 enforces `stapler validate`.

---

## 1. Preconditions (must be true before you start)

Verify each before touching anything. If a check fails, do **not** proceed.

```bash
cd /Users/dipdip/code/jnr

# 1.1 — On main, clean tree
git status --short                          # expect: empty
git symbolic-ref --short HEAD               # expect: main

# 1.2 — Up to date with origin
git fetch --tags origin
git log -1 --oneline origin/main            # confirm matches HEAD

# 1.3 — Current version
node -p "require('./desktop/package.json').version"  # expect: a.b.c
cat desktop/src-tauri/tauri.conf.json | jq -r '.version'  # MUST equal above

# 1.4 — Tag for chosen version not already taken
git rev-parse --verify "vX.Y.Z" 2>&1 || echo "tag vX.Y.Z is free"

# 1.5 — Tools on PATH
for t in node npm cargo jq curl git gh xcrun; do command -v "$t" || echo MISSING:$t; done
# expect: every tool found

# 1.6 — Apple Developer cert imported in keychain (for local cloud-ship.sh
#       — CI doesn't need this, it imports its own).
security find-identity -v -p codesigning | grep -i "Developer ID Application"
# expect: 1 valid identity (KT68NGT4LX)

# 1.7 — Iron gates intact
grep -rln "IRON GATE" desktop/src desktop/scripts | wc -l   # expect: ≥14 hits
bash desktop/scripts/brand-kit-drift-check.sh               # IG-012 mirror
node --test desktop/tests/no-passive-keychain.test.mjs      # IG-014

# 1.8 — GH auth working (you'll need this for release publish + verify)
gh auth status                              # expect: signed in

# 1.9 — GH Actions secrets exist (the 5 set 2026-06-02)
gh secret list -R "$(gh repo view --json nameWithOwner -q .nameWithOwner)" \
  | grep -E '^(APPLE_ID|APPLE_PASSWORD|APPLE_TEAM_ID|TAURI_SIGNING_PRIVATE_KEY|TAURI_SIGNING_PRIVATE_KEY_PASSWORD)\b'
# expect: 5 lines, all present
```

**Gate.** If any check fails, STOP and report.

---

## 2. Smoke tests (do not tag if these fail)

Run against the live deploys (account-app + backend + marketing must all be
healthy). Full list: `/Users/dipdip/code/jnr/DEPLOYMENT.md §6`.

```bash
# 2.1 — All three live surfaces healthy
curl -sI https://liquidclips.app | head -1                             # expect: 200
curl -sI https://account.liquidclips.app | head -1                     # expect: 200
curl -s https://api.liquidclips.app/healthcheck | jq -r .status        # expect: ok

# 2.2 — Embed-earn frame-ancestors NOT denied (the desktop hosts it)
curl -sI https://account.liquidclips.app/embed/earn | grep -iE 'frame-ancestors|x-frame'
# expect: NO matching headers

# 2.3 — Updater endpoint reachable
curl -sI https://updates.liquidclips.app/latest.json | head -1         # expect: 200
curl -s  https://updates.liquidclips.app/latest.json | jq -r .version  # expect: a.b.c

# 2.4 — Manually validate flows per DEPLOYMENT.md §6 on a real free + paid
# account. THIS REQUIRES HUMAN — if you (the LLM) cannot drive the UI,
# wait for Daniel to confirm "smoke tests pass" before continuing.
```

**Gate.** Daniel must say "smoke tests pass" or you must have observed all
checkboxes from `DEPLOYMENT.md §6` pass yourself.

---

## 3. Version bump

```bash
cd /Users/dipdip/code/jnr/desktop

# Choose the version. semver bump only — do not change MAJOR without
# Daniel's explicit instruction.
VERSION="X.Y.Z"

# 3.1 — Bump via the canonical script
bash scripts/bump_patch.sh                  # OR edit package.json + tauri.conf.json by hand
node -p "require('./package.json').version" # confirm
jq -r .version src-tauri/tauri.conf.json    # confirm — MUST match

# 3.2 — Do NOT commit yet. ship.sh below does the commit + tag for you.
```

**Gate.** Both `package.json` and `tauri.conf.json` must show the new
version, identical strings, no leading `v`.

---

## 4. Ship — the one canonical command

```bash
cd /Users/dipdip/code/jnr/desktop
bash scripts/ship.sh "$VERSION" "Release notes here (1–2 lines)"
```

What `ship.sh` does internally (do not reproduce these by hand — call
`ship.sh`):

| Step | What                                             | Failure mode                                              |
| ---- | ------------------------------------------------ | --------------------------------------------------------- |
| 1    | Preflight — clean tree, on main, version unused  | refuses if any fail                                       |
| 2    | Bump version (idempotent)                        | already-bumped is OK                                      |
| 3    | Frontend `tsc -b && vite build`                  | fails on type / build errors                              |
| 4    | Commit the version bump                          | git config required                                       |
| 5    | `scripts/release.sh` — Tauri build + sign + upload (~7 min) | calls Tauri's signed build path locally        |
| 6    | Verify manifest on both hosts × both arches      | this is the v0.7.51 gate — if `stapler validate` or the live JSON fail, refuse to claim success |
| 7    | Push `main` to origin (best-effort)              | network errors don't fail the ship                        |

**After `ship.sh` exits clean**, ALSO push the tag — that's what triggers
CI to take over the signed/notarised cloud path:

```bash
cd /Users/dipdip/code/jnr
git tag "v$VERSION"
git push origin "v$VERSION"
```

**Gate.** `ship.sh` exit code 0. If non-zero, STOP and read the error
message — common failures: dirty tree, type-check fail, manifest
mismatch, network error during upload.

---

## 5. CI runs (release.yml) — automatic, observe only

CI workflow: `.github/workflows/release.yml` (tag-triggered).

What CI does, in order:

1. Verify updater signing key matches the `tauri.conf.json` pubkey
   (using `TAURI_SIGNING_PRIVATE_KEY` + `_PASSWORD` secrets).
2. Fetch ffmpeg + ffprobe sidecar binaries.
3. Fetch faster-whisper-tiny model.
4. Strip extended attributes from bundled files.
5. Import Developer ID cert from `APPLE_CERTIFICATE` secret.
6. Register codesign keychain + verify identity.
7. Sign sidecar helper binaries.
8. Build signed macOS app (`TAURI_SIGNING_*` secrets).
9. Repair-sign the `.app` bundle.
10. Rebuild DMG + updater tarball from the repaired app.
11. `xcrun notarytool submit --wait` + `xcrun stapler staple`
    (`APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` secrets).
12. Verify notarised installer.
13. Create a **draft** GitHub Release with all artifacts attached.

Required artifacts on the draft release:
- `Liquid Clips_<version>_x64.dmg`
- `Liquid Clips_<version>_x64.dmg.sig`
- `Liquid Clips_<version>_aarch64.dmg`
- `Liquid Clips_<version>_aarch64.dmg.sig`
- `Liquid Clips.app.tar.gz` (per arch)
- `Liquid Clips.app.tar.gz.sig` (per arch)
- `latest.json` (the updater manifest)

```bash
# Watch CI from the terminal
gh run watch                                # interactive
gh run list --limit 3                       # recent runs
gh run view <run-id> --log                  # log output

# Wait for completion programmatically
gh run watch "$(gh run list --workflow=release.yml -L 1 --json databaseId -q '.[0].databaseId')"
```

**Gate.** CI run is green. If a job failed, read the log, classify the
failure, and report. Common failures:

| Failure                                                | Cause                                                | Fix                                                       |
| ------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| "Tauri pubkey mismatch"                                | TAURI_SIGNING_PRIVATE_KEY rotated without updating tauri.conf.json `plugins.updater.pubkey` | Regenerate / re-pair both. ⚠️ breaks every installed client's update path. |
| "Could not import cert"                                | APPLE_CERTIFICATE secret has wrong base64 / wrong password | Re-export from Keychain Access, re-upload                 |
| `notarytool` "Invalid"                                 | Most often: a binary in the bundle is not signed     | Read the JSON error from notarytool; sign the offending binary |
| `stapler` "Unable to validate"                         | Notarisation submission didn't finish (rare race) — or staple ran before notarisation completed | Re-run staple. v0.7.50 incident memory: `[[liquid_clips_notarisation_pipeline]]` |
| Draft release not created                              | `GITHUB_TOKEN` lacks releases:write — rare; check repo settings | Use a PAT scoped for releases                            |

---

## 6. Verify the draft release artefacts

Before publishing, validate every artefact exists and is well-formed.

```bash
TAG="v$VERSION"
RELEASE_ID=$(gh release view "$TAG" --json id -q .id)
gh release view "$TAG"

# List asset names
gh release view "$TAG" --json assets -q '.assets[].name'

# Sanity-download the dmg and run stapler validate (the post-v0.7.51 gate)
TMP=$(mktemp -d)
gh release download "$TAG" -D "$TMP" -p "*.dmg"
for dmg in "$TMP"/*.dmg; do
  echo "validating $dmg"
  spctl -a -t open --context context:primary-signature -v "$dmg"
  xcrun stapler validate "$dmg" || { echo "STAPLER FAIL $dmg"; exit 1; }
done
```

**Gate.** All `stapler validate` and `spctl` checks pass. If any DMG
fails: **DO NOT publish the release.** Re-run CI or investigate.

---

## 7. Publish the draft release

This is the moment the user-facing path goes live.

```bash
gh release edit "$TAG" --draft=false --latest
# OR via the web UI: github.com/<owner>/<repo>/releases → edit → Publish
```

**Gate.** Confirm via:

```bash
gh release view "$TAG" --json isDraft,isLatest -q '. | "draft:\(.isDraft) latest:\(.isLatest)"'
# expect: draft:false latest:true
```

---

## 8. Verify the live download paths

Two paths users reach the new build:

### 8.1 — Marketing site `#download` (anchor on home page)

`liquidclips-marketing/src/app/page.tsx` fetches the latest DMG URLs from
GH Releases via an ISR-cached fetch with a 10-min revalidate window.

```bash
# 8.1.a — Home page reachable
curl -sI https://liquidclips.app/ | head -1   # expect: 200

# 8.1.b — Force ISR revalidation (optional — wait 10 min otherwise).
#  If a /api/revalidate or revalidatePath route is wired:
curl -X POST "https://liquidclips.app/api/revalidate?path=/" \
  -H "x-revalidate-token: $(op read 'op://Liquid Clips/Liquid Clips — Vercel (LC team)/api_token')"
# (only if the marketing project exposes this; otherwise the cache flips
#  naturally within 10 min)

# 8.1.c — Confirm the DMG URL on the page resolves to the new release
curl -s https://liquidclips.app/ | grep -oE 'https://github\.com/[^"]+\.dmg' | sort -u
# expect: github URLs containing your $VERSION
```

### 8.2 — Updater endpoint (installed clients)

`updates.liquidclips.app/latest.json` is a Vercel-hosted route that serves
the updater manifest. tauri.conf.json `plugins.updater.endpoints` points
here.

```bash
curl -s https://updates.liquidclips.app/latest.json | jq '{ version, pub_date, notes }'
# expect: version == $VERSION
```

**Gate.** Both URLs reflect the new version. If §8.2 still shows the
previous version after 10 min, the Vercel ISR cache hasn't flipped — wait
or trigger revalidation.

---

## 9. Auto-update rehearsal (recommended once per major release)

This is how you prove an installed user gets the update.

```bash
# 9.1 — On a Mac with the PREVIOUS public version installed
ls "/Applications/Liquid Clips.app" && \
  defaults read "/Applications/Liquid Clips.app/Contents/Info.plist" CFBundleShortVersionString
# expect: a.b.(c-1) — older than $VERSION

# 9.2 — Launch the app
open "/Applications/Liquid Clips.app"

# 9.3 — Expect: within 30s of launch, the app shows an "update available"
#       prompt. Accept it.

# 9.4 — After auto-relaunch, version should match
defaults read "/Applications/Liquid Clips.app/Contents/Info.plist" CFBundleShortVersionString
# expect: matches $VERSION
```

**Gate.** No Gatekeeper warning. No "developer unverified" dialog. Update
applied silently.

If a Gatekeeper warning appears: the DMG isn't stapled. Roll back §7 and
investigate (see v0.7.50 incident — `[[liquid_clips_notarisation_pipeline]]`).

---

## 10. Post-ship hygiene

Once verified live:

1. Update `desktop/CLAUDE.md` "Current version & shipping state" line to
   `$VERSION`.
2. Update `DEPLOYMENT.md §5` (live-state table) to reflect new version.
3. Cross-post the release notes to the marketing site / changelog if used.
4. Commit those docs + push:
   ```bash
   cd /Users/dipdip/code/jnr
   git add desktop/CLAUDE.md DEPLOYMENT.md
   git commit -m "docs: bump live-state to v$VERSION"
   git push origin main
   ```
5. Update `~/.claude/projects/-Users-dipdip/memory/MEMORY.md` if the
   live-state in memory referenced the old version.

---

## 11. Rollback procedure

**You have two windows to roll back cleanly:**

### Window A — before §7 (release still draft)

```bash
# Delete the draft release
gh release delete "v$VERSION" --yes

# Delete the tag locally + on origin
git tag -d "v$VERSION"
git push origin :refs/tags/v$VERSION

# CI artefacts disappear with the release.
```

### Window B — after §7 (release is public, may be installed)

Do **NOT** silently delete a public release — that breaks the updater path
for any client that read its `latest.json`.

```bash
# Step 1 — pull the previous version's manifest back to the endpoint
#   This means re-publishing the prior release as "latest" so installed
#   clients no longer get pointed to the broken version.
gh release edit "v$VERSION" --draft=true       # demote the broken release
gh release edit "v<prev>" --latest             # mark prior as latest again

# Step 2 — verify the updater endpoint flipped back
curl -s https://updates.liquidclips.app/latest.json | jq -r .version
# expect: <prev>

# Step 3 — communicate. Tell Daniel + post a release-notes erratum.

# Step 4 — fix the underlying issue, then re-ship as v<a.b.c+1>.
```

---

## 12. Reference card — exactly which secret comes from where

| What                              | Source (op read URI)                                                           | Used by                                  |
| --------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| Apple Developer cert (.p12 b64)   | (GH Actions secret `APPLE_CERTIFICATE` — mirror to `Liquid Clips — Apple Developer` once added) | release.yml step 5 |
| Cert export password              | (GH Actions secret `APPLE_CERTIFICATE_PASSWORD`)                               | release.yml step 5                       |
| Apple ID email                    | (GH Actions secret `APPLE_ID`)                                                  | release.yml step 11 (notarytool)         |
| Apple ID app-specific password    | (GH Actions secret `APPLE_PASSWORD`)                                            | release.yml step 11 (notarytool)         |
| Apple Team ID `KT68NGT4LX`        | (GH Actions secret `APPLE_TEAM_ID`)                                             | release.yml step 11                      |
| Tauri minisign private key        | `op read "op://Liquid Clips/Liquid Clips — Tauri updater signing key/private_key"` (and GH Actions secret `TAURI_SIGNING_PRIVATE_KEY`) | release.yml step 1, 8, 10 |
| Tauri minisign public key         | `op read "op://Liquid Clips/Liquid Clips — Tauri updater signing key/public_key"` | bundled in `tauri.conf.json plugins.updater.pubkey` |
| GH PAT (manual release ops)       | `gh auth login` browser flow; or `op read "op://Liquid Clips/Liquid Clips — GitHub PAT (release scope)/PAT"` once added | manual `gh release` commands |
| Vercel token (revalidation)       | `op read "op://Liquid Clips/Liquid Clips — Vercel (LC team)/api_token"`         | optional /api/revalidate POST in §8.1.b   |

GH Actions secret list (verify present before ship):

| Secret                                        | Set since   | Iron-gate |
| --------------------------------------------- | ----------- | --------- |
| `APPLE_ID`                                    | 2026-06-02  | IG-013    |
| `APPLE_PASSWORD`                              | 2026-06-02  | IG-013    |
| `APPLE_TEAM_ID`                               | 2026-06-02  | IG-013    |
| `APPLE_CERTIFICATE`                           | 2026-06-02  | IG-013    |
| `APPLE_CERTIFICATE_PASSWORD`                  | 2026-06-02  | IG-013    |
| `TAURI_SIGNING_PRIVATE_KEY`                   | 2026-06-02  | IG-013    |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`          | 2026-06-02  | IG-013    |

---

## 13. Anti-patterns — past failures to never repeat

| Incident                       | When        | Root cause                                                                              | Fix                                                                          |
| ------------------------------ | ----------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| v0.7.50 shipped unstapled DMGs | 2026-06-12  | `find | head -1` picked the unstapled intermediate DMG, not the final stapled output    | ship.sh post-v0.7.51 pins the slugged DMG name + adds `stapler validate` gate |
| v0.4.26 / v0.4.27 manifest stale | 2026-05-22 | ship.sh claimed success on local build before the updates endpoint had flipped          | Added live-manifest verification (this runbook §8.2)                          |
| Local DMG handed to user       | (recurring) | Bypassing ship.sh + cloud notarisation                                                  | **Never** ship a locally-built DMG to users. CI is the only signed path.      |

---

## 14. Carry-forward for the next LLM

When you finish a successful ship and want to keep this runbook accurate,
update:

- §10 → bump version line(s)
- §13 → if you hit a new failure mode, write it down with the fix

When you finish an UNsuccessful ship and rolled back:

- Add a `### Failed attempt YYYY-MM-DD` block under §13 with what broke
- Do not edit the gate logic itself unless Daniel approved a contract change
