"""Internal queue-consumer endpoints · called by the Cloudflare edge Worker.

2026-07-08 · edge-first ingestion rollout. The Worker validates the shared
HQ secret / Whop HMAC at the edge, drops the payload in Cloudflare Queues,
and returns 202 to the caller in ~5ms. The Cloudflare Queue consumer
handler in the same Worker (`export default { queue }`) drains the queue
and POSTs each message to one of these two endpoints:

  * POST /internal/queues/cold-leads-prep   ← lc-cold-leads-prep queue
  * POST /internal/queues/whop-webhook       ← lc-whop-webhooks queue

Both endpoints are gated by ``require_internal_secret`` (shared header
`x-internal-secret` matching `INTERNAL_API_SECRET`). The Worker holds
that secret as `INTERNAL_QUEUE_SECRET` binding, set via
`wrangler secret put`.

Design rules (Codex mandate 2026-07-08, rules 3 + 6 + 8):
  * Consumer endpoints MUST be idempotent — Cloudflare Queues is
    at-least-once. Cold-leads dedupes on (email, campaign_id) via the
    existing ON CONFLICT DO UPDATE. Whop dedupes on
    ``WebhookEventLog.external_id`` via the existing
    ``_is_duplicate_event`` gate inside webhooks_whop.whop_webhook.
  * Whop consumer replays the original body+headers into the local
    ``/webhooks/whop`` endpoint via httpx so we inherit the dispatch
    table + tuple map + handler wiring exactly, with zero drift risk.
    HMAC re-validates cleanly since the Worker preserved the Standard
    Webhooks headers.
  * No user-facing behaviour. Response bodies are consumed only by the
    Worker's queue() loop, which acks on 2xx and retries on non-2xx.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_internal_secret

router = APIRouter(prefix="/internal/queues", tags=["internal-queues"])
log = logging.getLogger("junior.internal_queues")


# ─── cold-leads consumer ──────────────────────────────────────────────


class ColdLeadPayload(BaseModel):
    """Mirrors the fields that ``cold_leads.ColdLeadPrepIn`` accepts on
    the public write path. The consumer receives the same shape the
    Worker received from HQ — no re-shaping in transit."""

    email: EmailStr
    handle: str = Field(..., min_length=1, max_length=80)
    campaign_id: str = Field(..., min_length=1, max_length=80)
    preview_clip_url: str | None = Field(None, max_length=600)
    platform: str | None = Field(None, max_length=40)
    niche: str | None = Field(None, max_length=80)
    audience_size: int | None = Field(None, ge=0)
    # Ship-lens SF-P1-004 caps preserved.
    estimated_monthly_earnings_cents: int | None = Field(None, ge=0, le=5_000_000)
    estimated_opportunity_cents: int | None = Field(None, ge=0, le=5_000_000)
    earnings_low_cents: int | None = Field(None, ge=0, le=5_000_000)
    earnings_high_cents: int | None = Field(None, ge=0, le=5_000_000)
    absent_platforms: str | None = Field(None, max_length=200)
    handle_youtube: str | None = Field(None, max_length=80)
    handle_tiktok: str | None = Field(None, max_length=80)
    handle_twitter: str | None = Field(None, max_length=80)


class ColdLeadQueueMessage(BaseModel):
    """Envelope the Worker's queue() consumer POSTs to us."""

    kind: str  # always "cold_leads_prep" — Worker sets this explicitly
    idempotencyKey: str
    receivedAt: str
    payload: ColdLeadPayload


