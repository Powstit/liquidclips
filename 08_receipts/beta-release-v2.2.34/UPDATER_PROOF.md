# Auto-updater · evergreen publish · PROOF

## What changed

**CI workflow** (`.github/workflows/release-desktop-2.yml`):
- New `assert VITE_CLERK_PUBLISHABLE_KEY` step fails CI fast if the GitHub secret is missing or malformed (`pk_live_` / `pk_test_` prefix check). Never echoes the value.
- Build step env now includes `VITE_CLERK_PUBLISHABLE_KEY` and `VITE_BACKEND_URL=https://api.liquidclips.app` so the Vite bundle bakes them in.
- New `publish-manifest` job (runs after both matrix jobs succeed):
  - Downloads `.sig` contents from the freshly published GitHub release
  - Constructs Tauri updater manifest JSON pointing at the GitHub-hosted `.tar.gz` URLs
  - POSTs to `https://api.liquidclips.app/admin/updates/publish-manifest` with `INTERNAL_API_SECRET`
  - Verifies live manifest at `https://updates.liquidclips.app/latest.json?target=darwin-{arch}` reports the new version
  - Emits `::warning::` if any step fails so ops can hand-bump; **never fails the release** (dmgs already exist on GitHub, only the auto-update surface is at stake)

**Backend** (`junior-backend/app/routes/updates.py`):
- New `POST /admin/updates/publish-manifest` endpoint · internal-secret gated · writes body verbatim to `releases_dir()/static-manifest.json` on the Railway volume. Survives restarts.
- `latest()` now reads `static-manifest.json` as a fallback source when `UPDATER_STATIC_MANIFEST` env var is unset. Priority: env var > file > legacy volume manifest.
- Endpoint mounted in `main.py`.

## Verification at commit time

Backend deployed to Railway · verified:
- `GET /healthcheck` → **200** · `{"status":"ok",...}`
- `POST /admin/updates/publish-manifest` with `{}` → **400** `{"detail":"manifest missing version or platforms"}` (correct rejection · confirms endpoint mounted + gate holds)

CI kicked at `desktop-2-v2.2.34` (run id [28950299283](https://github.com/Powstit/liquidclips/actions/runs/28950299283)).

## Full manifest publish result

**Filled in after CI completes** by the monitor task watching build completion + live manifest verification. See `PROOF.md` for the final values.

## Rollback plan

If the new endpoint or the CI publish step breaks a release:

1. **Immediate**: set `UPDATER_STATIC_MANIFEST` env var on Railway back to the v2.2.33 manifest string (that env var still wins over the file). Force Railway restart.
2. **Revert code**: `git revert feb0d3f` (the v2.2.34 hotfix commit) → cherry-pick a targeted subset back in.
3. **Delete static-manifest.json** on Railway volume via a one-shot admin endpoint or short SSH session if needed.
4. **Bypass entirely**: on the desktop app side, the updater silently 204s if the manifest is malformed. Users stay on their current version and can always re-download from `/download`.

## Secret hygiene

- `VITE_CLERK_PUBLISHABLE_KEY` reads from GitHub secrets · never echoed
- `INTERNAL_API_SECRET` reads from GitHub secrets · never echoed
- Signatures on the wire are base64 blobs from the shipped `.sig` files (already public on GitHub Releases). Not secrets.
- No token / JWT / private key ever appears in any receipt.
