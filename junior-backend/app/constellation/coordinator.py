"""Constellation coordinator · orchestrates fix runs.

Called on every failure ingest and by HQ's manual dispatch endpoint.

Flow:
  1. record_failure()      · append to node_failures + upsert node_meta
  2. maybe_dispatch_fix()  · check rolling score · if RED, fire LLM
  3. _dispatch()           · pick assigned LLM or fallback · call adapter
  4. _persist_patch()      · store the LLM's proposed patch for HQ review

Threshold:
  * rolling_score = SUM(weight) over failures in last 5 minutes
  * YELLOW = 3   (surfacing on the state page)
  * RED    = 10  (auto-dispatch fix)

Idempotence:
  * only ONE proposed patch per node at a time (skip dispatch if a patch
    with status='proposed' already exists for the node)
  * budget guard: skip dispatch if assignment.used_cents >= budget_cents

Nothing here is client-facing. All calls come from routes/constellation.py.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.constellation.crypto import decrypt_secret
from app.constellation.llm_dispatcher import dispatch_fix

log = logging.getLogger(__name__)

YELLOW_THRESHOLD = 3
RED_THRESHOLD = 10
ROLLING_WINDOW = timedelta(minutes=5)


# ─── Failure ingest ────────────────────────────────────────────────────


def record_failure(
    db: Session,
    node_id: str,
    label: str,
    cluster: str,
    source: str | None,
    weight: int,
    message: str,
    stack: str | None,
    context: dict[str, Any] | None,
    user_id: str | None,
    app_version: str | None,
) -> int:
    """Append a failure row + upsert node_meta.

    Returns the inserted failure id (int) for correlation.
    """
    row = db.execute(
        text(
            """
            INSERT INTO constellation_node_failures
                (node_id, cluster, weight, message, stack, context, user_id, app_version)
            VALUES
                (:node_id, :cluster, :weight, :message, :stack, CAST(:context AS jsonb), :user_id, :app_version)
            RETURNING id
            """
        ),
        {
            "node_id": node_id,
            "cluster": cluster,
            "weight": weight,
            "message": message[:2000],
            "stack": stack[:8000] if stack else None,
            "context": _dumps(context),
            "user_id": user_id,
            "app_version": app_version,
        },
    )
    failure_id = row.scalar_one()

    # Upsert node_meta so HQ sees the node without a pre-seed step
    db.execute(
        text(
            """
            INSERT INTO constellation_node_meta (node_id, label, cluster, source, first_seen_at, last_seen_at)
            VALUES (:node_id, :label, :cluster, :source, now(), now())
            ON CONFLICT (node_id) DO UPDATE SET
                label = EXCLUDED.label,
                cluster = EXCLUDED.cluster,
                source = COALESCE(EXCLUDED.source, constellation_node_meta.source),
                last_seen_at = now()
            """
        ),
        {"node_id": node_id, "label": label, "cluster": cluster, "source": source},
    )
    db.commit()
    log.info("[constellation] failure recorded · node=%s weight=%d", node_id, weight)
    return failure_id


def rolling_score(db: Session, node_id: str) -> int:
    """Rolling weighted failure score over the last 5 minutes."""
    cutoff = datetime.now(timezone.utc) - ROLLING_WINDOW
    row = db.execute(
        text(
            "SELECT COALESCE(SUM(weight), 0) FROM constellation_node_failures WHERE node_id = :nid AND ts > :cutoff"
        ),
        {"nid": node_id, "cutoff": cutoff},
    ).scalar_one()
    return int(row or 0)


def health_from_score(score: int) -> str:
    if score >= RED_THRESHOLD:
        return "red"
    if score >= YELLOW_THRESHOLD:
        return "yellow"
    return "green"


# ─── Dispatch decision ─────────────────────────────────────────────────


def _existing_open_patch(db: Session, node_id: str) -> bool:
    row = db.execute(
        text(
            "SELECT 1 FROM constellation_node_patches WHERE node_id = :nid AND status = 'proposed' LIMIT 1"
        ),
        {"nid": node_id},
    ).scalar_one_or_none()
    return row is not None


def _recent_failures(db: Session, node_id: str, limit: int = 10) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT id, ts, weight, message, stack, context
            FROM constellation_node_failures
            WHERE node_id = :nid
            ORDER BY ts DESC
            LIMIT :lim
            """
        ),
        {"nid": node_id, "lim": limit},
    ).fetchall()
    out = []
    for r in rows:
        d = {k: v for k, v in r._mapping.items()}
        if isinstance(d.get("ts"), datetime):
            d["ts"] = d["ts"].isoformat()
        out.append(d)
    return out


def _node_meta(db: Session, node_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            "SELECT node_id, label, cluster, source, owner, money_critical, runbook_url FROM constellation_node_meta WHERE node_id = :nid"
        ),
        {"nid": node_id},
    ).one_or_none()
    if not row:
        return None
    return {k: v for k, v in row._mapping.items()}


