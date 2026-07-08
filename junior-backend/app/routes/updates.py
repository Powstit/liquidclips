"""Update manifest endpoint for tauri-plugin-updater.

Tauri's updater hits `/updates/latest.json?target=darwin-aarch64&current_version=...`.
We return either 204 (up-to-date) or a JSON envelope with the signed artifact URL.

The artifact lives on disk in JUNIOR_RELEASES_DIR (set via env; defaults to a
local dir for dev). Sprint 9 swaps the static dir for an S3/CDN — same JSON
shape, different download URL.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response

from app.deps import require_internal_secret

router = APIRouter(prefix="/updates", tags=["updates"])


def releases_dir() -> Path:
    return Path(os.environ.get("JUNIOR_RELEASES_DIR", str(Path.home() / "Desktop/jnr/desktop/src-tauri/target/release/bundle")))


@router.get("/latest.json")
def latest(
    request: Request,
    target: str | None = Query(None, description="e.g. darwin-aarch64 or darwin-x86_64"),
    current_version: str | None = Query(None, alias="current_version"),
):
    """Tauri pings this with ?target=&current_version=. We resolve the right
    artifact for the target and return the signature + download URL."""
    target = target or "darwin-x86_64"  # current build is x86_64; aarch64 lands when we add the rust target

    # 2026-07-08 · Two static-manifest sources in priority order:
    #   1. UPDATER_STATIC_MANIFEST env var — manual ops override
    #   2. releases_dir()/static-manifest.json — written by CI at every
    #      release via POST /admin/updates/publish-manifest (below).
    #      Persists across Railway restarts on the volume.
    # Then falls back to the legacy volume-manifest+artifact path.
    static_raw = os.environ.get("UPDATER_STATIC_MANIFEST")
    if not static_raw:
        static_manifest_file = releases_dir() / "static-manifest.json"
        if static_manifest_file.is_file():
            try:
                static_raw = static_manifest_file.read_text()
            except OSError:
                static_raw = None
    if static_raw:
        try:
            static_manifest = json.loads(static_raw)
        except json.JSONDecodeError:
            static_manifest = None
        if static_manifest:
            if current_version and current_version == static_manifest.get("version"):
                return Response(status_code=status.HTTP_204_NO_CONTENT)
            platform_block = static_manifest.get("platforms", {}).get(target)
            if not platform_block:
                return Response(status_code=status.HTTP_204_NO_CONTENT)
            return JSONResponse({
                "version": static_manifest["version"],
                "notes": static_manifest.get("notes", ""),
                "pub_date": static_manifest.get("pub_date", datetime.now(timezone.utc).isoformat()),
                "platforms": {
                    target: {
                        "signature": platform_block["signature"],
                        "url": platform_block["url"],
                    }
                },
            })

    manifest_path = releases_dir() / "manifest.json"
    if not manifest_path.is_file():
        # No manifest yet — no update. 204 tells Tauri "you're current."
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    manifest = json.loads(manifest_path.read_text())

    # Skip if the client is already on this version.
    if current_version and current_version == manifest.get("version"):
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    platform_block = manifest.get("platforms", {}).get(target)
    if not platform_block:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # Rewrite the download URL so the client fetches from this same backend.
    # Railway terminates TLS at its edge and forwards to us over http, so
    # request.base_url is http:// — but Tauri's updater requires https. Force
    # https for the public host (keep http for local dev).
    base = str(request.base_url).rstrip("/")
    if base.startswith("http://") and "localhost" not in base and "127.0.0.1" not in base:
        base = "https://" + base[len("http://"):]
    artifact_url = f"{base}/updates/download/{target}"

    return JSONResponse({
        "version": manifest["version"],
        "notes": manifest.get("notes", ""),
        "pub_date": manifest.get("pub_date", datetime.now(timezone.utc).isoformat()),
        "platforms": {
            target: {
                "signature": platform_block["signature"],
                "url": artifact_url,
            }
        },
    })


@router.get("/download/{target}")
def download_artifact(target: str):
    """Stream the signed update tarball for `target`. Sprint 9 swaps for an
    S3/CDN signed redirect — same external contract."""
    manifest_path = releases_dir() / "manifest.json"
    if not manifest_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no manifest")
    manifest = json.loads(manifest_path.read_text())
    platform_block = manifest.get("platforms", {}).get(target)
    if not platform_block:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"target {target!r} not in manifest")
    # Resolve the artifact by FILENAME inside the releases dir (the persistent
    # Railway volume). `file` is the upload-time name; `local_path` is the legacy
    # build-machine absolute path (back-compat for old manifests / local dev).
    fname = platform_block.get("file")
    artifact_path = (releases_dir() / Path(fname).name) if fname else Path(platform_block.get("local_path", ""))
    if not artifact_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"artifact missing: {artifact_path.name}")
    return FileResponse(artifact_path, filename=artifact_path.name, media_type="application/octet-stream")


@router.post("/upload")
async def upload_release(
    request: Request,
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
):
    """Release pusher (run from the build machine by scripts/release.sh).

    The signed artifact + its metadata are pushed here so the backend serves
    updates from a STABLE location (a persistent Railway volume at
    JUNIOR_RELEASES_DIR) instead of an ephemeral build-machine path. Raw-body
    upload (no python-multipart dependency); metadata travels in x-release-*
    headers. Gated fail-closed via `deps.require_internal_secret` (missing
    env → 500, missing/mismatched header → 401).

    Headers:
      x-internal-secret   shared server secret
      x-release-target    e.g. darwin-aarch64 | darwin-x86_64 | windows-x86_64
      x-release-version   e.g. 0.4.19
      x-release-signature Tauri updater signature (contents of the .sig file)
      x-release-filename  artifact filename, e.g. Junior_0.4.19_aarch64.app.tar.gz
      x-release-notes     (optional) release notes
    Body: the raw signed artifact bytes.
    """
    target = request.headers.get("x-release-target")
    version = request.headers.get("x-release-version")
    signature = request.headers.get("x-release-signature")
    filename = request.headers.get("x-release-filename")
    notes = request.headers.get("x-release-notes", "")
    if not (target and version and signature and filename):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing x-release-* headers")

    rd = releases_dir()
    rd.mkdir(parents=True, exist_ok=True)
    safe_name = Path(filename).name  # strip any path components
    dest = rd / safe_name
    # STREAM the artifact to disk in chunks — updater bundles are ~100-150MB, so
    # never buffer the whole body in memory on the Railway instance.
    size = 0
    with dest.open("wb") as fh:
        async for chunk in request.stream():
            fh.write(chunk)
            size += len(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty body")

    manifest_path = rd / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    # A new version resets the platform set; same version accumulates targets.
    if manifest.get("version") != version:
        manifest = {"version": version, "platforms": {}}
    manifest["notes"] = notes or manifest.get("notes", "")
    manifest["pub_date"] = datetime.now(timezone.utc).isoformat()
    manifest.setdefault("platforms", {})[target] = {"signature": signature, "file": safe_name}
    manifest_path.write_text(json.dumps(manifest, indent=2))

    return {"ok": True, "version": version, "target": target, "file": safe_name, "bytes": size}


# 2026-07-08 · CI hook for evergreen auto-update. Accepts the manifest
# JSON verbatim + writes it to releases_dir()/static-manifest.json so
# it survives Railway restarts. `latest()` reads this file when
# UPDATER_STATIC_MANIFEST env var is unset. Idempotent · one POST per
# release from the CI workflow.
_admin_updates_router = APIRouter(prefix="/admin/updates", tags=["updates-admin"])


@_admin_updates_router.post("/publish-manifest")
async def publish_manifest(
    request: Request,
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
):
    """Persist a Tauri updater manifest to the volume.

    Body: JSON with keys ``version``, ``notes``, ``pub_date``,
    ``platforms`` (dict of target -> {signature, url}). Never logs the
    signature contents or the internal secret.
    """
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid json body")
    version = body.get("version")
    platforms = body.get("platforms", {})
    if not version or not isinstance(platforms, dict) or not platforms:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "manifest missing version or platforms")
    rd = releases_dir()
    rd.mkdir(parents=True, exist_ok=True)
    dest = rd / "static-manifest.json"
    dest.write_text(json.dumps(body))
    return {"ok": True, "version": version, "platforms": sorted(platforms.keys())}


# Combine both routers under a single export so main.py can register in one call.
def install(app):
    """Called from main.py to mount both /updates and /admin/updates routers."""
    app.include_router(router)
    app.include_router(_admin_updates_router)
