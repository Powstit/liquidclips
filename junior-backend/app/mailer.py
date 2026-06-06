"""Transactional onboarding email — Resend integration + branded templates.

Sends are non-blocking by default (`send_async` schedules into a thread) and
swallow Resend errors so a flaky email never breaks a webhook handler. The
log records the failure for later reconciliation.

Brand: paper (#FAF7F2) background, ink (#0A0A0F) text, fuchsia (#FF1A8C)
accent, Geist sans body + Fraunces serif headlines. The fuchsia `/` glyph
appears as the brand mark at the top of every email. No emoji.

To add a new transactional email:
  1. Write a render_<name>(ctx) function that returns (subject, html, text)
  2. Add a sender helper e.g. send_welcome(user) that calls _send(...)
  3. Call the sender from the relevant webhook handler

Templates are hand-rolled HTML strings (no template engine dep). Email
clients are deeply weird; inline styles are mandatory; <div>-based layout
is more reliable than tables for modern clients but we still use tables
for the outer wrapper because Gmail clips at 102 KB and aggressive
inline-CSS minimizers break with deeply nested wrappers.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any

from app.config import get_settings

log = logging.getLogger("junior.mailer")


@dataclass(frozen=True)
class MailContext:
    """Variables every template needs. Built once per send."""
    site_url: str
    account_url: str
    download_url: str
    reply_to: str
    # v0.6.11 — Whop community / chat hub. Used by the welcome email's
    # "Join the community" callout and any future affiliate-onboarding mail.
    whop_manage_url: str = ""

    @classmethod
    def build(cls) -> "MailContext":
        s = get_settings()
        return cls(
            site_url=s.public_site_url,
            account_url=s.account_site_url,
            download_url=s.app_download_url,
            reply_to=s.resend_reply_to,
            whop_manage_url=getattr(s, "whop_manage_url", "") or "",
        )


# --- low-level send ------------------------------------------------------

def _send(
    *,
    to: str,
    subject: str,
    html: str,
    text: str,
    tag: str,
) -> None:
    """Synchronous Resend send. Caller wraps in `_async()` for fire-and-forget.

    v0.6.11 — Attaches the Kade glyph as a CID inline part (`cid:kade-glyph`)
    so the brand mark renders in iOS Gmail (which silently drops data:image/png
    URIs). The HTML templates reference the CID; if the attachment file is
    missing we still send the email — the alien just won't render."""
    settings = get_settings()
    if not settings.resend_api_key:
        log.info("[mailer] RESEND_API_KEY not configured — skipping send to=%s tag=%s", to, tag)
        return
    payload: dict[str, Any] = {
        "from": settings.resend_from,
        "to": [to],
        "reply_to": [settings.resend_reply_to],
        "subject": subject,
        "html": html,
        "text": text,
        "tags": [{"name": "category", "value": tag}],
    }
    glyph_attachment = _kade_glyph_attachment()
    if glyph_attachment is not None:
        payload["attachments"] = [glyph_attachment]
    try:
        import resend
        resend.api_key = settings.resend_api_key
        resend.Emails.send(payload)
        log.info("[mailer] sent tag=%s to=%s", tag, to)
    except Exception as e:  # noqa: BLE001
        log.warning("[mailer] send failed tag=%s to=%s err=%s", tag, to, e)


def _kade_glyph_attachment() -> dict[str, Any] | None:
    """Reads the bundled Kade alien PNG and returns a Resend inline attachment
    dict (`content_id="kade-glyph"`). Returns None on any failure so the send
    path stays resilient — emails ship regardless of whether the mark renders."""
    try:
        from pathlib import Path
        import base64
        glyph_path = Path(__file__).resolve().parent / "assets" / "kade-glyph-64.png"
        if not glyph_path.is_file():
            return None
        return {
            "filename": "kade-glyph.png",
            "content": base64.b64encode(glyph_path.read_bytes()).decode("ascii"),
            "content_id": "kade-glyph",
            "content_type": "image/png",
            "disposition": "inline",
        }
    except Exception:  # noqa: BLE001
        return None


def _async(fn, *args, **kwargs) -> None:
    """Fire-and-forget. Resend can take ~300ms-1s; we don't make webhooks wait."""
    threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True).start()


# --- public senders ------------------------------------------------------

def send_welcome(email: str, *, first_name: str | None = None) -> None:
    """Sent on Clerk user.created webhook. Lands instantly after signup."""
    ctx = MailContext.build()
    subject, html, text = render_welcome(email=email, first_name=first_name, ctx=ctx)
    _async(_send, to=email, subject=subject, html=html, text=text, tag="welcome")


def send_subscription_activated(email: str, *, tier: str, first_name: str | None = None, trial: bool = False) -> None:
    """Sent when Whop webhook confirms a membership. trial=True for the starter
    pass (30-day Solo trial, 100 free exports); trial=False for a confirmed paid plan."""
    ctx = MailContext.build()
    subject, html, text = render_subscription_activated(email=email, tier=tier, first_name=first_name, ctx=ctx, trial=trial)
    _async(_send, to=email, subject=subject, html=html, text=text, tag="subscription_activated")


def send_subscription_canceled(email: str, *, paid_until_iso: str | None = None, first_name: str | None = None) -> None:
    """Sent when Whop webhook confirms a cancellation. paid_until_iso shows
    the user when their access actually ends."""
    ctx = MailContext.build()
    subject, html, text = render_subscription_canceled(
        email=email, paid_until_iso=paid_until_iso, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="subscription_canceled")


def send_founder_welcome(email: str, *, first_name: str | None = None) -> None:
    """Founder Lifetime — special $500 one-time tier. Different welcome copy
    (community access, lifetime guarantees, founder slack channel)."""
    ctx = MailContext.build()
    subject, html, text = render_founder_welcome(email=email, first_name=first_name, ctx=ctx)
    _async(_send, to=email, subject=subject, html=html, text=text, tag="founder_welcome")


def send_license_activated(email: str, *, machine_label: str | None = None, first_name: str | None = None) -> None:
    """Sent first time a desktop binary calls /desktop/connect for a user.
    A privacy/security signal more than a marketing one — 'we noticed Liquid Clips
    started on Mac Air, was that you?'"""
    ctx = MailContext.build()
    subject, html, text = render_license_activated(
        email=email, machine_label=machine_label, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="license_activated")


def send_bounty_approved(email: str, *, bounty_title: str, payout: str, first_name: str | None = None) -> None:
    """Sent when a Whop bounty submission flips to status=approved. The
    one email a clipper actively waits for — congratulatory tone, payout
    confirmation, link to their Whop payout history."""
    ctx = MailContext.build()
    subject, html, text = render_bounty_approved(
        email=email, bounty_title=bounty_title, payout=payout, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="bounty_approved")


def send_bounty_rejected(email: str, *, bounty_title: str, reason: str, first_name: str | None = None) -> None:
    """Sent when a Content Reward submission is rejected by a mod (not the
    automatic watermark gate — that has its own send_mc_watermark_rejected).
    Reason text is the mod's rejection_reason verbatim; no "auto" wrapping."""
    ctx = MailContext.build()
    subject, html, text = render_bounty_rejected(
        email=email, bounty_title=bounty_title, reason=reason, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="bounty_rejected")


def send_affiliate_qualified(email: str, *, first_name: str | None = None) -> None:
    """Sent ONCE to a Liquid Clips affiliate the first time they cross the 2-paid-
    referrals qualification threshold. Caller deduplicates via Notification's
    `external_dedup_key` so a webhook retry can't re-send it. Never fired by
    a dashboard read — the trigger lives in the paid-conversion webhook."""
    ctx = MailContext.build()
    subject, html, text = render_affiliate_qualified(email=email, first_name=first_name, ctx=ctx)
    _async(_send, to=email, subject=subject, html=html, text=text, tag="affiliate_qualified")


