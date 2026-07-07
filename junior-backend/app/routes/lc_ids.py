"""LC-ID (Liquid Clips public sign-in ID) — mint + welcome-email routes.

Sprint 2026-07-06 · mandatory-LoginScreen flow. When the Whop membership
webhook fires (or the QA test plan settles), the buyer needs a friendly
public identifier they can paste back into the desktop's "Have a discount
code?" recovery input as a manual fallback to the ``liquidclips://activate``
deep link.

Format:  ``LC-`` + 6 uppercase base32 chars (crockford-ish alphabet with
0/O/I/L/1/U stripped so no ambiguous glyphs). 26^6 ≈ 30M combos before we
have to widen the field · a UNIQUE index catches the birthday-paradox
collision + we retry with a fresh 6-char sample.

Both endpoints are internal-secret gated. The webhook path (see
``webhooks_whop.apply_membership_tier`` follow-up call) is the only real
caller · a smoke curl from the ops laptop is the other permitted use.
Idempotence: mint returns the existing ``users.lc_id`` when already set.
Welcome-email always re-sends when explicitly asked (Daniel's spec: "DO
re-send the welcome email if requested").
"""

from __future__ import annotations

import hmac as _hmac
import logging
import secrets as _secrets
import time as _time
from collections import deque
from html import escape as _escape_html
from threading import Lock
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_internal_secret
from app.jwt_signer import issue_license_jwt
from app.models import User

log = logging.getLogger("junior.lc_ids")

router = APIRouter(prefix="/lc-ids", tags=["lc-ids"])

# Crockford-ish base32 alphabet with 0/O/I/L/1/U removed. 26 letters + 4
# digits = 30 glyphs. 30^6 ≈ 729M — plenty. All uppercase so a user typing
# an LC-ID off an email never worries about case.
_LC_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
_LC_ID_LENGTH = 6
_LC_ID_PREFIX = "LC-"
_LC_ID_MAX_MINT_RETRIES = 8

# ─── redeem rate limit ─────────────────────────────────────────────────────
#
# 2026-07-07 · ship-lens P1-001 fix. Redeem is a PUBLIC endpoint (unlike
# mint-for-user, which is internal-secret gated). Without a rate limit an
# attacker could brute-force LC-IDs (7.3e8 combos) at ~10k/sec to lift
# real users' license JWTs. Per-IP deque with a tight 5 attempts per 5
# minutes bound — legit users paste from an email exactly once so this
# bites only automated grinders. In-memory is safe because Railway
# pins numReplicas=1 (see railway.json).

_REDEEM_RATE_LIMIT_WINDOW_SECONDS = 5 * 60
_REDEEM_RATE_LIMIT_MAX_HITS = 5
_redeem_rate_hits: dict[str, deque[float]] = {}
_redeem_rate_lock = Lock()


def _redeem_client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    return request.client.host if request.client else "unknown"


def _redeem_rate_limit(ip: str) -> bool:
    now = _time.monotonic()
    cutoff = now - _REDEEM_RATE_LIMIT_WINDOW_SECONDS
    with _redeem_rate_lock:
        dq = _redeem_rate_hits.setdefault(ip, deque())
        while dq and dq[0] < cutoff:
            dq.popleft()
        if len(dq) >= _REDEEM_RATE_LIMIT_MAX_HITS:
            return False
        dq.append(now)
        return True


def _random_lc_id() -> str:
    body = "".join(_secrets.choice(_LC_ID_ALPHABET) for _ in range(_LC_ID_LENGTH))
    return f"{_LC_ID_PREFIX}{body}"


# ─── mint ──────────────────────────────────────────────────────────────────


class MintForUserRequest(BaseModel):
    user_id: str


class MintForUserResponse(BaseModel):
    lc_id: str
    reused: bool


