"""Constellation Railway pool · health-check + failover selector.

Three-slot pool (primary · hq-backup · third). HQ pastes URL + key into
a slot via the admin panel — loads LIVE by reading the
``constellation_pool_members`` table.

Client (desktop-2 Watchdog) reads pool state via
``GET /hq/nodes/pool-config`` and iterates slots in order for failover.
When slot 1 is 5xx / unreachable, the client falls through to slot 2,
then slot 3.

Server side (this module) is used by:
  * ``pool_status()`` — returns live health of every slot for the HQ
    admin panel Constellation tab.
  * ``get_pool_config_for_client()`` — trimmed shape for the client
    (URL + a per-member internal secret NEVER exposed; the client uses
    URLs only, auth is per-endpoint).
  * ``update_slot()`` / ``rotate_slot_key()`` / ``disable_slot()`` —
    mutations wired to the admin routes.

Reachability is checked lazily (on ``pool_status()`` call) rather than
via a background task, so we don't have to plumb an APScheduler entry.
The HQ admin panel polls every 5s which is a natural rate limit.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.constellation.crypto import decrypt_secret, encrypt_secret

log = logging.getLogger(__name__)

_HEALTH_TIMEOUT_MS = 500
_HEALTH_PATH = "/healthcheck"


def _row_to_dict(row: Any) -> dict[str, Any]:
    """Convert a SQLAlchemy row to a dict keyed by column name."""
    return {k: v for k, v in row._mapping.items()}


def get_pool_members(db: Session, include_disabled: bool = False) -> list[dict[str, Any]]:
    """Read the pool config from Postgres. Ordered by slot.

    Returned rows are pre-decrypted — callers get plain URL + api_key.
    NEVER surface these to the browser; the admin routes gate this with
    require_admin.
    """
    q = "SELECT slot, name, url, api_key_enc, enabled, last_reachable_at, last_latency_ms, last_error, updated_at FROM constellation_pool_members"
    if not include_disabled:
        q += " WHERE enabled = true"
    q += " ORDER BY slot ASC"
    rows = db.execute(text(q)).fetchall()

    out = []
    for row in rows:
        d = _row_to_dict(row)
        d["api_key"] = decrypt_secret(d.pop("api_key_enc"))
        d["api_key_configured"] = d["api_key"] is not None
        out.append(d)
    return out


def get_pool_config_for_client(db: Session) -> list[dict[str, Any]]:
    """Trimmed pool config safe to hand to the desktop client.

    Client only needs URL + reachability. The api_key is server-side
    only (used by pool members to talk to each other, not by clients).
    Client authenticates its own POST /hq/nodes/intercession via the
    license JWT, not via a per-member key.
    """
    members = get_pool_members(db, include_disabled=False)
    return [
        {
            "slot": m["slot"],
            "name": m["name"],
            "url": m["url"],
            "last_reachable_at": (
                m["last_reachable_at"].isoformat() if m["last_reachable_at"] else None
            ),
        }
        for m in members
        if m["url"]  # skip empty slots
    ]


def probe_member(url: str) -> tuple[bool, int | None, str | None]:
    """Ping a member's /healthcheck. Returns (reachable, latency_ms, error)."""
    if not url:
        return False, None, "no url configured"
    endpoint = url.rstrip("/") + _HEALTH_PATH
    start = time.perf_counter()
    try:
        with httpx.Client(timeout=_HEALTH_TIMEOUT_MS / 1000.0) as client:
            r = client.get(endpoint)
        latency_ms = int((time.perf_counter() - start) * 1000)
        if r.status_code == 200:
            return True, latency_ms, None
        return False, latency_ms, f"http {r.status_code}"
    except httpx.TimeoutException:
        return False, None, "timeout"
    except httpx.RequestError as e:
        return False, None, str(e)[:180]


def pool_status(db: Session) -> dict[str, Any]:
    """Full pool health snapshot for the HQ admin panel.

    Probes every enabled member with a URL. Writes reachability back to
    the row so subsequent HQ polls see fresh data even if this call
    times out on a member.
    """
    members = get_pool_members(db, include_disabled=True)
    write_active = None
    result = []
    for m in members:
        slot = m["slot"]
        url = m["url"]
        if not m["enabled"] or not url:
            result.append(
                {
                    "slot": slot,
                    "name": m["name"],
                    "url": url,
                    "enabled": m["enabled"],
                    "reachable": False,
                    "latency_ms": None,
                    "last_error": "empty slot" if not url else "disabled",
                    "key_configured": m["api_key_configured"],
                    "last_reachable_at": (
                        m["last_reachable_at"].isoformat() if m["last_reachable_at"] else None
                    ),
                }
            )
            continue
        reachable, latency, err = probe_member(url)
        now = datetime.now(timezone.utc)
        if reachable:
            db.execute(
                text(
                    "UPDATE constellation_pool_members SET last_reachable_at = :now, last_latency_ms = :lat, last_error = NULL WHERE slot = :slot"
                ),
                {"now": now, "lat": latency, "slot": slot},
            )
            if write_active is None:
                write_active = m["name"]
        else:
            db.execute(
                text(
                    "UPDATE constellation_pool_members SET last_latency_ms = :lat, last_error = :err WHERE slot = :slot"
                ),
                {"lat": latency, "err": err, "slot": slot},
            )
        result.append(
            {
                "slot": slot,
                "name": m["name"],
                "url": url,
                "enabled": m["enabled"],
                "reachable": reachable,
                "latency_ms": latency,
                "last_error": err,
                "key_configured": m["api_key_configured"],
                "last_reachable_at": now.isoformat() if reachable else (
                    m["last_reachable_at"].isoformat() if m["last_reachable_at"] else None
                ),
            }
        )
    db.commit()
    return {"write_active": write_active, "members": result}


def update_slot(
    db: Session,
    slot: int,
    url: str | None,
    api_key: str | None,
    enabled: bool = True,
    updated_by: str = "hq",
) -> dict[str, Any]:
    """HQ writes a member into a slot. Encrypts the key at rest."""
    if slot not in (1, 2, 3):
        raise ValueError(f"invalid slot {slot}; must be 1, 2, or 3")

    enc = encrypt_secret(api_key) if api_key else None
    q = """
        UPDATE constellation_pool_members
        SET url = :url,
            api_key_enc = COALESCE(:enc, api_key_enc),
            enabled = :enabled,
            updated_at = now(),
            last_error = NULL
        WHERE slot = :slot
    """
    db.execute(
        text(q),
        {"slot": slot, "url": url, "enc": enc, "enabled": enabled},
    )
    db.commit()
    log.info("[constellation.pool] slot %d updated by %s (url=%s)", slot, updated_by, url)
    return {"ok": True, "slot": slot}


def rotate_slot_key(db: Session, slot: int, new_key: str) -> dict[str, Any]:
    """Rotate the API key for a slot. URL untouched."""
    enc = encrypt_secret(new_key)
    db.execute(
        text(
            "UPDATE constellation_pool_members SET api_key_enc = :enc, updated_at = now() WHERE slot = :slot"
        ),
        {"slot": slot, "enc": enc},
    )
    db.commit()
    return {"ok": True, "slot": slot}


def disable_slot(db: Session, slot: int) -> dict[str, Any]:
    """Soft-remove a member from failover."""
    db.execute(
        text(
            "UPDATE constellation_pool_members SET enabled = false, updated_at = now() WHERE slot = :slot"
        ),
        {"slot": slot},
    )
    db.commit()
    return {"ok": True, "slot": slot}