def send_first_paid_referral(email: str, *, first_name: str | None = None) -> None:
    """Sent ONCE to a Liquid Clips affiliate the first time one of their referrals
    converts to a paid plan. Dedupe lives on the caller side (Notification
    row with a per-affiliate dedup_key). Deliberately carries NO PII about
    the buyer — just the affiliate's own count."""
    ctx = MailContext.build()
    subject, html, text = render_first_paid_referral(email=email, first_name=first_name, ctx=ctx)
    _async(_send, to=email, subject=subject, html=html, text=text, tag="first_paid_referral")


def send_whop_claim_link(email: str, *, claim_url: str, first_name: str | None = None) -> None:
    """Self-serve 'I paid on Whop with a different email' claim. Sent ONLY to the
    Whop purchase email the user entered, and only when a matching pending
    membership exists — controlling this inbox is half the ownership proof."""
    ctx = MailContext.build()
    subject, html, text = render_whop_claim(email=email, claim_url=claim_url, first_name=first_name, ctx=ctx)
    _async(_send, to=email, subject=subject, html=html, text=text, tag="whop_claim")


def send_schedule_failed(
    email: str,
    *,
    channel_label: str,
    error_summary: str,
    first_name: str | None = None,
) -> None:
    """Sent when a scheduled Ayrshare post flips to status='failed' in the
    cron reconciler. Idempotency lives on the caller side: a Notification row
    with dedup_key `sched-failed-<schedule_id>` is written first; this sender
    is only fired when the insert sticks (i.e. first time we see this row in
    a failed state). The cron's 3-retry policy lives upstream — by the time
    this email fires, we've already exhausted retries."""
    ctx = MailContext.build()
    subject, html, text = render_schedule_failed(
        email=email, channel_label=channel_label, error_summary=error_summary,
        first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="schedule_failed")


def send_channel_disconnected(
    email: str,
    *,
    channel_label: str,
    platform: str,
    first_name: str | None = None,
) -> None:
    """Sent when the channel-status refresh cron detects a channel transitioning
    from active → error (Ayrshare auth expired / user revoked the platform
    OAuth). Idempotency: caller writes a Notification with dedup_key
    `channel-disconnected-<channel_id>-<yyyy-mm-dd>` so we mail at most once
    per channel per UTC day even if the cron flaps. Don't re-email a user
    every 6h for the same broken channel."""
    ctx = MailContext.build()
    subject, html, text = render_channel_disconnected(
        email=email, channel_label=channel_label, platform=platform,
        first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="channel_disconnected")


def send_trial_ending_soon(
    email: str,
    *,
    days_left: int,
    tier: str,
    first_name: str | None = None,
) -> None:
    """Sent ~3 days before a Whop starter-pass trial flips to paid. Idempotency:
    caller writes a Notification with dedup_key `trial-ending-<user_id>-<days>`
    so each (user, days-bucket) sends at most once. The cron is currently
    SCAFFOLDED but DISABLED — Whop's renewal_period_end is the source of truth
    and the firing logic gates on a feature flag until the trial UI lands."""
    ctx = MailContext.build()
    subject, html, text = render_trial_ending_soon(
        email=email, days_left=days_left, tier=tier, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="trial_ending_soon")


def send_affiliate_payout_enabled(
    email: str,
    *,
    first_name: str | None = None,
) -> None:
    """Sent when Stripe Connect flips a user's account to payouts_enabled=true
    (KYC cleared, bank verified, no outstanding requirements). Idempotency:
    caller writes a Notification with dedup_key
    `stripe-payouts-enabled-<user_id>` so account.updated webhook spam can't
    re-mail. The transition is monotonic in practice — once enabled, Stripe
    rarely undoes it without a manual review."""
    ctx = MailContext.build()
    subject, html, text = render_affiliate_payout_enabled(
        email=email, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="affiliate_payout_enabled")


def send_payout_kyc_required(
    email: str,
    *,
    first_name: str | None = None,
) -> None:
    """Sent when Stripe Connect flips a user's account to status='restricted'
    with `requirements.currently_due` non-empty (extra docs requested mid-flow).
    Idempotency: caller writes a Notification with dedup_key
    `stripe-kyc-required-<user_id>-<yyyy-mm-dd>` so we nudge at most once per
    UTC day even if Stripe webhooks the same restricted state every minute."""
    ctx = MailContext.build()
    subject, html, text = render_payout_kyc_required(
        email=email, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="payout_kyc_required")


def send_account_pack_added(
    email: str,
    *,
    extra_accounts: int,
    first_name: str | None = None,
) -> None:
    """Sent when a user adds an Account Pack add-on (one extra social channel
    per unit). SCAFFOLDED — Clerk Billing's add-on webhook event shape isn't
    finalised in this codebase yet (subscriptionItem.updated currently only
    carries the tier plan, not the add-on quantity), so this sender exists
    so the wiring is ready the moment we plumb add-on parsing through
    webhooks_clerk._handle_subscription_active. Idempotency will live on
    the caller side via a dedup_key `pack-added-<user_id>-<new_total>`."""
    ctx = MailContext.build()
    subject, html, text = render_account_pack_added(
        email=email, extra_accounts=extra_accounts, first_name=first_name, ctx=ctx,
    )
    _async(_send, to=email, subject=subject, html=html, text=text, tag="account_pack_added")


# --- internal admin alerts ---------------------------------------------
# These don't go to customers — they go to Daniel (and any other addresses
# in settings.admin_emails). One alert per paid event so the inbox tells
# the launch story in real time.

def send_admin_paid_customer_alert(
    *,
    customer_email: str,
    tier: str,
    source: str,
    monthly_usd: str | None = None,
    note: str | None = None,
) -> None:
    """Fan out a 'new paid customer' alert to every admin email.

    `source` is short-form: "whop_subscription_active", "whop_payment_succeeded",
    "founder_unlock", "clerk_subscription_active", etc. `monthly_usd` is the
    plan price as a presentable string ("$29.99/mo") if known. `note` lets the
    caller add anything specific (e.g. "trialing", "first paid invoice").
    """
    s = get_settings()
    if not s.admin_emails:
        return
    recipients = [e.strip() for e in s.admin_emails.split(",") if e.strip()]
    if not recipients:
        return
    subject, html, text = render_admin_paid_customer_alert(
        customer_email=customer_email,
        tier=tier,
        source=source,
        monthly_usd=monthly_usd,
        note=note,
    )
    for addr in recipients:
        _async(_send, to=addr, subject=subject, html=html, text=text, tag="admin_paid_customer")


def _admin_recipients() -> list[str]:
    s = get_settings()
    if not s.admin_emails:
        return []
    return [e.strip() for e in s.admin_emails.split(",") if e.strip()]


def send_admin_affiliate_milestone(
    *,
    affiliate_email: str,
    milestone: str,
    note: str | None = None,
) -> None:
    """Fan out an affiliate-milestone alert to every admin email.

    `milestone` is short-form: "first_paid_referral" or "qualified_50_percent".
    Caller is responsible for idempotency — this is invoked from inside the
    same dedup-keyed Notification branch that already gates the user-facing
    email, so it can't fire twice for the same milestone."""
    recipients = _admin_recipients()
    if not recipients:
        return
    subject, html, text = render_admin_affiliate_milestone(
        affiliate_email=affiliate_email, milestone=milestone, note=note,
    )
    for addr in recipients:
        _async(_send, to=addr, subject=subject, html=html, text=text, tag="admin_affiliate_milestone")


def send_admin_big_payout(
    *,
    customer_email: str,
    bounty_title: str,
    payout: str,
    note: str | None = None,
) -> None:
    """Fan out a 'big Content Reward payout' alert to every admin email.

    Caller decides the threshold — only fire this when payout dollar value
    crosses an admin-attention bar. The bounty acceptance email to the user
    already always sends; this is the additional internal ping. Idempotency:
    caller fires this inside the same status-transition branch that mails
    the clipper, so it can't double-fire."""
    recipients = _admin_recipients()
    if not recipients:
        return
    subject, html, text = render_admin_big_payout(
        customer_email=customer_email, bounty_title=bounty_title, payout=payout, note=note,
    )
    for addr in recipients:
        _async(_send, to=addr, subject=subject, html=html, text=text, tag="admin_big_payout")


