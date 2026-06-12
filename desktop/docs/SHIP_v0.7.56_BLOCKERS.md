# SHIP v0.7.56 — CI updater pipeline

**Created:** 2026-06-12 (after v0.7.55 partial ship)
**Owner:** desktop CI

## Why this exists

v0.7.55 shipped notarised + stapled per-arch DMGs via the tag-push CI flow (`.github/workflows/release.yml`), but the backend auto-update manifest at `https://updates.liquidclips.app/latest.json` is still pinned to **v0.7.51** because CI does not run the `/updates/upload` step that publishes the updater payload + manifest.

Installed users will not auto-update to v0.7.55. Fresh downloads from the GH release page work fine (signed + stapled DMGs).

The backend upload step currently lives in `desktop/scripts/cloud-ship.sh` and `desktop/scripts/release.sh` — both require a **universal-apple-darwin** tarball + minisign signature + `INTERNAL_API_SECRET` to POST to `api.jnremployee.com/updates/upload`. The per-arch CI matrix produces two arch-specific tarballs that collide on the same filename in the GH release upload, so the existing CI output cannot be repurposed safely as an updater payload.

## Blockers (must close before v0.7.56 ships)

### B1. CI builds universal-apple-darwin updater tarball
- Add a third matrix entry (or a post-matrix `lipo` job) that produces `universal-apple-darwin/release/bundle/macos/Liquid Clips.app.tar.gz` + `.sig`.
- Or: lipo the two per-arch binaries from the existing matrix into a universal binary, then re-tar + re-sign.
- Reference the IG-009 sequence in `cloud-ship.sh` lines 1-35 for the proven local pattern.

### B2. CI publishes updater payload + manifest to backend
- After universal tarball is built + signed, POST to `https://api.jnremployee.com/updates/upload` with all `x-release-*` headers (target, version, signature, filename, notes).
- Upload under BOTH `darwin-aarch64` and `darwin-x86_64` targets (same payload, two slots — matches `release.sh` lines 188-217 pattern).
- Secret: `INTERNAL_API_SECRET` (add as GitHub Actions secret if not already present).

### B3. CI verifies manifest on both hosts after upload
- After upload, `curl` both `api.jnremployee.com/updates/latest.json?target=X&current_version=0.0.0` and `updates.liquidclips.app/latest.json?target=X&current_version=0.0.0` for both arches.
- Fail the workflow if the reported version != tag version. (Matches `ship.sh` lines 152-183 `verify_manifest` pattern.)

### B4. Remove reliance on local cloud-ship for production releases
- Once B1-B3 land, `cloud-ship.sh` is no longer the production ship path; it stays as a local-emergency fallback only.
- Update `desktop/docs/IRON_GATES.md` IG-009 to reflect the new CI-driven flow (do not delete the local sequence — keep it documented as the fallback).

### B5. Confirm target-specific manifests are correct after upload
- Verify `darwin-aarch64` slot has correct universal payload (runs on Apple Silicon natively).
- Verify `darwin-x86_64` slot has correct universal payload (runs on Intel natively).
- One install test per arch (use the Mac mini Intel + the M-series machine).

## Reference

- v0.7.55 partial ship: `https://github.com/Powstit/liquidclips/releases/tag/v0.7.55` (DMGs published, manifest skipped on purpose).
- CI run that built v0.7.55: `https://github.com/Powstit/liquidclips/actions/runs/27424637383`.
- Existing scripts to mirror: `desktop/scripts/cloud-ship.sh`, `desktop/scripts/release.sh`, `desktop/scripts/ship.sh`.
- Iron gate: IG-009 (universal-apple-darwin + IRON-GATED minisign env-var pattern).
