"""Constellation Engine · admin + client routes.

Two auth surfaces:
  * ``/admin/constellation/*`` — HQ + our admin panel · `require_admin`
    (internal-secret + clerk-user-id + email allowlist)
  * ``/hq/nodes/*`` — client (desktop-2 Watchdog) reporter. Rate-limited,
    tolerates anonymous free-tier users (no bearer token). We stamp
    user_id when a valid license JWT is present so failures correlate
    to a user, but never require it.

See HQ_CONSTELLATION_ENGINE_SPEC_2026-07-05.md for the response shapes
and the HQ admin panel binding contract.
"""

from __future__ import annotations

import logging
import secrets as _secrets
from datetime import datetime, timezone
from typing import Annotated, Any

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.constellation import coordinator, crypto, pool
from app.constellation.recommendations import get_recommendations_payload
from app.db import get_db
from app.jwt_signer import verify_license_jwt
from app.routes.admin import AdminUser

log = logging.getLogger(__name__)

admin_router = APIRouter(prefix="/admin/constellation", tags=["constellation-admin"])
client_router = APIRouter(prefix="/hq/nodes", tags=["constellation-client"])


# ─── Client · POST intercession ────────────────────────────────────────


class InterventionIn(BaseModel):
    nodeId: str = Field(..., min_length=1, max_length=240)
    label: str = Field(..., min_length=1, max_length=200)
    cluster: str = Field(..., min_length=1, max_length=40)
    source: str | None = Field(None, max_length=400)
    weight: int = Field(1, ge=1, le=100)
    message: str = Field("", max_length=2000)
    stack: str | None = Field(None, max_length=8000)
    context: dict[str, Any] | None = None
    app_version: str | None = Field(None, max_length=40)


def _maybe_user_id(authorization: str | None) -> str | None:
    """Extract user_id from license JWT if present. Anonymous tolerated."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(None, 1)[1].strip()
    try:
        claims = verify_license_jwt(token)
        return claims.get("sub")
    except jwt.PyJWTError:
        return None


@client_router.post("/intercession")
def intercession(
    body: InterventionIn,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """Client (Watchdog) POSTs failures here. Fire-and-forget from client
    side · we sync-persist + trigger coordinator, but the client doesn't
    wait for the fix run to complete (it just needs the 200 to move on).
    """
    user_id = _maybe_user_id(authorization)
    failure_id = coordinator.record_failure(
        db=db,
        node_id=body.nodeId,
        label=body.label,
        cluster=body.cluster,
        source=body.source,
        weight=body.weight,
        message=body.message or "(no message)",
        stack=body.stack,
        context=body.context,
        user_id=user_id,
        app_version=body.app_version,
    )
    # Threshold check + potential dispatch runs synchronously but is fast
    # (only fires network I/O when RED · rare event).
    decision = coordinator.maybe_dispatch_fix(db, body.nodeId, trigger="auto")
    return {
        "ok": True,
        "failure_id": failure_id,
        "dispatched": decision.get("dispatched", False),
        "reason": decision.get("reason"),
    }


@client_router.get("/state")
def client_state(db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    """Trimmed state for the desktop client. Contains:
      * pool_config — ordered list of Railway URLs for failover
      * overrides — per-node paused/disabled flags so client can render
        the admin-paused placeholder instead of running the node
    """
    pool_cfg = pool.get_pool_config_for_client(db)
    override_rows = db.execute(
        text("SELECT node_id, disabled, cleared_at FROM constellation_node_overrides WHERE disabled = true OR cleared_at IS NOT NULL")
    ).fetchall()
    overrides = {}
    for r in override_rows:
        d = dict(r._mapping)
        overrides[d["node_id"]] = {
            "disabled": d["disabled"],
            "cleared_at": d["cleared_at"].isoformat() if d["cleared_at"] else None,
        }
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pool_config": pool_cfg,
        "overrides": overrides,
    }


@client_router.get("/pool-config")
def client_pool_config(db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    """Standalone pool config for the boot-time failover selector."""
    return {"pool": pool.get_pool_config_for_client(db)}


# ─── Admin · state page ────────────────────────────────────────────────


@admin_router.get("/state")
def admin_state(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Full sky-map for the HQ Admin Constellation state page."""
    return coordinator.sky_map(db)


@admin_router.get("/recommended-models")
def recommended_models(admin: AdminUser) -> dict[str, Any]:
    """Model recommendations rendered in the assign-LLM modal.

    Panels bind the top-of-list dropdown from `catalog` (Kimi K2 first) and
    the cluster-specific override from `cluster_recommendations`. See
    `constellation/recommendations.py` for the source of truth.
    """
    return get_recommendations_payload()