def send_admin_kyc_alert(
    *,
    customer_email: str,
    stripe_status: str,
    requirements_due: list[str] | None = None,
    note: str | None = None,
) -> None:
    """Fan out a 'Stripe Connect KYC stalled' alert to every admin email.

    Triggered from the Stripe Connect webhook when status flips to 'restricted'
    with currently_due requirements outstanding. Caller dedupes on
    Notification(`admin-kyc-<user_id>-<yyyy-mm-dd>`) so we nudge at most once
    per UTC day per affected user."""
    recipients = _admin_recipients()
    if not recipients:
        return
    subject, html, text = render_admin_kyc_alert(
        customer_email=customer_email,
        stripe_status=stripe_status,
        requirements_due=requirements_due,
        note=note,
    )
    for addr in recipients:
        _async(_send, to=addr, subject=subject, html=html, text=text, tag="admin_kyc_alert")


def render_admin_paid_customer_alert(
    *,
    customer_email: str,
    tier: str,
    source: str,
    monthly_usd: str | None,
    note: str | None,
) -> tuple[str, str, str]:
    subject = f"💸  New paid customer — {tier.capitalize()} via {source}"
    pretty_source = {
        "whop_subscription_active": "Whop subscription active",
        "whop_payment_succeeded": "Whop payment succeeded",
        "clerk_subscription_active": "Clerk Billing subscription active",
        "founder_unlock": "Founder £1 commit",
    }.get(source, source)
    extras = []
    if monthly_usd:
        extras.append(f"<strong>Plan:</strong> {monthly_usd}")
    if note:
        extras.append(f"<strong>Note:</strong> {note}")
    extras_block = "<br>".join(extras)
    extras_block_text = "\n".join(line.replace("<strong>", "").replace("</strong>", "") for line in extras)

    # v0.6.11 — Admin alert now renders through the same dark+Kade shell as
    # customer-facing mail so Daniel's inbox is consistent. Eyebrow shows the
    # signal at a glance; the data table reads at terminal speed.
    plan_row = (
        f'<tr><td style="padding:7px 0;color:{TEXT_TERTIARY};">Plan</td><td style="padding:7px 0;color:{INK};">{monthly_usd}</td></tr>'
        if monthly_usd else ''
    )
    note_row = (
        f'<tr><td style="padding:7px 0;color:{TEXT_TERTIARY};">Note</td><td style="padding:7px 0;color:{INK};">{note}</td></tr>'
        if note else ''
    )
    body_html = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">paid customer · {pretty_source}</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.02em;line-height:1.1;margin:0 0 18px;color:{INK};">
  <span style="color:{FUCHSIA};">{tier.upper()}</span> activated.
</h1>
<p style="font-size:14px;line-height:1.55;color:{TEXT_SECONDARY};margin:0 0 22px;">
  {tier.upper()} tier just activated via {pretty_source}.
</p>
<table cellpadding="0" cellspacing="0" border="0" style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:13px;border-collapse:collapse;width:100%;background:{DARK_CARD_2};border:1px solid {LINE};border-radius:12px;padding:12px;">
  <tr><td style="padding:7px 12px;color:{TEXT_TERTIARY};width:90px;">Email</td><td style="padding:7px 12px;color:{INK};">{customer_email}</td></tr>
  <tr><td style="padding:7px 12px;color:{TEXT_TERTIARY};">Tier</td><td style="padding:7px 12px;color:{INK};">{tier}</td></tr>
  <tr><td style="padding:7px 12px;color:{TEXT_TERTIARY};">Source</td><td style="padding:7px 12px;color:{INK};">{pretty_source}</td></tr>
  {plan_row}
  {note_row}
</table>
<p style="margin:22px 0 0;font-size:11px;color:{TEXT_TERTIARY};font-family:'Geist Mono',ui-monospace,Menlo,monospace;letter-spacing:0.08em;">
  Automated alert from junior-backend. Adjust recipients via JUNIOR_ADMIN_EMAILS.
</p>
"""
    # Build a minimal MailContext for the shell so links + footer still work.
    # No customer download CTA in admin alerts — this is an internal heads-up.
    _ctx = MailContext.build()
    html = _shell(subject, body_html, ctx=_ctx)

    text = f"""New paid customer

{tier.upper()} tier activated via {pretty_source}.

Email:  {customer_email}
Tier:   {tier}
Source: {pretty_source}
{extras_block_text}

Automated alert from junior-backend.
"""
    return subject, html, text


def render_admin_affiliate_milestone(
    *,
    affiliate_email: str,
    milestone: str,
    note: str | None,
) -> tuple[str, str, str]:
    pretty = {
        "first_paid_referral": "First paid referral landed",
        "qualified_50_percent": "Qualified · 50% recurring unlocked",
    }.get(milestone, milestone.replace("_", " "))
    subject = f"💸  Affiliate milestone — {pretty}"
    extras_block_text = f"\nNote:   {note}" if note else ""
    html = f"""<!doctype html>
<html><body style="margin:0;padding:32px;background:#FAF7F2;color:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E8DFD2;border-radius:16px;padding:32px;">
    <div style="display:inline-block;background:#FF1A8C;color:#fff;width:32px;height:32px;border-radius:8px;text-align:center;line-height:32px;font-weight:700;font-family:'Geist Mono',monospace;">/</div>
    <h1 style="font-family:Fraunces,Georgia,serif;font-size:24px;margin:18px 0 8px;">Affiliate milestone</h1>
    <p style="font-size:14px;line-height:1.6;color:#5A5560;margin:0 0 18px;">
      <strong style="color:#FF1A8C;">{pretty}</strong>
    </p>
    <table style="font-family:'Geist Mono',monospace;font-size:13px;border-collapse:collapse;width:100%;">
      <tr><td style="padding:6px 0;color:#8A8590;width:120px;">Affiliate</td><td style="padding:6px 0;">{affiliate_email}</td></tr>
      <tr><td style="padding:6px 0;color:#8A8590;">Milestone</td><td style="padding:6px 0;">{milestone}</td></tr>
      {f'<tr><td style="padding:6px 0;color:#8A8590;">Note</td><td style="padding:6px 0;">{note}</td></tr>' if note else ''}
    </table>
    <p style="margin:24px 0 0;font-size:12px;color:#8A8590;font-family:'Geist Mono',monospace;">
      Automated alert from junior-backend.
    </p>
  </div>
</body></html>"""
    text = f"""Affiliate milestone

{pretty}

Affiliate: {affiliate_email}
Milestone: {milestone}{extras_block_text}

Automated alert from junior-backend.
"""
    return subject, html, text


def render_admin_big_payout(
    *,
    customer_email: str,
    bounty_title: str,
    payout: str,
    note: str | None,
) -> tuple[str, str, str]:
    subject = f"💸  Big payout approved — {payout} · {bounty_title[:40]}"
    extras_block_text = f"\nNote:   {note}" if note else ""
    html = f"""<!doctype html>
<html><body style="margin:0;padding:32px;background:#FAF7F2;color:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E8DFD2;border-radius:16px;padding:32px;">
    <div style="display:inline-block;background:#FF1A8C;color:#fff;width:32px;height:32px;border-radius:8px;text-align:center;line-height:32px;font-weight:700;font-family:'Geist Mono',monospace;">/</div>
    <h1 style="font-family:Fraunces,Georgia,serif;font-size:24px;margin:18px 0 8px;">Big Content Reward payout</h1>
    <p style="font-size:14px;line-height:1.6;color:#5A5560;margin:0 0 18px;">
      <strong style="color:#FF1A8C;">{payout}</strong> approved on {bounty_title}.
    </p>
    <table style="font-family:'Geist Mono',monospace;font-size:13px;border-collapse:collapse;width:100%;">
      <tr><td style="padding:6px 0;color:#8A8590;width:120px;">Clipper</td><td style="padding:6px 0;">{customer_email}</td></tr>
      <tr><td style="padding:6px 0;color:#8A8590;">Bounty</td><td style="padding:6px 0;">{bounty_title}</td></tr>
      <tr><td style="padding:6px 0;color:#8A8590;">Payout</td><td style="padding:6px 0;">{payout}</td></tr>
      {f'<tr><td style="padding:6px 0;color:#8A8590;">Note</td><td style="padding:6px 0;">{note}</td></tr>' if note else ''}
    </table>
    <p style="margin:24px 0 0;font-size:12px;color:#8A8590;font-family:'Geist Mono',monospace;">
      Automated alert from junior-backend.
    </p>
  </div>