@router.post("/mint-for-user", response_model=MintForUserResponse)
def mint_for_user(
    body: MintForUserRequest,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> MintForUserResponse:
    """Mint (or return) a public LC-ID for a user.

    Idempotent — if ``users.lc_id`` is already populated, we return it
    unchanged so a webhook retry doesn't rotate the ID. Otherwise we
    generate a fresh 6-char base32 body and retry up to 8 times on
    collision (the UNIQUE index catches races between processes).
    """
    user = db.get(User, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    existing = getattr(user, "lc_id", None)
    if existing:
        return MintForUserResponse(lc_id=existing, reused=True)

    last_err: Exception | None = None
    for _ in range(_LC_ID_MAX_MINT_RETRIES):
        candidate = _random_lc_id()
        try:
            user.lc_id = candidate  # type: ignore[attr-defined]
            db.flush()
            db.commit()
            log.info("[lc-ids] minted %s for user=%s", candidate, user.id)
            return MintForUserResponse(lc_id=candidate, reused=False)
        except Exception as exc:  # noqa: BLE001 — retry on any DB error
            last_err = exc
            db.rollback()
            # Fresh read — another process may have written concurrently.
            db.refresh(user)
            existing = getattr(user, "lc_id", None)
            if existing:
                return MintForUserResponse(lc_id=existing, reused=True)

    log.error("[lc-ids] mint failed after %d retries user=%s err=%s",
              _LC_ID_MAX_MINT_RETRIES, user.id, last_err)
    raise HTTPException(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "lc-id mint failed after retries",
    )


# ─── redeem ────────────────────────────────────────────────────────────────


class RedeemRequest(BaseModel):
    lc_id: str
    email: str


class RedeemResponse(BaseModel):
    license_jwt: str


@router.post("/redeem", response_model=RedeemResponse)
def redeem(
    body: RedeemRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> RedeemResponse:
    """Redeem an LC-ID + email pair for a license JWT.

    Public endpoint — the client sends this straight from the welcome
    screen's "Have a discount code?" paste form. Both fields are
    required and both must match a real user row. The email requirement
    lifts brute-force cost from ~7.3e8 (LC-ID alone) to effectively
    unbounded (email is not enumerable from the LC-ID).

    2026-07-07 · added to close sprint-final ship-lens P0-001. Prior to
    this endpoint the frontend `WelcomeRoute` POST'd here and hit a
    plain 404, silently locking out anyone who tried to sign in via the
    LC-ID email. Playwright specs mocked the route and missed the gap.
    """
    ip = _redeem_client_ip(request)
    if not _redeem_rate_limit(ip):
        log.warning("[lc-ids] redeem rate-limited ip=%s", ip)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too many attempts · try again in a few minutes",
        )

    lc_id_clean = (body.lc_id or "").strip().upper()
    email_clean = (body.email or "").strip().lower()

    if not lc_id_clean.startswith(_LC_ID_PREFIX):
        log.info("[lc-ids] redeem rejected · malformed lc_id ip=%s", ip)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "lc_id malformed")
    if "@" not in email_clean:
        log.info("[lc-ids] redeem rejected · malformed email ip=%s", ip)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "email malformed")

    # Look up by LC-ID first. `.lc_id` has a UNIQUE index at the schema
    # level (mint retries on collision), so this is a single-row query.
    user = db.query(User).filter(User.lc_id == lc_id_clean).first()

    # Time-safe email compare AND fail-closed on missing user. We never
    # tell the client which side of (lc_id, email) mismatched — a single
    # generic 404 defeats enumeration of valid LC-IDs.
    email_ok = (
        user is not None
        and _hmac.compare_digest(
            (user.email or "").strip().lower(),
            email_clean,
        )
    )
    if not (user and email_ok):
        log.info(
            "[lc-ids] redeem miss ip=%s lc_id=%s user_found=%s",
            ip, lc_id_clean, user is not None,
        )
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "code and email don't match a known account",
        )

    jwt_str, expires_at = issue_license_jwt(
        user_id=user.id,
        tier=user.tier,
        founder=bool(getattr(user, "founder_flag", False)),
        platform_role=getattr(user, "platform_role", None) or "none",
    )
    log.info(
        "[lc-ids] redeem ok ip=%s user=%s tier=%s exp=%s",
        ip, user.id, user.tier, expires_at.isoformat(),
    )
    return RedeemResponse(license_jwt=jwt_str)


# ─── welcome email ─────────────────────────────────────────────────────────


class SendWelcomeEmailRequest(BaseModel):
    user_id: str
    lc_id: str
    whop_receipt_id: str | None = None


class SendWelcomeEmailResponse(BaseModel):
    queued: bool
    to: str


