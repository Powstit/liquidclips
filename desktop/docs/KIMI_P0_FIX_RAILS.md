# Kimi — P0 Fix Rails (v0.7.32 ship-blockers)

**For Kimi (or any other Claude agent picking up these fixes).**

Read this **before** writing any code. Each P0 has: scope · do-not · exit criteria · empirical verification command.
Daniel will run the verification commands himself; "I fixed it" without the command output is **not done**.

---

## 🚨 Repo context (load-bearing)

- Repo: `Powstit/Jnr-employee` — **PUBLIC** on GitHub. Anything in git history is permanently visible.
- HEAD: `ee825fa wip(v0.7.32)` (Claude's WIP commit at the time of this writing).
- Active branch: `main`.
- v0.6.44 is Latest public release; v0.6.45 is a stale draft; v0.7.32 is the next planned tag.
- Daniel's machine: **Intel x86_64** (uname -m = x86_64). Local builds are x86_64; CI builds both arches.

---

## P0-1 · Hardcoded reaction API keys

**Where:** `desktop/python-sidecar/sidecar.py:54-56`
```python
DEFAULT_REACTION_KEYS = {
    "GIPHY_API_KEY":   "<— leaked literal>",
    "PEXELS_API_KEY":  "<— leaked literal>",
    "PIXABAY_API_KEY": "<— leaked literal>",
}
```
**Git first-landed:** commit `5095db1` on 2026-06-05. **The keys are already exposed on the public repo for 3+ days.**

### Scope
1. Delete the `DEFAULT_REACTION_KEYS` dict literal. No fallback dict.
2. The 3 usages (`_reaction_secret` calls at lines `~1488, 1495, 1502`) must read **only** from env / keychain via the existing `secrets_store` path. If absent → return the same "no key" error path the sidecar already uses for OPENAI_API_KEY.
3. Update the user-facing copy in the reaction picker UI to say "Add your Pexels/Pixabay/Giphy key in Settings → API keys" — same routing pattern as the OpenAI key.
4. **Rotate all 3 leaked keys at the provider.** Generate new ones. Add them to Daniel's local `~/.claude-credentials/` if he wants them keychain-loaded; do NOT put the new keys anywhere in the source tree.
5. After source removal: **purge from git history** via `git filter-repo` or BFG. Force-push to `Powstit/Jnr-employee main` (Daniel must authorize the force-push — ask first).

### Do NOT
- ❌ Replace the literal with a base64-decoded string. The point is the keys can't be in the binary at all.
- ❌ Leave a "demo" or "trial" key. The PR comment from v0.6.38 commit said launch builds shouldn't show "API key missing." That UX concern is real, but the answer is **route the user to Settings**, not bundle a key.
- ❌ Use `keyring` to install Daniel's personal keys as defaults — they're his account, not the app's.
- ❌ Commit before rotating. Once the source is clean but the git history still shows the old keys, the gap is permanent. Rotate first.

### Exit criteria
- `grep -rE "(GIPHY_API_KEY|PEXELS_API_KEY|PIXABAY_API_KEY).*[\"'][A-Za-z0-9]{10,}" desktop/python-sidecar/` returns **zero lines**.
- `grep -rE "(GsFvVTk4cfq3|IT3HYR40s1lR|56161034-7cc22)" desktop/` returns **zero lines** (the actual leaked literals).
- Reaction picker tested via local install: clicking a provider with no key set should show "Add your Pexels/Pixabay/Giphy key in Settings → API keys", not silently succeed against a default key.
- 3 new keys are usable in local install (Daniel's keychain holds them).
- Old keys are confirmed revoked at the providers (screenshot or "revoked" status from each provider's dashboard).
- Git history purge plan documented in this file (commit range + tool + force-push checklist) — do NOT execute force-push until Daniel approves.

### Daniel's verification command
```bash
# Source check
grep -rE "(GIPHY_API_KEY|PEXELS_API_KEY|PIXABAY_API_KEY).*['\"][A-Za-z0-9]{10,}" \
  ~/Desktop/jnr/desktop/python-sidecar/

# Built-binary check (after rebuild)
strings "/Applications/Liquid Clips.app/Contents/Resources/_up_/python-sidecar/sidecar.py" \
  | grep -E "GsFvVTk4cfq3|IT3HYR40s1lR|56161034-7cc22"
# both must return EMPTY
```

---

## P0-2 · Marketing site Intel-DMG fallback (not "x86_64 only")

**Pre-existing in task list (#29 — never executed).** The framing "the app only ships x86_64" is wrong — CI builds both arches per `.github/workflows/release.yml`. The gap is the **marketing site**: `NEXT_PUBLIC_DOWNLOAD_DMG_URL` only points at the aarch64 DMG. Intel users hitting `liquidclips.app/download` get no Intel link.

### Scope
1. Set 2 new Vercel env vars on `jnremployee` project (production scope):
   - `NEXT_PUBLIC_DOWNLOAD_MAC_ARM_URL` = the aarch64 DMG of the latest release
   - `NEXT_PUBLIC_DOWNLOAD_MAC_INTEL_URL` = the x86_64 DMG of the latest release
2. `desktop` repo: the `liquidclips-marketing/src/components/DownloadCTA.tsx` already reads these vars (lines 24-26, fallback to legacy `NEXT_PUBLIC_DOWNLOAD_DMG_URL`). Verify the picker UI offers an Intel fallback link (the "different chip?" pattern).
3. Redeploy site: `cd ~/Desktop/jnr/liquidclips-marketing && vercel deploy --prod --yes`.
4. Verify `curl https://liquidclips.app/download | grep "_x86_64.dmg"` returns the Intel URL.

### Do NOT
- ❌ Hardcode the version in the React source. Use env vars only.
- ❌ Default to "universal" — Tauri doesn't ship a single universal binary; both archs are separate DMGs.

### Exit criteria
- Both env vars set on Vercel (verify with `vercel env ls --scope ddbshopifys-projects` — note the marketing site is on a different team).
- `/download` page surfaces a "Different chip? Get the Intel DMG" link visible to all users (or auto-detects via the UA flow that already exists in DownloadCTA.tsx:43).
- Site rebuild + redeploy completed, curl confirms both URLs in served HTML.

### Daniel's verification command
```bash
curl -sS https://liquidclips.app/download \
  | grep -oE 'https://github\.com/Powstit/Jnr-employee/releases/download/v[0-9.]+/Liquid\.Clips_[0-9.]+_(aarch64|x86_64)\.dmg' \
  | sort -u
# Must return BOTH the aarch64 and x86_64 DMG URLs.
```

---

## P0-3 + P0-4 · Notarization (not "code signing broken")

**The local bundle is signed but not notarized.** `codesign -dv` returns valid. `spctl --assess` returns `rejected source=Unnotarized Developer ID` — that's Gatekeeper rejecting unnotarized, which on macOS 14+ presents as `kLSNoExecutableErr` when `open` is called.

**This is solved by CI, not by a code change.** Don't ship local-built DMGs to the public — that path was never the production path.

### Scope
1. **No code change needed.** Verify the existing CI workflow `.github/workflows/release.yml` includes the notarize step. Look for `xcrun notarytool submit` or `tauri build` with `APPLE_API_KEY_*` env vars.
2. If the notarize step is missing or broken in CI, scope a fix per `desktop/scripts/notarize.sh`.
3. Document in `desktop/CLAUDE.md` (the agent guide) that local builds are unsigned-for-review-only and the PRODUCTION ship path is: tag `vX.Y.Z` → push → CI builds + signs + notarizes + staples + publishes to draft GH release.

### Do NOT
- ❌ Tell Daniel to install a local-built DMG and "click through Gatekeeper." Only signed+notarized DMGs should leave his machine for users.
- ❌ Move CI steps into `scripts/ship.sh`. Keep the separation: CI for public DMGs, `ship.sh` for backend auto-updater manifest.

### Exit criteria
- `.github/workflows/release.yml` notarize step is verified (read it, confirm it submits + staples on success).
- `desktop/CLAUDE.md` has a "ship path = CI only" line near the build instructions.
- A test tag (e.g., `v0.7.32-rc1`) can be pushed and the CI run completes green within 30 minutes including notarization.

### Daniel's verification command
```bash
# After CI completes for the test tag, download the DMG and verify
DMG="/tmp/Liquid.Clips_0.7.32-rc1_aarch64.dmg"
gh release download v0.7.32-rc1 -R Powstit/Jnr-employee -p "*aarch64.dmg" -D /tmp
spctl --assess --type install --verbose=4 "$DMG"
# Must return: "accepted" + "source=Notarized Developer ID"
```

---

## Hard rules for Kimi

1. **No build / sign / install / push without Daniel saying so in the same turn.** Same `build-gate` skill the other Claude agent follows. Words that count: "build", "install", "ship", "deploy", "release", "push", "rotate" (for the keys). Prior-turn confirmation does NOT carry.
2. **No "fixed" claims without the empirical verification command output pasted in the response.** Saying "I removed the dict" is not enough — paste the grep result that shows zero hits.
3. **No force-push without explicit Daniel authorization.** P0-1 requires a history rewrite; that's a public-state change. Ask. Wait.
4. **If you find ADDITIONAL P0s while fixing these:** stop, log them at the bottom of this file under `## NEW P0s discovered`, ping Daniel. Don't quietly expand scope.
5. **No commits with the leaked keys still in the working tree.** Even an `git add -A` could re-stage them. Stage explicitly, file by file.
6. **No edits to `src/components/PlatformBadge.tsx`, `src/components/schedule/ChannelRow.tsx`, `src/components/schedule/ChannelsManager.tsx`, `src/components/schedule/ChannelPicker.tsx`, `src/components/AyrshareConnectionPanel.tsx`, `src/components/Settings.tsx`.** Those are the Claude-side ch-row/PlatformBadge work — touch them and you'll merge-conflict.

---

## Done definition

| P0 | Source clean | Built binary clean | New keys live | History purged | Marketing site shows both arches | CI notarize verified |
|---|---|---|---|---|---|---|
| P0-1 | grep returns 0 | strings grep returns 0 | reaction feature works in local install | force-push authorized + done | n/a | n/a |
| P0-2 | env vars set | n/a | n/a | n/a | curl returns both DMG URLs | n/a |
| P0-3 | n/a | n/a | n/a | n/a | n/a | spctl: accepted + Notarized |
| P0-4 | n/a | n/a | n/a | n/a | n/a | (same as P0-3) |

All 4 must show ✅ in Daniel's verification commands before the v0.7.32 ship sequence runs.

---

## NEW P0s discovered (append here as found)

_(empty)_