</body></html>"""
    text = f"""Big Content Reward payout

{payout} approved on {bounty_title}.

Clipper: {customer_email}
Bounty:  {bounty_title}
Payout:  {payout}{extras_block_text}

Automated alert from junior-backend.
"""
    return subject, html, text


def render_admin_kyc_alert(
    *,
    customer_email: str,
    stripe_status: str,
    requirements_due: list[str] | None,
    note: str | None,
) -> tuple[str, str, str]:
    reqs_pretty = ", ".join(requirements_due or []) if requirements_due else "—"
    subject = f"💸  Stripe Connect KYC stalled — {customer_email}"
    extras_block_text = f"\nNote:   {note}" if note else ""
    html = f"""<!doctype html>
<html><body style="margin:0;padding:32px;background:#FAF7F2;color:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E8DFD2;border-radius:16px;padding:32px;">
    <div style="display:inline-block;background:#FF1A8C;color:#fff;width:32px;height:32px;border-radius:8px;text-align:center;line-height:32px;font-weight:700;font-family:'Geist Mono',monospace;">/</div>
    <h1 style="font-family:Fraunces,Georgia,serif;font-size:24px;margin:18px 0 8px;">Stripe Connect KYC stalled</h1>
    <p style="font-size:14px;line-height:1.6;color:#5A5560;margin:0 0 18px;">
      Affiliate is in <strong style="color:#FF1A8C;">{stripe_status}</strong> with outstanding KYC.
    </p>
    <table style="font-family:'Geist Mono',monospace;font-size:13px;border-collapse:collapse;width:100%;">
      <tr><td style="padding:6px 0;color:#8A8590;width:120px;">Affiliate</td><td style="padding:6px 0;">{customer_email}</td></tr>
      <tr><td style="padding:6px 0;color:#8A8590;">Status</td><td style="padding:6px 0;">{stripe_status}</td></tr>
      <tr><td style="padding:6px 0;color:#8A8590;">Currently due</td><td style="padding:6px 0;">{reqs_pretty}</td></tr>
      {f'<tr><td style="padding:6px 0;color:#8A8590;">Note</td><td style="padding:6px 0;">{note}</td></tr>' if note else ''}
    </table>
    <p style="margin:24px 0 0;font-size:12px;color:#8A8590;font-family:'Geist Mono',monospace;">
      Automated alert from junior-backend. The user also received a nudge to finish KYC.
    </p>
  </div>
</body></html>"""
    text = f"""Stripe Connect KYC stalled

Affiliate {customer_email} is in {stripe_status} with outstanding KYC.

Affiliate:     {customer_email}
Status:        {stripe_status}
Currently due: {reqs_pretty}{extras_block_text}

