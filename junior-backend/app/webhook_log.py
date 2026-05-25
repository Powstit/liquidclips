"""Best-effort, non-blocking metadata logging for incoming webhooks.

Every signature-valid Clerk/Whop webhook gets one row in `webhook_event_log`
recording provider, event name, outcome status, any linked ids, and a short
SANITIZED error — never the raw payload, secrets, emails, or tokens.

`log_webhook` writes in its OWN short-lived session so a processing rollback or
a logging error can never affect webhook handling. All exceptions are swallowed.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from app.db import session_scope
from app.models import WebhookEventLog

log = logging.getLogger("junior.webhook_log")

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+")


def sanitize_error(err: object | None) -> str | None:
    """Short, single-line, email-redacted error string (or None)."""
    if err is None:
        return None
    s = f"{type(err).__name__}: {err}" if isinstance(err, BaseException) else str(err)
    s = _EMAIL_RE.sub("[email]", s)
    return " ".join(s.split())[:240] or None


def log_webhook(
    *,
    provider: str,
    event_name: str | None,
    status: str,  # received | handled | ignored | failed
    external_event_id: str | None = None,
    user_id: str | None = None,
    pending_whop_membership_id: str | None = None,
    claim_token_id: str | None = None,
    error: object | None = None,
    handled: bool = False,
) -> None:
    try:
        with session_scope() as db:
            db.add(
                WebhookEventLog(
                    provider=provider,
                    event_name=(event_name or "")[:120] or "unknown",
                    status=status,
                    external_event_id=(external_event_id or None),
                    user_id=user_id,
                    pending_whop_membership_id=pending_whop_membership_id,
                    claim_token_id=claim_token_id,
                    error=sanitize_error(error),
                    handled_at=datetime.now(timezone.utc) if handled else None,
                )
            )
    except Exception as exc:  # noqa: BLE001 — logging must never break processing
        log.warning("[webhook_log] write skipped (non-blocking): %s", exc)