@admin_router.get("/pool/status")
def pool_status_route(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Live pool health + slot metadata for the pool-config section
    at the top of the state page."""
    status_payload = pool.pool_status(db)
    status_payload["encryption_key_configured"] = crypto.is_encryption_configured()
    return status_payload


# ─── Admin · pool CRUD ─────────────────────────────────────────────────


class SetPoolMemberIn(BaseModel):
    url: str = Field(..., min_length=8, max_length=400)
    api_key: str | None = Field(None, max_length=500)
    enabled: bool = True


@admin_router.post("/pool/{slot}/set-member")
def set_pool_member(
    slot: int,
    body: SetPoolMemberIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if slot not in (1, 2, 3):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "slot must be 1, 2, or 3")
    return pool.update_slot(db, slot, body.url, body.api_key, body.enabled, updated_by=admin.email)


class RotateKeyIn(BaseModel):
    new_api_key: str = Field(..., min_length=8, max_length=500)


@admin_router.post("/pool/{slot}/rotate-key")
def rotate_pool_key(
    slot: int,
    body: RotateKeyIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if slot not in (1, 2, 3):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "slot must be 1, 2, or 3")
    return pool.rotate_slot_key(db, slot, body.new_api_key)


@admin_router.post("/pool/{slot}/disable")
def disable_pool_slot(
    slot: int,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    if slot not in (1, 2, 3):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "slot must be 1, 2, or 3")
    return pool.disable_slot(db, slot)


# ─── Admin · fallback LLM CRUD (my Anthropic key) ──────────────────────


class SetFallbackLLMIn(BaseModel):
    api_key: str = Field(..., min_length=8, max_length=500)
    model: str = Field("claude-opus-4-7", max_length=80)
    provider: str = Field("anthropic", max_length=40)
    budget_cents: int | None = None


@admin_router.post("/fallback-llm/set")
def set_fallback_llm(
    body: SetFallbackLLMIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    enc = crypto.encrypt_secret(body.api_key)
    db.execute(
        text(
            """
            UPDATE constellation_fallback_config
            SET api_key_enc = :enc, model = :model, provider = :provider,
                budget_cents = :budget, updated_at = now(), updated_by = :by
            WHERE id = 'fallback'
            """
        ),
        {"enc": enc, "model": body.model, "provider": body.provider, "budget": body.budget_cents, "by": admin.email},
    )
    db.commit()
    return {"ok": True}


# ─── Admin · per-node LLM assignments ──────────────────────────────────


class AssignLLMIn(BaseModel):
    provider: str = Field(..., max_length=40)
    model: str = Field(..., max_length=80)
    api_key: str = Field(..., min_length=8, max_length=500)
    system_prompt: str | None = Field(None, max_length=6000)
    budget_cents: int = 50000


@admin_router.post("/nodes/{node_id:path}/assign-llm")
def assign_llm(
    node_id: str,
    body: AssignLLMIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """HQ hires an LLM for this specific node. Overrides any previous
    assignment (upsert on PK)."""
    enc = crypto.encrypt_secret(body.api_key)
    db.execute(
        text(
            """
            INSERT INTO constellation_node_assignments
                (node_id, provider, model, api_key_enc, system_prompt, budget_cents, hired_by)
            VALUES
                (:nid, :prov, :model, :enc, :sp, :budget, :by)
            ON CONFLICT (node_id) DO UPDATE SET
                provider = EXCLUDED.provider,
                model = EXCLUDED.model,
                api_key_enc = EXCLUDED.api_key_enc,
                system_prompt = EXCLUDED.system_prompt,
                budget_cents = EXCLUDED.budget_cents,
                hired_at = now(),
                hired_by = EXCLUDED.hired_by,
                used_cents = 0
            """
        ),
        {
            "nid": node_id,
            "prov": body.provider,
            "model": body.model,
            "enc": enc,
            "sp": body.system_prompt,
            "budget": body.budget_cents,
            "by": admin.email,
        },
    )
    db.commit()
    return {"ok": True, "hired_at": datetime.now(timezone.utc).isoformat()}


@admin_router.post("/nodes/{node_id:path}/fire")
def fire_llm(
    node_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """HQ fires the assigned LLM. Node reverts to fallback."""
    db.execute(
        text("DELETE FROM constellation_node_assignments WHERE node_id = :nid"),
        {"nid": node_id},
    )
    db.commit()
    return {"ok": True, "fired_at": datetime.now(timezone.utc).isoformat()}


class OverrideIn(BaseModel):
    disabled: bool | None = None
    clear_score: bool = False
    api_key_override: str | None = None


@admin_router.post("/nodes/{node_id:path}/override")
def set_override(
    node_id: str,
    body: OverrideIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Pause · clear score · inject key on a node. Live circuit breaker."""
    enc = crypto.encrypt_secret(body.api_key_override) if body.api_key_override else None
    cleared = datetime.now(timezone.utc) if body.clear_score else None
    db.execute(
        text(
            """
            INSERT INTO constellation_node_overrides
                (node_id, disabled, api_key_override_enc, cleared_at, updated_by)
            VALUES
                (:nid, COALESCE(:disabled, false), :enc, :cleared, :by)
            ON CONFLICT (node_id) DO UPDATE SET
                disabled = COALESCE(EXCLUDED.disabled, constellation_node_overrides.disabled),
                api_key_override_enc = COALESCE(EXCLUDED.api_key_override_enc, constellation_node_overrides.api_key_override_enc),
                cleared_at = COALESCE(EXCLUDED.cleared_at, constellation_node_overrides.cleared_at),
                updated_at = now(),
                updated_by = EXCLUDED.updated_by
            """
        ),
        {"nid": node_id, "disabled": body.disabled, "enc": enc, "cleared": cleared, "by": admin.email},
    )
    db.commit()
    return {"ok": True}


@admin_router.post("/nodes/{node_id:path}/dispatch")
def manual_dispatch(
    node_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """HQ manually kicks a fix run (e.g. before a demo)."""
    return coordinator.maybe_dispatch_fix(db, node_id, trigger="manual")


# ─── Admin · patch review ──────────────────────────────────────────────


@admin_router.get("/patches/{patch_id}/diff")
def get_patch_diff(
    patch_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row = db.execute(
        text(
            "SELECT id, node_id, proposed_by, proposed_at, summary, diff_text, touched_files, status FROM constellation_node_patches WHERE id = :pid"
        ),
        {"pid": patch_id},
    ).one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "patch not found")
    d = dict(row._mapping)
    return {
        "id": d["id"],
        "node_id": d["node_id"],
        "proposed_by": d["proposed_by"],
        "proposed_at": d["proposed_at"].isoformat() if d["proposed_at"] else None,
        "summary": d["summary"],
        "diff": d["diff_text"],
        "touched_files": d["touched_files"],
        "status": d["status"],
    }


@admin_router.post("/patches/{patch_id}/approve")
def approve_patch(
    patch_id: str,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Approve a proposed patch. In v1: marks status=approved + records
    admin. Actual branch push happens in a follow-up sprint when we wire
    a git-worker service. For now the diff sits in Postgres for Daniel to
    review + apply by hand — no auto-merge blast radius risk."""
    row = db.execute(
        text("SELECT status FROM constellation_node_patches WHERE id = :pid"),
        {"pid": patch_id},
    ).one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "patch not found")
    if row[0] != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"patch is {row[0]}, cannot approve")
    branch = f"constellation/patch_{patch_id}"
    db.execute(
        text(
            "UPDATE constellation_node_patches SET status = 'approved', approved_at = now(), approved_by = :by, branch_name = :branch WHERE id = :pid"
        ),
        {"pid": patch_id, "by": admin.email, "branch": branch},
    )
    db.commit()
    return {"ok": True, "branch": branch, "note": "diff persisted; apply by hand or wire git-worker in follow-up"}


class RejectPatchIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


@admin_router.post("/patches/{patch_id}/reject")
def reject_patch(
    patch_id: str,
    body: RejectPatchIn,
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row = db.execute(
        text("SELECT status FROM constellation_node_patches WHERE id = :pid"),
        {"pid": patch_id},
    ).one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "patch not found")
    if row[0] != "proposed":
        raise HTTPException(status.HTTP_409_CONFLICT, f"patch is {row[0]}, cannot reject")
    db.execute(
        text(
            "UPDATE constellation_node_patches SET status = 'rejected', rejected_at = now(), rejection_reason = :reason WHERE id = :pid"
        ),
        {"pid": patch_id, "reason": body.reason[:2000]},
    )
    db.commit()
    return {"ok": True}


@admin_router.get("/patches")
def list_patches(
    admin: AdminUser,
    db: Annotated[Session, Depends(get_db)],
    node_id: str | None = None,
    status_filter: str | None = None,
) -> dict[str, Any]:
    """List patches with optional filters."""
    q = "SELECT id, node_id, proposed_by, proposed_at, summary, status, approved_at, rejected_at FROM constellation_node_patches"
    conds = []
    params: dict[str, Any] = {}
    if node_id:
        conds.append("node_id = :nid")
        params["nid"] = node_id
    if status_filter:
        conds.append("status = :status")
        params["status"] = status_filter
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY proposed_at DESC LIMIT 200"
    rows = db.execute(text(q), params).fetchall()
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "patches": [
            {
                "id": r._mapping["id"],
                "node_id": r._mapping["node_id"],
                "proposed_by": r._mapping["proposed_by"],
                "proposed_at": r._mapping["proposed_at"].isoformat() if r._mapping["proposed_at"] else None,
                "summary": r._mapping["summary"],
                "status": r._mapping["status"],
                "approved_at": r._mapping["approved_at"].isoformat() if r._mapping["approved_at"] else None,
                "rejected_at": r._mapping["rejected_at"].isoformat() if r._mapping["rejected_at"] else None,
            }
            for r in rows
        ],
    }
