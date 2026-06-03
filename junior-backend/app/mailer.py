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

    @classmethod
    def build(cls) -> "MailContext":
        s = get_settings()
        return cls(
            site_url=s.public_site_url,
            account_url=s.account_site_url,
            download_url=s.app_download_url,
            reply_to=s.resend_reply_to,
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
    """Synchronous Resend send. Caller wraps in `_async()` for fire-and-forget."""
    settings = get_settings()
    if not settings.resend_api_key:
        log.info("[mailer] RESEND_API_KEY not configured — skipping send to=%s tag=%s", to, tag)
        return
    try:
        import resend
        resend.api_key = settings.resend_api_key
        resend.Emails.send({
            "from": settings.resend_from,
            "to": [to],
            "reply_to": [settings.resend_reply_to],
            "subject": subject,
            "html": html,
            "text": text,
            "tags": [{"name": "category", "value": tag}],
        })
        log.info("[mailer] sent tag=%s to=%s", tag, to)
    except Exception as e:  # noqa: BLE001
        log.warning("[mailer] send failed tag=%s to=%s err=%s", tag, to, e)


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

    html = f"""<!doctype html>
<html><body style="margin:0;padding:32px;background:#FAF7F2;color:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Geist,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E8DFD2;border-radius:16px;padding:32px;">
    <div style="display:inline-block;background:#FF1A8C;color:#fff;width:32px;height:32px;border-radius:8px;text-align:center;line-height:32px;font-weight:700;font-family:'Geist Mono',monospace;">/</div>
    <h1 style="font-family:Fraunces,Georgia,serif;font-size:24px;margin:18px 0 8px;">New paid customer</h1>
    <p style="font-size:14px;line-height:1.6;color:#5A5560;margin:0 0 18px;">
      <strong style="color:#FF1A8C;">{tier.upper()}</strong> tier just activated via {pretty_source}.
    </p>
    <table style="font-family:'Geist Mono',monospace;font-size:13px;border-collapse:collapse;width:100%;">
      <tr><td style="padding:6px 0;color:#8A8590;width:90px;">Email</td><td style="padding:6px 0;">{customer_email}</td></tr>
      <tr><td style="padding:6px 0;color:#8A8590;">Tier</td><td style="padding:6px 0;">{tier}</td></tr>
      <tr><td style="padding:6px 0;color:#8A8590;">Source</td><td style="padding:6px 0;">{pretty_source}</td></tr>
      {f'<tr><td style="padding:6px 0;color:#8A8590;">Plan</td><td style="padding:6px 0;">{monthly_usd}</td></tr>' if monthly_usd else ''}
      {f'<tr><td style="padding:6px 0;color:#8A8590;">Note</td><td style="padding:6px 0;">{note}</td></tr>' if note else ''}
    </table>
    <p style="margin:24px 0 0;font-size:12px;color:#8A8590;font-family:'Geist Mono',monospace;">
      Automated alert from junior-backend.<br>
      Adjust recipients via JUNIOR_ADMIN_EMAILS env var.
    </p>
  </div>
</body></html>"""

    text = f"""New paid customer

{tier.upper()} tier activated via {pretty_source}.

Email:  {customer_email}
Tier:   {tier}
Source: {pretty_source}
{extras_block_text}

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
INK = "#0A0A0F"
PAPER = "#FAF7F2"
PAPER_WARM = "#F5EFE7"
LINE = "#E8DFD2"
FUCHSIA = "#FF1A8C"
TEXT_SECONDARY = "#5A5560"
TEXT_TERTIARY = "#8A8590"


def _shell(title: str, body_html: str, *, ctx: MailContext) -> str:
    """Wrap a content fragment in the Liquid Clips email chrome — brand mark at
    top, content card, footer with legal links. Inline styles only."""
    return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background:{PAPER_WARM};font-family:'Geist','Helvetica Neue',Arial,sans-serif;color:{INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{PAPER_WARM};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:{PAPER};border:1px solid {LINE};border-radius:24px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="background:{FUCHSIA};color:{PAPER};font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-weight:700;font-size:18px;line-height:1;text-align:center;width:36px;height:36px;border-radius:8px;">/</td>
              <td style="padding-left:12px;font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:{TEXT_TERTIARY};">liquid/clips</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 28px;">
          {body_html}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin-top:18px;">
        <tr><td align="center" style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};line-height:1.6;">
          <a href="{ctx.site_url}" style="color:{TEXT_TERTIARY};text-decoration:none;">liquidclips.app</a>
          &nbsp;·&nbsp;
          <a href="{ctx.site_url}/privacy" style="color:{TEXT_TERTIARY};text-decoration:none;">privacy</a>
          &nbsp;·&nbsp;
          <a href="{ctx.site_url}/terms" style="color:{TEXT_TERTIARY};text-decoration:none;">terms</a>
          <br>
          <span style="color:{TEXT_TERTIARY};">reply to this email — it reaches us directly.</span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _greeting(first_name: str | None) -> str:
    return f"Hi {first_name}," if first_name else "Hi,"


def _btn(label: str, url: str) -> str:
    return (
        f'<a href="{url}" '
        f'style="display:inline-block;background:{INK};color:{PAPER};'
        f'font-family:Geist,Helvetica,Arial,sans-serif;font-size:14px;font-weight:500;'
        f'text-decoration:none;padding:12px 22px;border-radius:999px;">{label}</a>'
    )


def render_welcome(*, email: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    subject = "Welcome to Liquid Clips."
    body = f"""
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 12px;color:{INK};">
  Welcome to Liquid Clips.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Liquid Clips turns long videos into ready-to-post shorts — local-first, your files never leave your machine unless you publish them. You're set up with <strong style="color:{INK};">100 free clip exports</strong> to start.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Two next steps that take about 90 seconds combined:
</p>
<ol style="font-size:15px;line-height:1.7;color:{INK};margin:0 0 24px 18px;padding:0;">
  <li><strong>Download the desktop app</strong> — drag a video in, get back clips with captions, thumbnails, and titles.</li>
  <li><strong>Open the Earn tab</strong> from inside your Whop community to see live Content Rewards bounties you can clip for.</li>
</ol>
<p style="margin:0 0 16px;">{_btn("Download Liquid Clips →", ctx.download_url)}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  100 free clip exports · cancel anytime · your files stay on your machine
</p>
"""
    text = (
        f"Welcome to Liquid Clips.\n\n{_greeting(first_name)}\n\n"
        "Liquid Clips turns long videos into ready-to-post shorts — local-first, "
        "your files never leave your machine unless you publish them. "
        "You're set up with 100 free clip exports to start.\n\n"
        f"1. Download Liquid Clips after signing into your account: {ctx.download_url}\n"
        "2. Open the Earn tab inside your Whop community for live Content Rewards bounties.\n\n"
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