@router.post("/send-welcome-email", response_model=SendWelcomeEmailResponse)
def send_welcome_email(
    body: SendWelcomeEmailRequest,
    db: Annotated[Session, Depends(get_db)],
    _internal: Annotated[bool, Depends(require_internal_secret)] = True,
) -> SendWelcomeEmailResponse:
    """Send the "Your Liquid Clips ID · sign in with this" email via Resend.

    Uses the existing ``app.mailer._send`` helper so we inherit the
    fire-and-forget threading + Resend API-key handling + graceful
    "no key configured, skip" behaviour. The template is inlined here
    because it's a one-off — the recovery-input paste flow, the
    ``liquidclips://activate`` deep link, and the mono-font LC-ID block
    are all specific to this transactional path.
    """
    user = db.get(User, body.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    lc_id_clean = (body.lc_id or "").strip().upper()
    if not lc_id_clean.startswith(_LC_ID_PREFIX):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "lc_id malformed")

    settings = get_settings()
    # Prefer LC_MAIL_FROM env when set, else Resend default. Keeps the ops
    # rotation story clean — Daniel can flip the sender for this one
    # transactional email without touching every other template.
    from_addr = (
        getattr(settings, "lc_mail_from", None)
        or settings.resend_from
        or "Liquid Clips <noreply@liquidclips.app>"
    )

    subject = "Your Liquid Clips ID · sign in with this"
    activate_url = f"liquidclips://activate?lc_id={lc_id_clean}"
    html_body = _render_welcome_html(
        lc_id=lc_id_clean,
        activate_url=activate_url,
        whop_receipt_id=body.whop_receipt_id,
    )
    text_body = _render_welcome_text(
        lc_id=lc_id_clean,
        activate_url=activate_url,
        whop_receipt_id=body.whop_receipt_id,
    )

    from app.mailer import _async, _send  # reuse existing infra
    _async(
        _send,
        to=user.email,
        subject=subject,
        html=html_body,
        text=text_body,
        tag="lc_id_welcome",
    )
    log.info(
        "[lc-ids] welcome email queued to=%s lc_id=%s receipt=%s from=%s",
        user.email, lc_id_clean, body.whop_receipt_id, from_addr,
    )
    return SendWelcomeEmailResponse(queued=True, to=user.email)


def _render_welcome_html(*, lc_id: str, activate_url: str, whop_receipt_id: str | None) -> str:
    receipt_line = ""
    if whop_receipt_id:
        receipt_line = (
            f'<p style="margin:6px 0 0;font-family:ui-monospace,\'Geist Mono\',monospace;'
            f'font-size:11px;color:#7A7069;letter-spacing:0.08em;text-transform:uppercase;">'
            f'Whop receipt · {_escape_html(whop_receipt_id)}</p>'
        )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#0b0b16;color:#f4f1ea;font-family:-apple-system,BlinkMacSystemFont,'Geist',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b16;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
        style="max-width:560px;background:#140612;border-radius:16px;border:1px solid rgba(255,26,140,0.24);padding:32px;">
        <tr><td>
          <p style="margin:0 0 6px;font-family:ui-monospace,'Geist Mono',monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#ff66b8;">
            Liquid Clips
          </p>
          <h1 style="margin:0 0 12px;font-size:28px;font-weight:700;letter-spacing:-0.02em;color:#f4f1ea;line-height:1.15;">
            You're in. Here's your sign-in ID.
          </h1>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#c8c4be;">
            Your card's on file with Whop · $0 charged unless you upgrade. To open
            Liquid Clips on this Mac, tap the button below and I'll unlock the app
            for you.
          </p>

          <div style="margin:0 0 24px;padding:20px;border-radius:12px;background:#0b0b16;border:1px solid rgba(255,26,140,0.36);text-align:center;">
            <p style="margin:0 0 6px;font-family:ui-monospace,'Geist Mono',monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#86837e;">
              Your Liquid Clips ID
            </p>
            <p style="margin:0;font-family:ui-monospace,'SF Mono','Geist Mono',monospace;font-size:28px;font-weight:700;letter-spacing:0.24em;color:#ff66b8;">
              {_escape_html(lc_id)}
            </p>
          </div>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px;">
            <tr><td>
              <a href="{_escape_html(activate_url)}"
                style="display:inline-block;padding:14px 26px;border-radius:12px;background:linear-gradient(180deg,#ff1a8c,#d40d70);color:#ffffff;font-weight:700;text-decoration:none;font-size:15px;letter-spacing:0.02em;box-shadow:0 10px 22px rgba(255,26,140,0.35);">
                Open Liquid Clips
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#c8c4be;">
            Button didn't work? Open the Liquid Clips app, tap
            <strong style="color:#f4f1ea;">Have a discount code?</strong>
            at the bottom of the sign-in screen, and paste the ID above. Same result — you're signed in.
          </p>
          {receipt_line}

          <hr style="border:0;border-top:1px solid rgba(255,255,255,0.06);margin:28px 0 18px;" />
          <p style="margin:0;font-family:ui-monospace,'Geist Mono',monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#6a6560;">
            Liquid Clips · powered by Whop · noreply email
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _render_welcome_text(*, lc_id: str, activate_url: str, whop_receipt_id: str | None) -> str:
    lines = [
        "Liquid Clips — you're in.",
        "",
        f"Your sign-in ID: {lc_id}",
        "",
        "Tap this link on the Mac you installed Liquid Clips on:",
        activate_url,
        "",
        "Or open the app, tap 'Have a discount code?' at the bottom of the",
        "sign-in screen, and paste the ID above. Same result — you're in.",
        "",
        "Card's on file with Whop · $0 charged unless you upgrade.",
    ]
    if whop_receipt_id:
        lines += ["", f"Whop receipt: {whop_receipt_id}"]
    lines += ["", "— Liquid Clips"]
    return "\n".join(lines)
