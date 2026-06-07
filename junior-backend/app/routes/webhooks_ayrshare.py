"""Ayrshare webhook receiver.

ship-lens v0.7.8 P1 — channel.unlinked now flips status to "unlinked" (NOT
"pending_link"). The two states LOOK identical at the API surface but mean
very different things to the user:

  - pending_link : I never finished the OAuth dance — show "Finish linking"
  - unlinked     : The platform revoked my session (TikTok token expired,
                   I disconnected on the social side) — show
                   "Disconnected — reconnect" with a red dot.

Conflating them sent users back through the "first-time link" copy when
they'd actually completed it, which felt like the app forgot their account.

Endpoint: POST /webhooks/ayrshare

Ayrshare emits a POST to this URL when a scheduled post fires (success or
failure), an analytics window closes, a channel is linked/unlinked, or a
token refresh updates a profile. We flip the corresponding schedules row
(`scheduled` → `published` / `failed`) and the corresponding
social_channels row (`pending_link` → `active`, `active` → `unlinked`)
without having to poll Ayrshare every minute.

Configure the URL on Ayrshare's dashboard (Settings → Webhooks):
    https://api.jnremployee.com/webhooks/ayrshare

Signature verification:
    Ayrshare sends an `x-ayrshare-signature` header (HMAC-SHA256 over the
    raw body using the user's webhook secret). When AYRSHARE_WEBHOOK_SECRET
    is unset (local dev / pre-config) we accept events unverified — same
    convention as the other webhook handlers in this codebase. We still
    require `idempotencyKey` (or a stable id) so retries don't double-fire.

Payload shapes vary by event:

    {"type": "post", "status": "success", "id": "<ayrshare post id>",
     "idempotencyKey": "...", "postIds": [{platform, postUrl, id}, ...]}

    {"type": "post", "status": "error", "id": "<ayrshare post id>",
     "idempotencyKey": "...", "errors": [{platform, message}, ...]}

    {"type": "channel.linked",   "profileKey": "...", "platform": "tiktok",
     "handle": "@daniel", "idempotencyKey": "..."}

    {"type": "channel.unlinked", "profileKey": "...", "platform": "tiktok",
     "idempotencyKey": "..."}

Out-of-order safety: channel events that arrive AFTER a newer probe
(`last_probe_at` is newer than the webhook's `received_at` proxy) are
ignored, so a late-arriving `channel.unlinked` for an old session can't
flip an `active` channel back to `pending_link`.

We're forward-compatible: unknown event types are 200-ack'd so Ayrshare
doesn't keep retrying.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Schedule, SocialChannel, WebhookEvent
from app.routes.notifications import write_notification

log = logging.getLogger("junior.webhooks.ayrshare")

router = APIRouter(prefix="/webhooks", tags=["webhooks", "ayrshare"])


def _verify_signature(raw_body: bytes, signature: str | None) -> bool:
    """Returns True when the body matches AYRSHARE_WEBHOOK_SECRET, OR when
    no secret is configured (dev / pre-config). Returns False only when a
    secret IS configured and the signature is missing / wrong.

    Logs a warning on every failure path so prod can spot a misconfigured
    secret or a forged delivery without log-diving."""
    secret = os.environ.get("AYRSHARE_WEBHOOK_SECRET", "").strip()
    if not secret:
        # Dev / pre-config — accept but record that we did.
        log.debug("[ayrshare] signature check skipped (no AYRSHARE_WEBHOOK_SECRET set)")
        return True
    if not signature:
        log.warning("[ayrshare] signature missing on signed-mode delivery")
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    # Ayrshare ships either the hex digest directly or a `sha256=<hex>`
    # prefix depending on dashboard config — tolerate both.
    candidate = signature.split("=", 1)[1] if "=" in signature else signature
    ok = hmac.compare_digest(expected, candidate.strip())
    if not ok:
        log.warning("[ayrshare] signature mismatch (len=%d)", len(signature))
    return ok


def _idempotency_id(payload: dict[str, Any]) -> str | None:
    """Best-effort stable id for the webhook event. Prefer Ayrshare's
    `idempotencyKey`, fall back to the post id."""
    for key in ("idempotencyKey", "idempotency_key", "id", "postId", "post_id"):
        v = payload.get(key)
        if isinstance(v, str) and v:
            return v
    return None


def _find_schedule(db: Session, payload: dict[str, Any]) -> Schedule | None:
    """Match the webhook to a schedules row by Ayrshare's post id.

    Schedule v2 channel-mode rows store the id in
    `schedules.ayrshare_scheduled_post_id`. Legacy rows used `postiz_post_id`
    when the cron worker fired them — we accept either so a webhook for a
    post the legacy path created can still update the row.
    """
    ayrshare_id = (
        payload.get("id")
        or payload.get("postId")
        or payload.get("post_id")
    )
    if not isinstance(ayrshare_id, str) or not ayrshare_id:
        return None
    return (
        db.query(Schedule)
        .filter(
            or_(
                Schedule.ayrshare_scheduled_post_id == ayrshare_id,
                Schedule.postiz_post_id == ayrshare_id,
            )
        )
        .first()
    )


def _extract_live_url(payload: dict[str, Any], platform: str | None) -> str | None:
    """Pull the platform-specific live URL from Ayrshare's `postIds` array.
    Falls back to the first non-empty `postUrl` if no platform match."""
    post_ids = payload.get("postIds") or payload.get("post_ids") or []
    if not isinstance(post_ids, list):
        return None
    first_url: str | None = None
    for entry in post_ids:
        if not isinstance(entry, dict):
            continue
        url = entry.get("postUrl") or entry.get("post_url")
        if not isinstance(url, str) or not url:
            continue
        if platform and (entry.get("platform") or "").lower() == platform.lower():
            return url
        if first_url is None:
            first_url = url
    return first_url


def _extract_error(payload: dict[str, Any]) -> str:
    """Roll Ayrshare's per-platform errors into a single human string."""
    errs = payload.get("errors") or []
    if isinstance(errs, list) and errs:
        parts: list[str] = []
        for e in errs:
            if isinstance(e, dict):
                msg = e.get("message") or e.get("error") or "publish failed"
                plat = e.get("platform")
                parts.append(f"{plat}: {msg}" if plat else str(msg))
            elif isinstance(e, str):
                parts.append(e)
        if parts:
            return " · ".join(parts)
    msg = payload.get("message") or payload.get("error") or payload.get("status")
    return str(msg) if msg else "publish failed"


