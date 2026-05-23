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

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response

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
    base = str(request.base_url).rstrip("/")
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
    artifact_path = Path(platform_block["local_path"])
    if not artifact_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"artifact missing: {artifact_path}")
    return FileResponse(artifact_path, filename=artifact_path.name, media_type="application/octet-stream")