Automated alert from junior-backend.
"""
    return subject, html, text


def render_whop_claim(*, email: str, claim_url: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    subject = "Claim your Liquid Clips purchase"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">secure claim · expires in 20 min</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Link your Whop purchase to Liquid Clips.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Someone asked to attach a Liquid Clips purchase made with <strong style="color:{INK};">this email</strong> to a Liquid Clips account that signed up with a different address. If that was you, confirm below — the link works once and expires in 20 minutes.
</p>
<p style="margin:0 0 16px;">{_btn("Claim my purchase →", claim_url)}</p>
<p style="font-size:13px;line-height:1.6;color:{TEXT_TERTIARY};margin:18px 0 0;">
  Didn't request this? Ignore this email — nothing changes. The link only works for the account that asked for it.
</p>
"""
    text = (
        f"Claim your Liquid Clips purchase\n\n{_greeting(first_name)}\n\n"
        "Someone asked to attach a Liquid Clips purchase made with this email to a Liquid Clips account "
        "that signed up with a different address. If that was you, confirm here:\n\n"
        f"{claim_url}\n\n"
        "This link works once and expires in 20 minutes. If you didn't request it, ignore this email.\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


# --- template renderers --------------------------------------------------

# Shared design tokens — kept inline so the templates are self-contained and
# any future "extract them" refactor doesn't fragment the brand.
#
# v0.6.11 — Flipped to a dark-mode palette per Daniel's brand direction
# ("black with pink text"). Names kept (INK/PAPER/TEXT_SECONDARY/etc.) so the
# 15+ existing template fragments don't need per-string edits — each token now
# reads as its DARK-mode equivalent. Admin alert templates use hardcoded
# colors and are unaffected.
#
# Mapping (old light → new dark):
#   INK       (was #0A0A0F black text)       → cream text on dark
#   PAPER     (was #FAF7F2 page bg / btn-fg) → dark card surface (button label still on it)
#   PAPER_WARM(was #F5EFE7 outer bg)         → deepest black outer bg
#   LINE      (was #E8DFD2 hairline)         → warm-pink-tinted hairline
INK            = "#F5EFE7"   # body / headline text on dark
PAPER          = "#0F0F14"   # card surface (also the colour the button "label" stripe sits on)
PAPER_WARM     = "#050507"   # outermost page bg, near-pure black
LINE           = "#231423"   # warm pink-tinted hairline
FUCHSIA        = "#FF1A8C"
TEXT_SECONDARY = "#B5AFA8"   # secondary body copy (paragraphs, list items)
TEXT_TERTIARY  = "#7A7672"   # tertiary / footer / monocaps

# Convenience aliases used by the dark shell — keep them named so the chrome
# block remains readable and easy to retune separately from the body tokens.
DARK_BG       = PAPER_WARM
DARK_CARD     = PAPER
DARK_CARD_2   = "#15151B"
DARK_BORDER   = LINE
DARK_TEXT     = INK
DARK_TEXT_DIM = TEXT_TERTIARY

# v0.6.11 — Kade glyph (the pink Space-Invaders alien) inlined as a base64 PNG
# so email clients render it without an external host (Outlook strips remote
# images by default; Gmail caches them; CIDs are fragile through forwarders).
# Source: app/assets/kade-glyph-64.png (64×64, ~3.4KB). Re-encoded at import
# time so dropping a new PNG into assets/ swaps the brand mark without code
# edits. Black square + pink alien = LIQUID CLIPS mark.
def _load_kade_glyph_data_uri() -> str:
    try:
        from pathlib import Path
        import base64
        glyph_path = Path(__file__).resolve().parent / "assets" / "kade-glyph-64.png"
        if not glyph_path.is_file():
            return ""
        encoded = base64.b64encode(glyph_path.read_bytes()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except Exception:  # noqa: BLE001
        # Never break email send because the brand mark missed. Templates
        # fall back to the original fuchsia "/" square when the URI is empty.
        return ""

KADE_GLYPH_DATA_URI = _load_kade_glyph_data_uri()


def _shell(title: str, body_html: str, *, ctx: MailContext) -> str:
    """Wrap a content fragment in the Liquid Clips email chrome — Kade brand
    mark at top, dark card with fuchsia accents, footer with legal links.
    Inline styles only.

    v0.6.11 — Dark chrome (black bg + pink accents) per Daniel's brand
    direction. The Kade glyph is referenced via `cid:kade-glyph` and attached
    in `_send()` as an inline MIME part — that's the only format iOS Gmail
    reliably renders for sub-100KB inline imagery."""
    glyph_cell = (
        f'<td style="padding:0;width:48px;height:48px;text-align:left;vertical-align:middle;">'
        f'<img src="cid:kade-glyph" width="40" height="40" alt="Kade" '
        f'style="display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:nearest-neighbor;image-rendering:pixelated;" />'
        f'</td>'
    )
    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark light">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background:{DARK_BG};font-family:'Geist','Helvetica Neue',Arial,sans-serif;color:{DARK_TEXT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{DARK_BG};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:{DARK_CARD};border:1px solid {DARK_BORDER};border-radius:24px;overflow:hidden;box-shadow:0 0 0 1px {DARK_BORDER}, 0 24px 60px rgba(255,26,140,0.10);">
        <tr><td style="padding:28px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              {glyph_cell}
              <td style="padding-left:14px;font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:13px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:{FUCHSIA};vertical-align:middle;">LIQUID&nbsp;CLIPS</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 32px;">
          {body_html}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin-top:18px;">
        <tr><td align="center" style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:{DARK_TEXT_DIM};line-height:1.7;">
          <a href="{ctx.site_url}" style="color:{FUCHSIA};text-decoration:none;">liquidclips.app</a>
          &nbsp;·&nbsp;
          <a href="{ctx.site_url}/privacy" style="color:{DARK_TEXT_DIM};text-decoration:none;">privacy</a>
          &nbsp;·&nbsp;
          <a href="{ctx.site_url}/terms" style="color:{DARK_TEXT_DIM};text-decoration:none;">terms</a>
          <br>
          <span style="color:{DARK_TEXT_DIM};">reply to this email — it reaches us directly.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _greeting(first_name: str | None) -> str:
    return f"Hi {first_name}," if first_name else "Hi,"


def _btn(label: str, url: str) -> str:
    # v0.6.11 — Fuchsia pill on dark. White label for high contrast against
    # the brand pink. Soft glow via box-shadow so the button feels lifted
    # off the dark card without looking like a static raster.
    return (
        f'<a href="{url}" '
        f'style="display:inline-block;background:{FUCHSIA};color:#FFFFFF;'
        f'font-family:Geist,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;'
        f'text-decoration:none;padding:13px 26px;border-radius:999px;'
        f'letter-spacing:0.01em;box-shadow:0 0 0 1px rgba(255,26,140,0.45),0 18px 40px rgba(255,26,140,0.30);">{label}</a>'
    )


def render_welcome(*, email: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    subject = "Welcome to Liquid Clips."
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">welcome · 100 free exports unlocked</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 12px;color:{INK};">
  Welcome to Liquid Clips.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Liquid Clips turns long videos into ready-to-post shorts — local-first, your files never leave your machine unless you publish them. You're set up with <strong style="color:{INK};">100 free clip exports</strong> to start. Cancel any time.
</p>

<!-- Keep us out of spam (Gmail Primary nudge) -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:{DARK_CARD_2};border:1px solid {LINE};border-radius:14px;margin:0 0 24px;">
  <tr><td style="padding:14px 16px;">
    <p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 6px;">keep us out of spam</p>
    <p style="font-size:13px;line-height:1.55;color:{INK};margin:0;">
      <strong>Add hello@liquidclips.app to your contacts</strong>, and drag this email to your <strong>Primary</strong> tab in Gmail. Receipts, payout alerts, and login codes from us never slip into Promotions or Spam after that.
    </p>
  </td></tr>
</table>

<!-- What's inside the box (feature ladder) -->
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">what's inside the box</p>
<ul style="font-size:14.5px;line-height:1.65;color:{TEXT_SECONDARY};margin:0 0 24px;padding:0 0 0 20px;list-style:disc;">
  <li><strong style="color:{INK};">Fast Draft pipeline</strong> — drop a video or paste a YouTube / TikTok / IG / X link, get top scoring clips back in minutes, not hours. Apple Silicon Macs use MLX whisper for 2–5× local transcription.</li>
  <li><strong style="color:{INK};">LC Score</strong> on every clip — hook, retention, clarity, shareability. No more guessing which moment to ship.</li>
  <li><strong style="color:{INK};">Animated captions, hook overlays, smart reframe</strong> — vertical / square / portrait, face-aware crop, word-by-word karaoke captions.</li>
  <li><strong style="color:{INK};">Import finished clips</strong> too — bring MP4 / MOV / WEBM files you already cut. Stack, split, remix, schedule from the same workspace.</li>
  <li><strong style="color:{INK};">Publish + schedule across socials</strong> — TikTok, Instagram, YouTube Shorts, X, all from inside the app. Drip mode spaces posts over hours or days.</li>
  <li><strong style="color:{INK};">Earn tab</strong> — clip live Whop Content Rewards bounties for the brands and creators you already follow.</li>
  <li><strong style="color:{INK};">Local-first by default</strong> — every clip and transcript lives on your machine until you choose to publish. No surprise uploads.</li>
</ul>

<!-- Two-step quickstart -->
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">first 90 seconds</p>
<ol style="font-size:14.5px;line-height:1.7;color:{INK};margin:0 0 22px;padding:0 0 0 20px;">
  <li><strong>Download the desktop app</strong> — drag a video in, get back scored clips with captions, thumbnails, and titles.</li>
  <li><strong>Open the Earn tab</strong> inside the app to see live Content Rewards bounties you can clip for today.</li>
</ol>
<p style="margin:0 0 28px;">{_btn("Download Liquid Clips →", ctx.download_url)}</p>

<!-- Affiliate community pitch -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:{DARK_CARD_2};border:1px solid {FUCHSIA};border-radius:18px;margin:0 0 22px;box-shadow:0 0 0 1px rgba(255,26,140,0.25),0 18px 50px rgba(255,26,140,0.18);">
  <tr><td style="padding:20px 22px;">
    <p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 6px;">earn alongside us</p>
    <h2 style="font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:600;letter-spacing:-0.02em;line-height:1.15;margin:0 0 10px;color:{INK};">
      50% MRR. For life.
    </h2>
    <p style="font-size:14px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 14px;">
      Refer two paying users and unlock <strong style="color:{INK};">50% recurring commission</strong> on every customer you bring in — lifetime, not just the first month. Your link, your audience, your share. We handle the payout cycle through Whop.
    </p>
    <p style="margin:0 0 6px;">{_btn("Get your affiliate link →", f"{ctx.account_url}/dashboard")}</p>
    <p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.10em;text-transform:uppercase;color:{TEXT_TERTIARY};margin:10px 0 0;">
      payouts via Whop · no payment processing on our side
    </p>
  </td></tr>
</table>

<!-- Community block -->
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">community</p>
<p style="font-size:14.5px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  The clipper community lives inside our Whop hub — bounty briefs, what's working this week, payout milestones, and a direct line to us. <a href="{ctx.whop_manage_url}" style="color:{FUCHSIA};text-decoration:none;border-bottom:1px solid {FUCHSIA};">Join the Whop community →</a>
</p>

<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  100 free clip exports · cancel anytime · your files stay on your machine
</p>
"""
    text = (
        f"Welcome to Liquid Clips.\n\n{_greeting(first_name)}\n\n"
        "Liquid Clips turns long videos into ready-to-post shorts — local-first, "
        "your files never leave your machine unless you publish them. "
        "You're set up with 100 free clip exports to start.\n\n"
        "KEEP US OUT OF SPAM\n"
        "Add hello@liquidclips.app to your contacts, and drag this email to your\n"
        "Primary tab in Gmail. That way receipts, payout alerts, and login codes\n"
        "from us never slip into Promotions or Spam.\n\n"
        "WHAT'S INSIDE THE BOX\n"
        "- Fast Draft pipeline: drop a video or paste a link, get scored clips in minutes.\n"
        "- LC Score on every clip (hook / retention / clarity / shareability).\n"
        "- Animated captions, hook overlays, face-aware reframe to vertical / square / portrait.\n"
        "- Import finished MP4/MOV/WEBM clips into the same workspace.\n"
        "- Publish and schedule to TikTok, Instagram, YouTube Shorts, X.\n"
        "- Earn tab: clip live Whop Content Rewards bounties for paid payouts.\n"
        "- Local-first by default — nothing uploads without you saying so.\n\n"
        "FIRST 90 SECONDS\n"
        f"1. Download Liquid Clips: {ctx.download_url}\n"
        "2. Open the Earn tab inside the app for live Content Rewards bounties.\n\n"
        "EARN ALONGSIDE US — 50% MRR FOR LIFE\n"
        "Refer two paying users and unlock 50% recurring commission on every "
        "customer you bring in — lifetime, not just first month. Payouts via Whop.\n"
        f"Get your affiliate link: {ctx.account_url}/dashboard\n\n"
        f"COMMUNITY\n"
        f"Our Whop hub is where the clipper community lives — bounty briefs, what's\n"
        f"working this week, payout milestones, direct line to us.\n"
        f"Join: {ctx.whop_manage_url}\n\n"
        "Reply to this email to reach us directly.\n"
        "— Liquid Clips"
    )
    return subject, _shell("Welcome to Liquid Clips", body, ctx=ctx), text


def render_subscription_activated(*, email: str, tier: str, first_name: str | None, ctx: MailContext, trial: bool = False) -> tuple[str, str, str]:
    pretty = {"solo": "Solo", "growth": "Growth", "autopilot": "Autopilot"}.get(tier, tier.capitalize())
    if trial:
        # Affiliate / Whop-trial starter pass — NOT yet a paid Solo. Liquid Clips caps
        # at 100 successful exports; Whop bills $29.99 after the 30-day trial.
        subject = "Your 100 free clip exports are ready."
        body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">trial active · $0 today</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Your 100 free clip exports are ready.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  You're in — <strong style="color:{INK};">$0 today</strong>. Your Solo plan starts after 30 days, unless you cancel.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Use your <strong style="color:{INK};">100 free clip exports</strong> however you like. If you use all 100 free exports first, Liquid Clips will ask you to continue on Solo before exporting more.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Download Liquid Clips after signing into your account, then drop in a video and start exporting.
</p>
<p style="margin:0 0 16px;">{_btn("Download Liquid Clips →", ctx.download_url)}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  $0 today · Solo $29.99/mo after 30 days unless you cancel · cancel any time
</p>
"""
        text = (
            f"Your 100 free clip exports are ready.\n\n{_greeting(first_name)}\n\n"
            "You're in — $0 today. Your Solo plan starts after 30 days, unless you cancel.\n\n"
            "Use your 100 free clip exports however you like. If you use all 100 free exports "
            "first, Liquid Clips will ask you to continue on Solo before exporting more.\n\n"
            f"Download Liquid Clips after signing into your account: {ctx.download_url}\n\n"
            "Reply to this email to reach us directly.\n— Liquid Clips"
        )
        return subject, _shell(subject, body, ctx=ctx), text
    pitch = {
        "solo": "Unlimited clipping. One platform connection. Publish posts manually any time.",
        "growth": "Hosted transcribe + LLM, four platform connections, multi-platform publish + schedule.",
        "autopilot": "Drip-mode across every platform, unlimited connections, project memory, founder community.",
    }.get(tier, "Your new plan is active.")
    subject = f"Liquid Clips {pretty} is live."
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">subscription active</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Liquid Clips {pretty} is live.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  {pitch}
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Open Liquid Clips on your machine — it'll pick up your new plan on next launch (or hit Sync in Settings to flip immediately).
</p>
<p style="margin:0 0 16px;">{_btn("Open dashboard →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  cancel anytime · manage at {ctx.account_url.replace('https://','')}/dashboard
</p>
"""
    text = (
        f"Liquid Clips {pretty} is live.\n\n{_greeting(first_name)}\n\n"
        f"{pitch}\n\n"
        "Open Liquid Clips to pick up the new plan automatically, or click Sync in Settings.\n"
        f"Dashboard: {ctx.account_url}/dashboard\n\n"
        "Reply to this email to reach us directly.\n"
        "— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_subscription_canceled(*, email: str, paid_until_iso: str | None, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    nice_date = ""
    if paid_until_iso:
        try:
            from datetime import datetime
            nice_date = datetime.fromisoformat(paid_until_iso.replace("Z", "+00:00")).strftime("%-d %b %Y")
        except Exception:
            nice_date = ""
    subject = "Liquid Clips — your plan is set to end."
    until_line = (
        f"You keep full access until <strong style=\"color:{INK};\">{nice_date}</strong>."
        if nice_date else
        "You keep full access until the end of your current billing period."
    )
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};margin:0 0 8px;">cancellation confirmed</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Sorry to see you go.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Your Liquid Clips subscription has been canceled and won't renew. {until_line} After that you'll drop to the Free plan — your projects on disk stay put.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  If something specifically didn't work, reply to this email — it goes straight to us and we read every one.
</p>
<p style="margin:0 0 16px;">{_btn("Re-activate any time →", f"{ctx.account_url}/upgrade")}</p>
"""
    text = (
        f"Sorry to see you go.\n\n{_greeting(first_name)}\n\n"
        "Your Liquid Clips subscription has been canceled and won't renew. "
        + (f"You keep full access until {nice_date}. " if nice_date else "You keep full access until the end of your current billing period. ")
        + "After that you'll drop to Free.\n\n"
        "If something didn't work, reply to this email — we read every one.\n"
        f"Reactivate: {ctx.account_url}/upgrade\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_founder_welcome(*, email: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    subject = "Founder Lifetime — you're in."
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">founder lifetime · one-time $500</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  You're a founder.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Autopilot tier, locked in forever. No renewals, no price hikes, no expiry. Plus the founder-only Slack channel where we ship what you ask for first.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  We'll send you the Slack invite within 24 hours. In the meantime, the app is yours — download it, drop a video, and let me know what's worth shipping next.
</p>
<p style="margin:0 0 16px;">{_btn("Download Liquid Clips →", ctx.download_url)}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  thank you. — daniel
</p>
"""
    text = (
        f"You're a founder.\n\n{_greeting(first_name)}\n\n"
        "Autopilot tier, locked forever. No renewals, no price hikes. "
        "Plus the founder-only Slack channel.\n\n"
        "Slack invite within 24h. App is ready now.\n"
        f"Download: {ctx.download_url}\n\n"
        "Reply to this email any time.\n— Daniel"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_license_activated(*, email: str, machine_label: str | None, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    subject = "Liquid Clips just activated on a new machine."
    # Plain label for the headline (no HTML), bold-styled inline string for the body.
    machine_plain = machine_label or "a new machine"
    machine_inline = (
        f'<strong style="color:{INK};">{machine_label}</strong>'
        if machine_label
        else "a new machine"
    )
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};margin:0 0 8px;">activation confirmed</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:26px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Liquid Clips activated on {machine_plain}.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Quick security note — we just issued a license JWT to {machine_inline}. If that was you, ignore this. If it wasn't, sign out from every device on your dashboard and we'll rotate your license keys.
</p>
<p style="margin:0 0 16px;">{_btn("Open dashboard →", f"{ctx.account_url}/dashboard")}</p>
"""
    text = (
        f"Liquid Clips activated on {machine_label or 'a new machine'}.\n\n{_greeting(first_name)}\n\n"
        "We just issued a license JWT to this machine. If that was you, ignore. "
        "If not, sign out from every device on your dashboard.\n"
        f"Dashboard: {ctx.account_url}/dashboard\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_affiliate_qualified(*, email: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    # Deliberately carries no count of buyers, no buyer emails, no PII beyond
    # the affiliate's own context. Whop owns the source of truth for payouts.
    subject = "You unlocked Liquid Clips referrals."
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">referrals · 50% recurring active</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  You unlocked Liquid Clips referrals.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Two paid referrals confirmed — <strong style="color:{INK};">50% recurring</strong> is active on every customer you refer from here. Lifetime commission, not just first month.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Whop tracks the payouts on their cycle; your Earn dashboard shows the live count and link.
</p>
<p style="margin:0 0 16px;">{_btn("Open Earn dashboard →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  payouts via Whop · we never handle the money
</p>
"""
    text = (
        f"You unlocked Liquid Clips referrals.\n\n{_greeting(first_name)}\n\n"
        "Two paid referrals confirmed — 50% recurring is active on every customer you refer "
        "from here. Lifetime commission, not just first month.\n\n"
        f"Earn dashboard: {ctx.account_url}/dashboard\n\n"
        "Payouts via Whop. Reply to this email any time.\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_first_paid_referral(*, email: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    # Deliberately carries no buyer email, no platform handle, no transcript or
    # caption fragment. The affiliate sees their own dashboard for the count.
    subject = "Your first paid Liquid Clips referral landed."
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">first paid referral</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  First paid referral landed.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Someone you referred just converted to a paid Liquid Clips plan. Commission is live on Whop's payout cycle from here.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  One more paid referral unlocks the <strong style="color:{INK};">50% recurring</strong> rate on every customer you refer — lifetime, not just first month.
</p>
<p style="margin:0 0 16px;">{_btn("Open Earn dashboard →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  payouts via Whop · we never handle the money
</p>
"""
    text = (
        f"First paid referral landed.\n\n{_greeting(first_name)}\n\n"
        "Someone you referred just converted to a paid Liquid Clips plan. "
        "Commission is live on Whop's payout cycle.\n\n"
        "One more paid referral unlocks the 50% recurring rate — lifetime, not just first month.\n\n"
        f"Earn dashboard: {ctx.account_url}/dashboard\n\n"
        "Payouts via Whop. Reply to this email any time.\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_bounty_approved(*, email: str, bounty_title: str, payout: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    # Internal symbol stays `bounty_approved` to avoid call-site churn (per
    # the Earn UI naming-sweep rule: user-facing copy says "Content Reward",
    # code keeps `bounty`). All visible strings below use the user-facing terms.
    subject = f"Content Reward approved · est. {payout}"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">content reward approved</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Reward clip approved · est. {payout}.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Your reward clip for <strong style="color:{INK};">{bounty_title}</strong> passed Whop's review. Payouts flow through Whop's rails on their cycle — track it on your Whop dashboard.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Liquid Clips's Earn tab now shows this in the Approved column. Want to claim another Content Reward? Open the tab and pick the highest fit-score one matching your platforms.
</p>
<p style="margin:0 0 16px;">{_btn("Open Liquid Clips · Earn →", f"{ctx.download_url}")}</p>
"""
    text = (
        f"Reward clip approved · est. {payout}.\n\n{_greeting(first_name)}\n\n"
        f"Your reward clip for {bounty_title} passed Whop's review. "
        "Payouts flow through Whop on their cycle.\n\n"
        f"Open Liquid Clips · Earn: {ctx.download_url}\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_schedule_failed(
    *,
    email: str,
    channel_label: str,
    error_summary: str,
    first_name: str | None,
    ctx: MailContext,
) -> tuple[str, str, str]:
    # Keep error_summary short — Ayrshare can return multi-paragraph errors.
    short_err = (error_summary or "").strip().replace("\n", " ")[:240]
    subject = f"Scheduled post didn't go out · {channel_label}"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};margin:0 0 8px;">schedule failed · action needed</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Your scheduled post didn't go out.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 18px;">
  A scheduled post for <strong style="color:{INK};">{channel_label}</strong> failed after the usual retries. The clip is still in your project — re-schedule from Liquid Clips when you're ready.
</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:12px;line-height:1.6;color:{TEXT_SECONDARY};background:{PAPER_WARM};border:1px solid {LINE};border-radius:8px;padding:12px 14px;margin:0 0 22px;">
  {short_err}
</p>
<p style="margin:0 0 16px;">{_btn("Open Liquid Clips →", ctx.download_url)}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  retries exhausted · reschedule any time
</p>
"""
    text = (
        f"Your scheduled post didn't go out.\n\n{_greeting(first_name)}\n\n"
        f"A scheduled post for {channel_label} failed after retries. The clip "
        "is still in your project — re-schedule from Liquid Clips when you're ready.\n\n"
        f"Error: {short_err}\n\n"
        f"Open Liquid Clips: {ctx.download_url}\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_channel_disconnected(
    *,
    email: str,
    channel_label: str,
    platform: str,
    first_name: str | None,
    ctx: MailContext,
) -> tuple[str, str, str]:
    plat_pretty = platform.capitalize() if platform else "the platform"
    subject = f"Reconnect {channel_label} · {plat_pretty} link expired"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};margin:0 0 8px;">channel disconnected · action needed</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Your {plat_pretty} link expired.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  We just checked <strong style="color:{INK};">{channel_label}</strong> and {plat_pretty} no longer accepts our publish key — usually because the OAuth expired or you revoked the connection. New posts to this channel will fail until you reconnect it.
</p>
<p style="margin:0 0 16px;">{_btn("Open Settings → Channels →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  takes about 30 seconds · existing scheduled posts will retry once reconnected
</p>
"""
    text = (
        f"Your {plat_pretty} link expired.\n\n{_greeting(first_name)}\n\n"
        f"We just checked {channel_label} and {plat_pretty} no longer accepts "
        "our publish key. New posts to this channel will fail until you reconnect it.\n\n"
        f"Reconnect: {ctx.account_url}/dashboard\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_trial_ending_soon(
    *,
    email: str,
    days_left: int,
    tier: str,
    first_name: str | None,
    ctx: MailContext,
) -> tuple[str, str, str]:
    pretty = {"solo": "Solo", "growth": "Growth", "autopilot": "Autopilot",
              "pro": "Pro", "agency": "Agency"}.get(tier, tier.capitalize())
    day_word = "day" if days_left == 1 else "days"
    subject = f"Your Liquid Clips trial ends in {days_left} {day_word}."
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">trial · {days_left} {day_word} left</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Your trial ends in {days_left} {day_word}.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Your {pretty} starter trial is wrapping up. In {days_left} {day_word} your card on Whop will be charged and {pretty} access continues uninterrupted.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  If you'd rather not roll over, cancel from your Whop dashboard before the charge. Either way, projects and clips on disk stay where they are.
</p>
<p style="margin:0 0 16px;">{_btn("Manage subscription →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  cancel anytime · billing managed by Whop
</p>
"""
    text = (
        f"Your trial ends in {days_left} {day_word}.\n\n{_greeting(first_name)}\n\n"
        f"Your {pretty} starter trial is wrapping up. In {days_left} {day_word} your card "
        f"on Whop will be charged and {pretty} access continues uninterrupted.\n\n"
        "If you'd rather not roll over, cancel from your Whop dashboard before the charge.\n\n"
        f"Manage: {ctx.account_url}/dashboard\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_affiliate_payout_enabled(
    *,
    email: str,
    first_name: str | None,
    ctx: MailContext,
) -> tuple[str, str, str]:
    subject = "Payouts unlocked · Liquid Clips affiliate"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">stripe connect · payouts enabled</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Your payouts are live.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Stripe just cleared your KYC — your Liquid Clips affiliate payouts will land directly in the bank you connected. Nothing else to do.
</p>
<p style="margin:0 0 16px;">{_btn("Open dashboard →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  payouts via stripe connect · liquid clips never sees the money
</p>
"""
    text = (
        f"Your payouts are live.\n\n{_greeting(first_name)}\n\n"
        "Stripe just cleared your KYC — your Liquid Clips affiliate payouts will "
        "land directly in the bank you connected. Nothing else to do.\n\n"
        f"Dashboard: {ctx.account_url}/dashboard\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_payout_kyc_required(
    *,
    email: str,
    first_name: str | None,
    ctx: MailContext,
) -> tuple[str, str, str]:
    subject = "Finish KYC to unlock Liquid Clips payouts"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};margin:0 0 8px;">stripe connect · documents required</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Stripe needs a couple more things.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Your Stripe Connect account is in <strong style="color:{INK};">restricted</strong> — Stripe asked for additional verification before they can release affiliate payouts. Quick fix: open your dashboard and run through the requirements Stripe surfaces.
</p>
<p style="margin:0 0 16px;">{_btn("Finish KYC →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  usually takes 5 minutes · payouts unlock automatically once cleared
</p>
"""
    text = (
        f"Stripe needs a couple more things.\n\n{_greeting(first_name)}\n\n"
        "Your Stripe Connect account is restricted — Stripe asked for additional "
        "verification before they can release affiliate payouts. Quick fix: open "
        "your dashboard and run through the requirements.\n\n"
        f"Dashboard: {ctx.account_url}/dashboard\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_account_pack_added(
    *,
    email: str,
    extra_accounts: int,
    first_name: str | None,
    ctx: MailContext,
) -> tuple[str, str, str]:
    n_word = f"{extra_accounts} extra social account" + ("" if extra_accounts == 1 else "s")
    subject = f"Account pack added · {n_word}"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">add-on confirmed</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Account pack added.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  You just added <strong style="color:{INK};">{n_word}</strong> to your Liquid Clips plan. Add the new channel in Settings → Channels — the cap lifts immediately.
</p>
<p style="margin:0 0 16px;">{_btn("Open Settings →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  $6/mo per extra account · cancel anytime
</p>
"""
    text = (
        f"Account pack added.\n\n{_greeting(first_name)}\n\n"
        f"You just added {n_word} to your Liquid Clips plan. Add the new channel "
        "in Settings → Channels — the cap lifts immediately.\n\n"
        f"Settings: {ctx.account_url}/dashboard\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_bounty_rejected(
    *,
    email: str,
    bounty_title: str,
    reason: str,
    first_name: str | None,
    ctx: MailContext,
) -> tuple[str, str, str]:
    short_reason = (reason or "").strip().replace("\n", " ")[:300]
    subject = f"Content Reward declined · {bounty_title[:40]}"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};margin:0 0 8px;">content reward declined</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Your reward clip didn't make it through.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Your submission for <strong style="color:{INK};">{bounty_title}</strong> was declined by review. Most rejections come down to clip quality, missing disclosure, or a moment that doesn't match the reward brief.
</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:12px;line-height:1.6;color:{TEXT_SECONDARY};background:{PAPER_WARM};border:1px solid {LINE};border-radius:8px;padding:12px 14px;margin:0 0 22px;">
  Reason: {short_reason}
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Try another clip — every reward gives you up to 10 submissions a day. Pick a different moment, lead with a hook in the first second, and confirm the #ad / #sponsored tag is on your caption.
</p>
<p style="margin:0 0 16px;">{_btn("Open Liquid Clips · Earn →", ctx.download_url)}</p>
"""
    text = (
        f"Your reward clip didn't make it through.\n\n{_greeting(first_name)}\n\n"
        f"Your submission for {bounty_title} was declined by review.\n\n"
        f"Reason: {short_reason}\n\n"
        "Try another clip — every reward gives you up to 10 submissions a day. "
        "Pick a different moment, lead with a hook in the first second, and "
        "confirm the #ad / #sponsored tag is on your caption.\n\n"
        f"Open Liquid Clips · Earn: {ctx.download_url}\n\n— Liquid Clips"
    )
    return subject, _shell(subject, body, ctx=ctx), text


# ── Minecraft Story Clip Challenge — sprint #14c ─────────────────────────
#
# The 6-template funnel for the first Liquid Clips wrapped campaign. Templates
# live as HTML files in app/email_templates/minecraft_challenge/ so designers
# can iterate without touching Python. We do simple {{var}} substitution at
# send time — no template engine dep, no Mustache library, no Jinja.

from pathlib import Path as _Path


_MC_TEMPLATE_DIR = _Path(__file__).parent / "email_templates" / "minecraft_challenge"

# Subject lines pulled from each template's HTML <!-- subject: ... --> comment
# (kept in sync as a fallback in case the comment parsing ever drifts).
_MC_SUBJECTS = {
    "challenge_join":       "You're in. Read this before your first clip.",
    "first_export":         "You exported your first clip. Read this before you post.",
    "watermark_rejected":   "Your clip didn't qualify. Here's why.",
    "upgrade_confirmed":    "Clean export unlocked. Now go finish what you started.",
    "first_acceptance":     "Your first clip got accepted.",
    "leaderboard_placement": "You're in the top 10 this week.",
}

_MC_FILES = {
    "challenge_join":       "01_challenge_join.html",
    "first_export":         "02_first_export.html",
    "watermark_rejected":   "03_watermark_rejected.html",
    "upgrade_confirmed":    "04_upgrade_confirmed.html",
    "first_acceptance":     "05_first_acceptance.html",
    "leaderboard_placement": "06_leaderboard_placement.html",
}


def _mc_render(template_key: str, variables: dict[str, str]) -> tuple[str, str, str]:
    """Load a Minecraft Challenge HTML template, substitute {{var}} placeholders.

    Returns (subject, html, text). The text fallback is a derived plain-text
    version stripped of HTML — minimal effort since the campaign is HTML-first.
    """
    import re

    fname = _MC_FILES[template_key]
    raw = (_MC_TEMPLATE_DIR / fname).read_text(encoding="utf-8")

    # Substitute {{var}} placeholders — escapes left raw because email HTML
    # control over output is the whole point.
    html = raw
    for k, v in variables.items():
        html = html.replace("{{" + k + "}}", v)

    # Strip any {{remaining}} placeholders that the caller didn't provide,
    # so we never ship literal {{handle}} text in a customer email.
    html = re.sub(r"{{[a-z_]+}}", "", html)

    subject = _MC_SUBJECTS[template_key]
    text = _html_to_text(html)
    return subject, html, text


def _html_to_text(html: str) -> str:
    """Crude HTML → text for the plain-text MIME part. Strips tags + collapses
    whitespace. Good enough for Gmail's text view; the campaign optimises for
    the HTML side."""
    import re
    # Drop <style>, <script>, and HTML comments first
    s = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.S | re.I)
    s = re.sub(r"<script[^>]*>.*?</script>", "", s, flags=re.S | re.I)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def send_mc_challenge_join(email: str, *, first_name: str | None = None) -> None:
    subject, html, text = _mc_render("challenge_join", {
        "first_name": first_name or "clipper",
    })
    _async(_send, to=email, subject=subject, html=html, text=text, tag="mc_challenge_join")


def send_mc_first_export(email: str, *, first_name: str | None = None, upgrade_url: str = "https://account.jnremployee.com/upgrade") -> None:
    subject, html, text = _mc_render("first_export", {
        "first_name": first_name or "clipper",
        "upgrade_url": upgrade_url,
    })
    _async(_send, to=email, subject=subject, html=html, text=text, tag="mc_first_export")


def send_mc_watermark_rejected(email: str, *, first_name: str | None, rejection_reason: str, upgrade_url: str = "https://account.jnremployee.com/upgrade?reason=watermark") -> None:
    subject, html, text = _mc_render("watermark_rejected", {
        "first_name": first_name or "clipper",
        "rejection_reason": rejection_reason,
        "upgrade_url": upgrade_url,
    })
    _async(_send, to=email, subject=subject, html=html, text=text, tag="mc_watermark_rejected")


def send_mc_upgrade_confirmed(email: str, *, first_name: str | None = None) -> None:
    subject, html, text = _mc_render("upgrade_confirmed", {
        "first_name": first_name or "clipper",
    })
    _async(_send, to=email, subject=subject, html=html, text=text, tag="mc_upgrade_confirmed")


def send_mc_first_acceptance(email: str, *, first_name: str | None, moment_label: str = "story moment") -> None:
    subject, html, text = _mc_render("first_acceptance", {
        "first_name": first_name or "clipper",
        "moment_label": moment_label,
    })
    _async(_send, to=email, subject=subject, html=html, text=text, tag="mc_first_acceptance")


def send_mc_leaderboard_placement(email: str, *, handle: str, rank: int, earnings_usd: str) -> None:
    subject, html, text = _mc_render("leaderboard_placement", {
        "handle": handle,
        "rank": str(rank),
        "earnings_usd": earnings_usd,
    })
    _async(_send, to=email, subject=subject, html=html, text=text, tag="mc_leaderboard_placement")