def _assignment(db: Session, node_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT node_id, provider, model, api_key_enc, system_prompt, budget_cents, used_cents
            FROM constellation_node_assignments
            WHERE node_id = :nid
            """
        ),
        {"nid": node_id},
    ).one_or_none()
    if not row:
        return None
    d = {k: v for k, v in row._mapping.items()}
    d["api_key"] = decrypt_secret(d.pop("api_key_enc"))
    return d


def _fallback_config(db: Session) -> dict[str, Any]:
    row = db.execute(
        text(
            "SELECT provider, model, api_key_enc, budget_cents, used_cents FROM constellation_fallback_config WHERE id = 'fallback'"
        ),
    ).one_or_none()
    if not row:
        return {
            "provider": "anthropic",
            "model": "claude-opus-4-7",
            "api_key": None,
            "budget_cents": None,
            "used_cents": 0,
        }
    d = {k: v for k, v in row._mapping.items()}
    d["api_key"] = decrypt_secret(d.pop("api_key_enc"))
    return d


def maybe_dispatch_fix(
    db: Session,
    node_id: str,
    trigger: str = "auto",
) -> dict[str, Any]:
    """Called after every failure ingest AND from the manual dispatch endpoint.

    Returns a decision dict with the outcome:
      { "dispatched": bool, "reason": "...", "patch_id": Optional[str] }
    """
    meta = _node_meta(db, node_id)
    if not meta:
        return {"dispatched": False, "reason": "no_meta"}

    score = rolling_score(db, node_id)
    if trigger == "auto" and score < RED_THRESHOLD:
        return {"dispatched": False, "reason": "below_threshold", "score": score}

    if _existing_open_patch(db, node_id):
        return {"dispatched": False, "reason": "patch_already_proposed"}

    # Pick LLM · assigned first, fallback if no assignment or missing key
    assignment = _assignment(db, node_id)
    using = "assignment"
    if assignment and assignment.get("api_key"):
        if assignment["used_cents"] >= assignment["budget_cents"]:
            using = "fallback_budget_exhausted"
            assignment = None
        else:
            provider = assignment["provider"]
            model = assignment["model"]
            api_key = assignment["api_key"]
            system_prompt_override = assignment.get("system_prompt")
    if not assignment or not assignment.get("api_key"):
        fb = _fallback_config(db)
        if not fb.get("api_key"):
            log.warning("[constellation] no assignment + no fallback key · node=%s", node_id)
            return {"dispatched": False, "reason": "no_llm_available"}
        provider = fb["provider"]
        model = fb["model"]
        api_key = fb["api_key"]
        system_prompt_override = None
        using = "fallback"

    failures = _recent_failures(db, node_id, limit=10)
    if not failures:
        return {"dispatched": False, "reason": "no_recent_failures"}

    log.info(
        "[constellation] dispatching fix · node=%s trigger=%s using=%s",
        node_id, trigger, using,
    )
    result = dispatch_fix(
        provider=provider,
        model=model,
        api_key=api_key,
        node_meta=meta,
        failures=failures,
        system_prompt_override=system_prompt_override,
    )

    # Track spend
    if using == "assignment" and result["cost_cents"] > 0:
        db.execute(
            text(
                "UPDATE constellation_node_assignments SET used_cents = used_cents + :c, last_dispatch_at = now() WHERE node_id = :nid"
            ),
            {"c": result["cost_cents"], "nid": node_id},
        )
    elif using == "fallback" and result["cost_cents"] > 0:
        db.execute(
            text(
                "UPDATE constellation_fallback_config SET used_cents = used_cents + :c WHERE id = 'fallback'"
            ),
            {"c": result["cost_cents"]},
        )

    if not result["ok"]:
        db.commit()
        return {
            "dispatched": True,
            "reason": "llm_returned_no_diff",
            "using": using,
            "error": result.get("error"),
        }

    patch_id = _persist_patch(db, node_id, result, using, [f["id"] for f in failures])
    db.commit()
    return {
        "dispatched": True,
        "reason": "patch_proposed",
        "patch_id": patch_id,
        "using": using,
    }


def _persist_patch(
    db: Session,
    node_id: str,
    result: dict[str, Any],
    proposed_by: str,
    failure_ids: list[int],
) -> str:
    """Store an LLM-proposed patch. Returns the patch_id."""
    patch_id = f"patch_{secrets.token_hex(6)}"
    db.execute(
        text(
            """
            INSERT INTO constellation_node_patches
                (id, node_id, proposed_by, summary, diff_text, touched_files, status, failure_ids)
            VALUES
                (:id, :nid, :by, :summary, :diff, CAST(:touched AS jsonb), 'proposed', CAST(:fids AS jsonb))
            """
        ),
        {
            "id": patch_id,
            "nid": node_id,
            "by": proposed_by,
            "summary": result["summary"][:400],
            "diff": result["diff"],
            "touched": _dumps(result["touched_files"]),
            "fids": _dumps(failure_ids),
        },
    )
    return patch_id


# ─── State page + helpers ──────────────────────────────────────────────


def sky_map(db: Session) -> dict[str, Any]:
    """Full sky-map payload for the HQ Admin Constellation state page."""
    # Nodes with rolling failure counts
    q = """
        SELECT
            m.node_id,
            m.label,
            m.cluster,
            m.source,
            m.owner,
            m.money_critical,
            m.runbook_url,
            m.last_seen_at,
            (
                SELECT COALESCE(SUM(weight), 0)
                FROM constellation_node_failures f
                WHERE f.node_id = m.node_id AND f.ts > now() - INTERVAL '5 minutes'
            ) AS failure_score,
            (
                SELECT COUNT(*)
                FROM constellation_node_failures f
                WHERE f.node_id = m.node_id AND f.ts > now() - INTERVAL '5 minutes'
            ) AS failures_5m
        FROM constellation_node_meta m
        ORDER BY m.cluster, m.node_id
    """
    node_rows = db.execute(text(q)).fetchall()

    # Overrides + assignments in bulk
    overrides = {
        r._mapping["node_id"]: dict(r._mapping)
        for r in db.execute(text("SELECT * FROM constellation_node_overrides")).fetchall()
    }
    assignments = {
        r._mapping["node_id"]: dict(r._mapping)
        for r in db.execute(
            text("SELECT node_id, provider, model, budget_cents, used_cents, hired_at, hired_by, last_dispatch_at FROM constellation_node_assignments")
        ).fetchall()
    }

    # Proposed patches per node
    proposed = {}
    for r in db.execute(
        text(
            "SELECT id, node_id, summary, proposed_at, proposed_by FROM constellation_node_patches WHERE status = 'proposed'"
        )
    ).fetchall():
        proposed.setdefault(r._mapping["node_id"], []).append(dict(r._mapping))

    clusters: dict[str, list[dict[str, Any]]] = {}
    counts = {"total": 0, "healthy": 0, "yellow": 0, "red": 0, "awaiting_hire": 0}
    for row in node_rows:
        d = dict(row._mapping)
        score = int(d["failure_score"] or 0)
        health = health_from_score(score)
        counts["total"] += 1
        if health == "green":
            counts["healthy"] += 1
        elif health == "yellow":
            counts["yellow"] += 1
        else:
            counts["red"] += 1
        if d["node_id"] not in assignments:
            counts["awaiting_hire"] += 1

        node_out = {
            "meta": {
                "id": d["node_id"],
                "label": d["label"],
                "cluster": d["cluster"],
                "source": d["source"],
                "owner": d["owner"],
                "money_critical": d["money_critical"],
                "runbook_url": d["runbook_url"],
            },
            "failure_score": score,
            "failures_5m": int(d["failures_5m"] or 0),
            "health": health,
            "last_seen_at": d["last_seen_at"].isoformat() if d["last_seen_at"] else None,
            "assignment": _shape_assignment(assignments.get(d["node_id"])),
            "override": _shape_override(overrides.get(d["node_id"])),
            "proposed_patches": _shape_patches(proposed.get(d["node_id"], [])),
        }
        clusters.setdefault(d["cluster"], []).append(node_out)

    fb = _fallback_config(db)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "note": "Live node health from Watchdog runtime. failureScore rolls over 5 min; health flips yellow at 3 and red at 10.",
        "summary": counts,
        "coordinator": {
            "role": "Claude 1 · Anthropic",
            "fallback_key_configured": bool(fb.get("api_key")),
            "fallback_model": fb.get("model"),
        },
        "clusters": [
            {"cluster": name, "nodes": nodes}
            for name, nodes in sorted(clusters.items())
        ],
    }


def _shape_assignment(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "provider": row["provider"],
        "model": row["model"],
        "hired_at": row["hired_at"].isoformat() if row["hired_at"] else None,
        "hired_by": row["hired_by"],
        "budget_cents": row["budget_cents"],
        "used_cents": row["used_cents"],
        "api_key_configured": True,
        "last_dispatch_at": row["last_dispatch_at"].isoformat() if row["last_dispatch_at"] else None,
    }


def _shape_override(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {}
    return {
        "disabled": row["disabled"],
        "api_key_override_configured": bool(row.get("api_key_override_enc")),
        "cleared_at": row["cleared_at"].isoformat() if row["cleared_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        "updated_by": row["updated_by"],
    }


def _shape_patches(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": r["id"],
            "summary": r["summary"],
            "proposed_at": r["proposed_at"].isoformat() if r["proposed_at"] else None,
            "proposed_by": r["proposed_by"],
        }
        for r in rows
    ]


def _dumps(v: Any) -> str:
    import json
    return json.dumps(v if v is not None else {})