def _find_channel(db: Session, payload: dict[str, Any]) -> SocialChannel | None:
    """Match a channel.linked / channel.unlinked event to a SocialChannel
    row by Ayrshare profile key (preferred) or refId (fallback)."""
    profile_key = (
        payload.get("profileKey")
        or payload.get("profile_key")
        or payload.get("Profile-Key")
    )
    ref_id = payload.get("refId") or payload.get("ref_id")
    if isinstance(profile_key, str) and profile_key:
        row = db.query(SocialChannel).filter(SocialChannel.ayrshare_profile_key == profile_key).first()
        if row:
            return row
    if isinstance(ref_id, str) and ref_id:
        return db.query(SocialChannel).filter(SocialChannel.ayrshare_ref_id == ref_id).first()
    return None


@router.post("/ayrshare", status_code=status.HTTP_200_OK)
async def ayrshare_webhook(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    x_ayrshare_signature: Annotated[str | None, Header(alias="x-ayrshare-signature")] = None,
    x_hub_signature_256: Annotated[str | None, Header(alias="x-hub-signature-256")] = None,
) -> dict[str, str]:
    """Update a `schedules` row from an Ayrshare post-status webhook or a
    `social_channels` row from a channel link/unlink webhook.

    Side effects when status flips to `published`:
      - schedules.status = 'published'
      - schedules.actual_post_url = live url
      - schedules.post_url = live url (back-compat for legacy desktop reads)
      - schedules.error = NULL
      - one `post_published` notification for the user

    Side effects when status flips to `failed`:
      - schedules.status = 'failed'
      - schedules.error = aggregated message
      - one `post_failed` notification for the user

    Side effects on `channel.linked`:
      - social_channels.status = 'active'
      - social_channels.handle = payload handle (if provided)
      - social_channels.last_probe_at stamped

    Side effects on `channel.unlinked`:
      - social_channels.status = 'unlinked' (only if no newer probe)
        — ship-lens v0.7.8 P1: was 'pending_link', but that conflated
        "user never finished OAuth" with "platform revoked access".
      - social_channels.last_unlinked_at stamped (when the revoke happened)
      - social_channels.last_probe_at stamped (when we noticed)
    """
    t_start = time.monotonic()
    raw_body = await request.body()
    log.info("[ayrshare] arrival bytes=%d", len(raw_body))

    signature = x_ayrshare_signature or x_hub_signature_256
    if not _verify_signature(raw_body, signature):
        # _verify_signature already log.warning'd the reason.
        log.warning("[ayrshare] rejected: signature invalid (dur_ms=%d)",
                    int((time.monotonic() - t_start) * 1000))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "signature invalid")
    log.debug("[ayrshare] signature ok")

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"invalid json: {exc!s}") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "payload must be a JSON object")

    event_type = (payload.get("type") or "post").lower()

    # Idempotency — Ayrshare retries on non-2xx, so dedupe by external_id.
    # The WebhookEvent row is added BEFORE processing so a duplicate concurrent
    # delivery (rare, but possible) hits the unique-constraint and falls back
    # to the "deduped" path instead of double-processing.
    external_id = _idempotency_id(payload)
    if external_id:
        body_hash = hashlib.sha256(raw_body).hexdigest()
        existing = (
            db.query(WebhookEvent)
            .filter(WebhookEvent.external_id == f"ayrshare:{external_id}")
            .first()
        )
        if existing:
            log.info(
                "[ayrshare] dedup hit external_id=%s type=%s (dur_ms=%d)",
                external_id, event_type,
                int((time.monotonic() - t_start) * 1000),
            )
            return {"ok": "1", "deduped": "1"}
        evt = WebhookEvent(
            provider="ayrshare",
            external_id=f"ayrshare:{external_id}",
            event_type=event_type,
            body_hash=body_hash,
        )
        db.add(evt)
        try:
            db.flush()  # surface unique-constraint races NOW, not at the final commit
        except IntegrityError:
            db.rollback()
            log.info("[ayrshare] dedup hit (race) external_id=%s", external_id)
            return {"ok": "1", "deduped": "1"}
        log.debug("[ayrshare] dedup miss — processing external_id=%s", external_id)

    # --- channel link/unlink events --------------------------------------
    if event_type in ("channel.linked", "channel.unlinked", "channel.connected", "channel.disconnected"):
        channel = _find_channel(db, payload)
        if not channel:
            log.info("[ayrshare] no matching channel for event=%s", event_type)
            db.commit()
            return {"ok": "1", "ignored": "no_channel_match"}

        # Out-of-order guard: if last_probe_at is newer than the webhook's
        # apparent send time, this event is stale and must NOT overwrite
        # state. Ayrshare provides `timestamp` (ISO string) on some events.
        webhook_ts = _parse_event_timestamp(payload)
        if (
            webhook_ts
            and channel.last_probe_at
            and channel.last_probe_at > webhook_ts
        ):
            log.info(
                "[ayrshare] out-of-order channel event ignored "
                "channel=%s last_probe_at=%s webhook_ts=%s",
                channel.id, channel.last_probe_at.isoformat(), webhook_ts.isoformat(),
            )
            db.commit()
            return {"ok": "1", "ignored": "out_of_order"}

        now = datetime.now(timezone.utc)
        if event_type in ("channel.linked", "channel.connected"):
            channel.status = "active"
            handle = payload.get("handle") or payload.get("displayName")
            if isinstance(handle, str) and handle:
                channel.handle = handle
            channel.last_probe_at = now
            channel.last_probe_error = None
            log.info(
                "[ayrshare] channel linked id=%s platform=%s handle=%s (dur_ms=%d)",
                channel.id, channel.platform, channel.handle,
                int((time.monotonic() - t_start) * 1000),
            )
        else:  # channel.unlinked / channel.disconnected
            # ship-lens v0.7.8 P1 — "unlinked" instead of "pending_link" so
            # the UI can tell apart "never linked" from "TikTok revoked my
            # session". last_unlinked_at stamps the revoke moment (vs.
            # last_probe_at which ticks on every refresh).
            channel.status = "unlinked"
            channel.last_unlinked_at = now
            channel.last_probe_at = now
            log.info(
                "[ayrshare] channel unlinked id=%s platform=%s status=unlinked (dur_ms=%d)",
                channel.id, channel.platform,
                int((time.monotonic() - t_start) * 1000),
            )
        db.commit()
        return {"ok": "1", "channel_id": channel.id, "new_status": channel.status}

    # --- post-status events ----------------------------------------------
    if event_type not in ("post", "post.status", "post.published", "post.failed"):
        log.info("[ayrshare] ignoring event type: %s (dur_ms=%d)", event_type,
                 int((time.monotonic() - t_start) * 1000))
        db.commit()
        return {"ok": "1", "ignored": event_type}

    row = _find_schedule(db, payload)
    if not row:
        # Webhook fired for a post we didn't create (or a row we already
        # purged). Ack so Ayrshare doesn't keep retrying.
        log.info("[ayrshare] no matching schedule for id=%s", payload.get("id"))
        db.commit()
        return {"ok": "1", "ignored": "no_match"}

    status_str = (payload.get("status") or "").lower()
    is_success = status_str in ("success", "published", "ok") or event_type == "post.published"
    is_failure = status_str in ("error", "failed") or event_type == "post.failed"

    if is_success:
        live_url = _extract_live_url(payload, row.platform)
        row.status = "published"
        if live_url:
            row.actual_post_url = live_url
            row.post_url = live_url  # back-compat: legacy desktop reads post_url
        row.error = None
        write_notification(
            db,
            user_id=row.user_id,
            category="post_published",
            title=f"Published to {row.platform or 'social'}",
            body=f'"{row.clip_title}" went live'
            + (f" at {live_url}" if live_url else ""),
            priority="medium",
            external_dedup_key=f"ayrshare-published-{row.id}",
            action_kind="open_url" if live_url else "open_app",
            action_data={"url": live_url} if live_url else {},
        )
    elif is_failure:
        row.status = "failed"
        row.error = _extract_error(payload)
        write_notification(
            db,
            user_id=row.user_id,
            category="post_failed",
            title=f"Post failed on {row.platform or 'social'}",
            body=f'"{row.clip_title}" — {row.error}',
            priority="high",
            external_dedup_key=f"ayrshare-failed-{row.id}",
            action_kind="open_app",
            action_data={"surface": "schedule"},
        )
    else:
        log.info("[ayrshare] status not actionable for schedule=%s: %s (dur_ms=%d)",
                 row.id, status_str, int((time.monotonic() - t_start) * 1000))
        db.commit()
        return {"ok": "1", "ignored": "status_noop"}

    db.commit()
    log.info(
        "[ayrshare] processed schedule=%s new_status=%s (dur_ms=%d)",
        row.id, row.status, int((time.monotonic() - t_start) * 1000),
    )
    return {"ok": "1", "schedule_id": row.id, "new_status": row.status}


def _parse_event_timestamp(payload: dict[str, Any]) -> datetime | None:
    """Best-effort parse of the webhook send time. Ayrshare uses ISO 8601 on
    most events; fall back to None if absent or unparseable."""
    raw = (
        payload.get("timestamp")
        or payload.get("eventTime")
        or payload.get("event_time")
        or payload.get("created")
    )
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
