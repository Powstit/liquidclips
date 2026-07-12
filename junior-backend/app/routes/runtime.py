"""Runtime bundle manifest + upload + promote endpoints (Runtime Update v1 · Phase 1).

The desktop SHELL is a thin native runtime. The product experience (React UI,
copy, components, navigation) ships from this backend as signed frontend
bundles. Users get UI updates on next relaunch without reinstalling the .app.

See `desktop-2/docs/lc2/RUNTIME_UPDATE_ARCHITECTURE.md` for the full design.

This file mirrors the `app/routes/updates.py` pattern (used by
`tauri-plugin-updater` for NATIVE shell updates). The two coexist:
- `/updates/*` — full Tauri shell tarball (rare, signed-DMG path)
- `/runtime/*` — frontend bundle only (frequent, signed-tar path)

Endpoints:
  GET  /runtime/manifest.json  → which bundle should the shell use right now
                                  (refuses non-PASS ship_lens_verdict)
  POST /runtime/upload         → stage a new bundle (verdict starts PENDING,
                                  bundle on disk, not yet serveable)
  POST /runtime/promote        → flip a staged bundle to PASS so the manifest
                                  endpoint starts serving it. Caller (CI /
                                  runtime-ship.sh) sets ship_lens_verdict
                                  after the reviewer subagent returns PASS.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import text as _text

from app.db import engine
from app.deps import require_internal_secret

router = APIRouter(prefix="/runtime", tags=["runtime"])


# Storage dir — mirrors releases_dir() from updates.py. For Phase 1 we keep
# bundles on the Railway volume; Phase 2 moves to Cloudflare R2 with this
# directory serving as the upload staging area.
def runtime_dir() -> Path:
    return Path(
        os.environ.get(
            "JUNIOR_RUNTIME_DIR",
            str(Path.home() / ".local/share/liquidclips/runtime"),
        )
    )


# Pubkey for SHIP-LENS-REVIEWER coordination — for Phase 1 the
# reviewer-dispatch is local to the shipping machine; the gate is enforced
# by the schema (manifest refuses non-PASS rows). Phase 2 wires actual
# reviewer-API verdict ingestion server-side.


# ─── GET /runtime/manifest.json ─────────────────────────────────────────
@router.get("/manifest.json")
def manifest(
    request: Request,
    channel: str = Query("stable", description="stable | beta | dev"),
    current_version: str | None = Query(None),
):
    """Desktop shell calls this on boot. Returns the bundle the shell should
    use, OR 204 if nothing newer than current_version exists for this channel.

    Hard rule: a manifest row with ship_lens_verdict != 'PASS' is INVISIBLE
    here. The schema's WHERE clause enforces white-screen prevention before
    any active user can download the bundle.

    BUG-009 (Wave B1 · runtime-truth, 2026-07-12) — the endpoint used to
    surface a 500 when the ``runtime_manifests`` table wasn't migrated
    (fresh dev DB / seed skip / SQLite bootstrap). The desktop UpdateBeacon
    polls every 5 min and every failed poll dropped a
    ``update_beacon_check_failed`` diag on the wire, drowning real signals.
    A missing table is semantically identical to an empty table for the
    beacon's purposes: "no update available". Wrap the SELECT in a
    try/except so any DB-side surface (missing table, missing column,
    transient connection error) degrades to a 204 instead of a 500. The
    client already treats 204 as "up to date" gracefully."""
    try:
        with engine.connect() as conn:
            row = conn.execute(
                _text(
                    """
                    SELECT version, sha256, signature, file, notes, pub_date,
                           ship_lens_verdict, ship_lens_review_url
                      FROM runtime_manifests
                     WHERE channel = :channel
                       AND ship_lens_verdict = 'PASS'
                     ORDER BY pub_date DESC
                     LIMIT 1
                    """
                ),
                {"channel": channel},
            ).mappings().first()
    except Exception:
        # BUG-009 · Wave B1 — DB unavailable / schema not migrated / any
        # transient SQL error degrades to "no update". The beacon quiets
        # down instead of flooding the diag ring. Deliberately silent —
        # a print/log here would defeat the whole point of the fix
        # (client emits its own metrics). Ship-lens observability lands
        # via the /telemetry/lcos_event pipeline (Train B3).
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    if not row:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    if current_version and current_version == row["version"]:
        # Client is already on the active bundle. Nothing to do.
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # Rewrite the download URL so the client fetches from this backend.
    # Same TLS-force pattern as /updates/latest.json — Railway terminates
    # TLS at its edge so request.base_url is http; updater clients want https.
    base = str(request.base_url).rstrip("/")
    if base.startswith("http://") and "localhost" not in base and "127.0.0.1" not in base:
        base = "https://" + base[len("http://"):]
    bundle_url = f"{base}/runtime/download/{row['version']}"

    return JSONResponse(
        {
            "version": row["version"],
            "channel": channel,
            "sha256": row["sha256"],
            "signature": row["signature"],
            "url": bundle_url,
            "notes": row["notes"] or "",
            "pub_date": (
                row["pub_date"].isoformat()
                if hasattr(row["pub_date"], "isoformat")
                else str(row["pub_date"])
            ),
            "ship_lens_verdict": row["ship_lens_verdict"],
            "ship_lens_review_url": row["ship_lens_review_url"],
        }
    )


# ─── GET /runtime/download/<version> ────────────────────────────────────
@router.get("/download/{version}")
def download_bundle(version: str):
    """Stream the bundle tarball for `version`. Hash verification happens
    client-side against the manifest's sha256."""
    with engine.connect() as conn:
        row = conn.execute(
            _text("SELECT file FROM runtime_manifests WHERE version = :v"),
            {"v": version},
        ).mappings().first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"version {version!r} not in runtime_manifests")
    fname = row["file"]
    path = runtime_dir() / Path(fname).name
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"bundle missing on disk: {path.name}")
    return FileResponse(path, filename=path.name, media_type="application/gzip")