@router.post("/cold-leads-prep")
def consume_cold_lead_prep(
    body: ColdLeadQueueMessage,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> dict[str, Any]:
    """Persist a cold-lead upsert from the Worker's queue drain.

    Same INSERT ... ON CONFLICT SQL as ``cold_leads.prep_cold_lead`` —
    idempotent by (email, campaign_id). A duplicate queue message folds
    into a single upsert, so at-least-once delivery is safe."""
    if body.kind != "cold_leads_prep":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unexpected kind={body.kind!r}")

    p = body.payload
    try:
        db.execute(
            text(
                """
                INSERT INTO cold_leads
                    (email, handle, campaign_id, preview_clip_url, platform,
                     niche, audience_size,
                     estimated_monthly_earnings_cents,
                     estimated_opportunity_cents,
                     earnings_low_cents, earnings_high_cents,
                     absent_platforms,
                     handle_youtube, handle_tiktok, handle_twitter,
                     first_seen_at, last_seen_at)
                VALUES
                    (:email, :handle, :campaign, :preview, :platform,
                     :niche, :audience_size,
                     :est_earnings, :est_opportunity,
                     :low, :high,
                     :absent_platforms,
                     :h_yt, :h_tt, :h_tw,
                     now(), now())
                ON CONFLICT (email, campaign_id) DO UPDATE SET
                    handle = EXCLUDED.handle,
                    preview_clip_url = COALESCE(EXCLUDED.preview_clip_url, cold_leads.preview_clip_url),
                    platform = COALESCE(EXCLUDED.platform, cold_leads.platform),
                    niche = COALESCE(EXCLUDED.niche, cold_leads.niche),
                    audience_size = COALESCE(EXCLUDED.audience_size, cold_leads.audience_size),
                    estimated_monthly_earnings_cents = COALESCE(EXCLUDED.estimated_monthly_earnings_cents, cold_leads.estimated_monthly_earnings_cents),
                    estimated_opportunity_cents = COALESCE(EXCLUDED.estimated_opportunity_cents, cold_leads.estimated_opportunity_cents),
                    earnings_low_cents = COALESCE(EXCLUDED.earnings_low_cents, cold_leads.earnings_low_cents),
                    earnings_high_cents = COALESCE(EXCLUDED.earnings_high_cents, cold_leads.earnings_high_cents),
                    absent_platforms = COALESCE(EXCLUDED.absent_platforms, cold_leads.absent_platforms),
                    handle_youtube = COALESCE(EXCLUDED.handle_youtube, cold_leads.handle_youtube),
                    handle_tiktok = COALESCE(EXCLUDED.handle_tiktok, cold_leads.handle_tiktok),
                    handle_twitter = COALESCE(EXCLUDED.handle_twitter, cold_leads.handle_twitter),
                    last_seen_at = now()
                """
            ),
            {
                "email": p.email.lower().strip(),
                "handle": p.handle.strip(),
                "campaign": p.campaign_id.strip(),
                "preview": p.preview_clip_url,
                "platform": p.platform,
                "niche": p.niche,
                "audience_size": p.audience_size,
                "est_earnings": p.estimated_monthly_earnings_cents,
                "est_opportunity": p.estimated_opportunity_cents,
                "low": p.earnings_low_cents,
                "high": p.earnings_high_cents,
                "absent_platforms": p.absent_platforms,
                "h_yt": p.handle_youtube,
                "h_tt": p.handle_tiktok,
                "h_tw": p.handle_twitter,
            },
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning(
            "[internal.cold-leads] upsert failed idem=%s err=%s",
            body.idempotencyKey, exc,
        )
        # Return 5xx so the Worker retries (up to max_retries then DLQ).
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "cold-lead upsert failed",
        )

    log.info(
        "[internal.cold-leads] persisted idem=%s campaign=%s received_at=%s",
        body.idempotencyKey, p.campaign_id, body.receivedAt,
    )
    return {
        "ok": True,
        "idempotencyKey": body.idempotencyKey,
        "persisted_at": datetime.now(timezone.utc).isoformat(),
    }


# ─── Whop webhook consumer ────────────────────────────────────────────


class WhopWebhookQueueMessage(BaseModel):
    """Envelope the Worker's queue() consumer POSTs to us. Carries the
    raw body + Standard-Webhooks headers so the existing
    ``webhooks_whop.whop_webhook`` handler can reprocess with zero
    behavioural drift."""

    kind: str  # always "whop_webhook"
    eventId: str
    receivedAt: str
    rawBody: str
    headers: dict[str, str]


@router.post("/whop-webhook")
async def consume_whop_webhook(
    body: WhopWebhookQueueMessage,
    request: Request,
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> dict[str, Any]:
    """Replay a Whop webhook event into the existing ``/webhooks/whop``
    endpoint on the same backend.

    Why this shape: the ``webhooks_whop.whop_webhook`` function keeps
    its event-type tuples + dispatch switch inside the function body
    (webhooks_whop.py:397-449), so they can't be re-imported cleanly.
    Rather than mirror the dispatch table here (drift risk on every
    new event type), we re-POST the exact bytes + Standard-Webhooks
    headers that the Worker captured. HMAC re-validates because the
    Worker preserved every signature header. Idempotency is enforced
    by the destination handler's ``_is_duplicate_event`` gate.

    The extra hop is ~2-5ms local + one DB row for the event log —
    negligible next to the batch drain rate."""
    if body.kind != "whop_webhook":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unexpected kind={body.kind!r}")

    # Build the origin URL from the current request. Works locally
    # (uvicorn on :8000) and in production (Railway) without hardcoding.
    origin = f"{request.url.scheme}://{request.url.netloc}"
    forward_url = f"{origin}/webhooks/whop"

    # Preserve every Standard Webhooks header the origin verifier needs.
    forward_headers = {
        "content-type": "application/json",
        **{k: v for k, v in body.headers.items() if k.lower() in {
            "webhook-id", "webhook-timestamp", "webhook-signature",
        }},
        "x-lc-internal-queue-replay": "1",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            forwarded = await client.post(
                forward_url,
                headers=forward_headers,
                content=body.rawBody.encode("utf-8"),
            )
    except httpx.RequestError as exc:
        log.warning(
            "[internal.whop-webhook] forward failed external_id=%s err=%s",
            body.eventId, exc,
        )
        # 5xx → Worker retries per queue config; DLQ after max_retries.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "whop webhook replay failed",
        )

    if forwarded.status_code >= 500:
        log.warning(
            "[internal.whop-webhook] destination 5xx external_id=%s status=%s",
            body.eventId, forwarded.status_code,
        )
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"destination_returned_{forwarded.status_code}",
        )

    # Even 4xx (invalid signature after a Worker-side false positive, or
    # duplicate delivered twice) is treated as terminal — the Worker
    # should ack because retrying doesn't help. We log for observability.
    if forwarded.status_code >= 400:
        log.info(
            "[internal.whop-webhook] destination 4xx (terminal, no retry) "
            "external_id=%s status=%s",
            body.eventId, forwarded.status_code,
        )

    log.info(
        "[internal.whop-webhook] replayed external_id=%s status=%s",
        body.eventId, forwarded.status_code,
    )
    return {
        "ok": True,
        "external_id": body.eventId,
        "destination_status": forwarded.status_code,
    }