# ─── POST /runtime/upload ───────────────────────────────────────────────
@router.post("/upload")
async def upload_bundle(
    request: Request,
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
):
    """Push a new bundle tarball. Inserts a runtime_manifests row with
    ship_lens_verdict = 'PENDING'. The bundle is on disk and addressable
    via /runtime/download/<v> but the manifest endpoint will NOT serve it
    until a /runtime/promote call flips the verdict to PASS.

    Mirrors /updates/upload — same INTERNAL_API_SECRET gate (fail-closed
    via `deps.require_internal_secret`), same raw-body streaming pattern
    (bundles are 30-200MB).

    Headers:
      x-internal-secret    shared server secret
      x-runtime-version    e.g. 2.3.1
      x-runtime-channel    stable | beta | dev (default: stable)
      x-runtime-signature  minisign signature of the tarball (base64 .sig contents)
      x-runtime-filename   e.g. liquidclips-runtime-2.3.1.tar.gz
      x-runtime-notes      (optional) release notes for the manifest
    Body: the raw bundle tarball bytes.
    """
    version = request.headers.get("x-runtime-version")
    channel = request.headers.get("x-runtime-channel", "stable")
    signature = request.headers.get("x-runtime-signature")
    filename = request.headers.get("x-runtime-filename")
    notes = request.headers.get("x-runtime-notes", "")
    if not (version and signature and filename):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "missing x-runtime-version / x-runtime-signature / x-runtime-filename",
        )

    rd = runtime_dir()
    rd.mkdir(parents=True, exist_ok=True)
    safe_name = Path(filename).name
    dest = rd / safe_name

    # Stream tarball to disk + compute sha256 as we go (no double-read).
    hasher = hashlib.sha256()
    size = 0
    with dest.open("wb") as fh:
        async for chunk in request.stream():
            fh.write(chunk)
            hasher.update(chunk)
            size += len(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty body")

    sha256_hex = hasher.hexdigest()

    # UPSERT: if the version already exists, replace it (re-uploads happen
    # during dev iteration). Verdict resets to PENDING — caller must
    # re-promote after re-review.
    with engine.begin() as conn:
        conn.execute(
            _text(
                """
                INSERT INTO runtime_manifests
                    (version, channel, sha256, signature, file, notes,
                     pub_date, ship_lens_verdict, ship_lens_review_url)
                VALUES
                    (:version, :channel, :sha256, :signature, :file, :notes,
                     :pub_date, 'PENDING', NULL)
                ON CONFLICT (version)
                DO UPDATE SET
                    channel = EXCLUDED.channel,
                    sha256 = EXCLUDED.sha256,
                    signature = EXCLUDED.signature,
                    file = EXCLUDED.file,
                    notes = EXCLUDED.notes,
                    pub_date = EXCLUDED.pub_date,
                    ship_lens_verdict = 'PENDING',
                    ship_lens_review_url = NULL
                """
            ),
            {
                "version": version,
                "channel": channel,
                "sha256": sha256_hex,
                "signature": signature,
                "file": safe_name,
                "notes": notes,
                "pub_date": datetime.now(timezone.utc),
            },
        )

    return {
        "ok": True,
        "version": version,
        "channel": channel,
        "sha256": sha256_hex,
        "file": safe_name,
        "bytes": size,
        "ship_lens_verdict": "PENDING",
        "next_step": (
            "POST /runtime/promote with x-runtime-version + "
            "x-ship-lens-verdict=PASS + x-ship-lens-review-url after the "
            "ship-lens-reviewer subagent has audited the staged bundle."
        ),
    }


# ─── POST /runtime/promote ──────────────────────────────────────────────
@router.post("/promote")
async def promote_bundle(
    request: Request,
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
):
    """Flip a staged bundle's ship_lens_verdict so /runtime/manifest.json
    starts serving it. Caller (runtime-ship.sh) calls this AFTER the
    ship-lens-reviewer subagent returns verdict PASS. Fail-closed
    internal-secret gate via `deps.require_internal_secret`.

    Headers:
      x-internal-secret      shared server secret
      x-runtime-version      version to promote
      x-ship-lens-verdict    PASS | BLOCK (BLOCK is a no-op promotion =
                             explicit reject; manifest will skip the row)
      x-ship-lens-review-url URL to the verdict JSON file (optional but
                             recommended for auditability)
    """
    version = request.headers.get("x-runtime-version")
    verdict = request.headers.get("x-ship-lens-verdict", "").upper()
    review_url = request.headers.get("x-ship-lens-review-url")

    if not version:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "missing x-runtime-version")
    if verdict not in ("PASS", "BLOCK"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "x-ship-lens-verdict must be PASS or BLOCK",
        )

    with engine.begin() as conn:
        result = conn.execute(
            _text(
                """
                UPDATE runtime_manifests
                   SET ship_lens_verdict = :verdict,
                       ship_lens_review_url = :review_url,
                       promoted_at = :now
                 WHERE version = :version
             RETURNING version, channel, ship_lens_verdict
                """
            ),
            {
                "verdict": verdict,
                "review_url": review_url,
                "now": datetime.now(timezone.utc),
                "version": version,
            },
        ).mappings().first()

    if not result:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"version {version!r} not found in runtime_manifests "
            "(POST /runtime/upload first)",
        )

    return {
        "ok": True,
        "version": result["version"],
        "channel": result["channel"],
        "ship_lens_verdict": result["ship_lens_verdict"],
        "review_url": review_url,
        "serving": result["ship_lens_verdict"] == "PASS",
    }
