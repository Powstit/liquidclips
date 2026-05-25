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
    A privacy/security signal more than a marketing one — 'we noticed Junior
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
    """Wrap a content fragment in the Junior email chrome — brand mark at
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
              <td style="padding-left:12px;font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:{TEXT_TERTIARY};">junior</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:8px 32px 28px;">
          {body_html}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin-top:18px;">
        <tr><td align="center" style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:{TEXT_TERTIARY};line-height:1.6;">
          <a href="{ctx.site_url}" style="color:{TEXT_TERTIARY};text-decoration:none;">jnremployee.com</a>
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
    subject = "Welcome to Junior."
    body = f"""
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 12px;color:{INK};">
  Welcome to Junior.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Junior turns long videos into ready-to-post shorts — local-first, your files never leave your machine unless you publish them. You're set up with <strong style="color:{INK};">100 free clip exports</strong> to start.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Two next steps that take about 90 seconds combined:
</p>
<ol style="font-size:15px;line-height:1.7;color:{INK};margin:0 0 24px 18px;padding:0;">
  <li><strong>Download the desktop app</strong> — drag a video in, get back clips with captions, thumbnails, and titles.</li>
  <li><strong>Open the Earn tab</strong> from inside your Whop community to see live Content Rewards bounties you can clip for.</li>
</ol>
<p style="margin:0 0 16px;">{_btn("Download Junior →", ctx.download_url)}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  100 free clip exports · cancel anytime · your files stay on your machine
</p>
"""
    text = (
        f"Welcome to Junior.\n\n{_greeting(first_name)}\n\n"
        "Junior turns long videos into ready-to-post shorts — local-first, "
        "your files never leave your machine unless you publish them. "
        "You're set up with 100 free clip exports to start.\n\n"
        f"1. Download Junior after signing into your account: {ctx.download_url}\n"
        "2. Open the Earn tab inside your Whop community for live Content Rewards bounties.\n\n"
        "Reply to this email to reach us directly.\n"
        "— Junior"
    )
    return subject, _shell("Welcome to Junior", body, ctx=ctx), text


def render_subscription_activated(*, email: str, tier: str, first_name: str | None, ctx: MailContext, trial: bool = False) -> tuple[str, str, str]:
    pretty = {"solo": "Solo", "growth": "Growth", "autopilot": "Autopilot"}.get(tier, tier.capitalize())
    if trial:
        # Affiliate / Whop-trial starter pass — NOT yet a paid Solo. Junior caps
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
  Use your <strong style="color:{INK};">100 free clip exports</strong> however you like. If you use all 100 free exports first, Junior will ask you to continue on Solo before exporting more.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Download Junior after signing into your account, then drop in a video and start exporting.
</p>
<p style="margin:0 0 16px;">{_btn("Download Junior →", ctx.download_url)}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  $0 today · Solo $29.99/mo after 30 days unless you cancel · cancel any time
</p>
"""
        text = (
            f"Your 100 free clip exports are ready.\n\n{_greeting(first_name)}\n\n"
            "You're in — $0 today. Your Solo plan starts after 30 days, unless you cancel.\n\n"
            "Use your 100 free clip exports however you like. If you use all 100 free exports "
            "first, Junior will ask you to continue on Solo before exporting more.\n\n"
            f"Download Junior after signing into your account: {ctx.download_url}\n\n"
            "Reply to this email to reach us directly.\n— Junior"
        )
        return subject, _shell(subject, body, ctx=ctx), text
    pitch = {
        "solo": "Unlimited clipping. One platform connection. Publish posts manually any time.",
        "growth": "Hosted transcribe + LLM, four platform connections, multi-platform publish + schedule.",
        "autopilot": "Drip-mode across every platform, unlimited connections, project memory, founder community.",
    }.get(tier, "Your new plan is active.")
    subject = f"Junior {pretty} is live."
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">subscription active</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Junior {pretty} is live.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  {pitch}
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Open Junior on your machine — it'll pick up your new plan on next launch (or hit Sync in Settings to flip immediately).
</p>
<p style="margin:0 0 16px;">{_btn("Open dashboard →", f"{ctx.account_url}/dashboard")}</p>
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.08em;color:{TEXT_TERTIARY};margin:18px 0 0;">
  cancel anytime · manage at {ctx.account_url.replace('https://','')}/dashboard
</p>
"""
    text = (
        f"Junior {pretty} is live.\n\n{_greeting(first_name)}\n\n"
        f"{pitch}\n\n"
        "Open Junior to pick up the new plan automatically, or click Sync in Settings.\n"
        f"Dashboard: {ctx.account_url}/dashboard\n\n"
        "Reply to this email to reach us directly.\n"
        "— Junior"
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
    subject = "Junior — your plan is set to end."
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
  Your Junior subscription has been canceled and won't renew. {until_line} After that you'll drop to the Free plan — your projects on disk stay put.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  If something specifically didn't work, reply to this email — it goes straight to us and we read every one.
</p>
<p style="margin:0 0 16px;">{_btn("Re-activate any time →", f"{ctx.account_url}/upgrade")}</p>
"""
    text = (
        f"Sorry to see you go.\n\n{_greeting(first_name)}\n\n"
        "Your Junior subscription has been canceled and won't renew. "
        + (f"You keep full access until {nice_date}. " if nice_date else "You keep full access until the end of your current billing period. ")
        + "After that you'll drop to Free.\n\n"
        "If something didn't work, reply to this email — we read every one.\n"
        f"Reactivate: {ctx.account_url}/upgrade\n\n— Junior"
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
<p style="margin:0 0 16px;">{_btn("Download Junior →", ctx.download_url)}</p>
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
    subject = "Junior just activated on a new machine."
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
  Junior activated on {machine_plain}.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Quick security note — we just issued a license JWT to {machine_inline}. If that was you, ignore this. If it wasn't, sign out from every device on your dashboard and we'll rotate your license keys.
</p>
<p style="margin:0 0 16px;">{_btn("Open dashboard →", f"{ctx.account_url}/dashboard")}</p>
"""
    text = (
        f"Junior activated on {machine_label or 'a new machine'}.\n\n{_greeting(first_name)}\n\n"
        "We just issued a license JWT to this machine. If that was you, ignore. "
        "If not, sign out from every device on your dashboard.\n"
        f"Dashboard: {ctx.account_url}/dashboard\n\n— Junior"
    )
    return subject, _shell(subject, body, ctx=ctx), text


def render_bounty_approved(*, email: str, bounty_title: str, payout: str, first_name: str | None, ctx: MailContext) -> tuple[str, str, str]:
    subject = f"Your Whop submission was approved · est. {payout}"
    body = f"""
<p style="font-family:'Geist Mono',ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:{FUCHSIA};margin:0 0 8px;">submission approved</p>
<h1 style="font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:600;letter-spacing:-0.025em;line-height:1.1;margin:0 0 14px;color:{INK};">
  Clip approved · est. {payout}.
</h1>
<p style="font-size:15px;line-height:1.55;color:{INK};margin:0 0 16px;">{_greeting(first_name)}</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Your submission to <strong style="color:{INK};">{bounty_title}</strong> passed Whop's review. Payouts flow through Whop's rails on their cycle — track it on your Whop dashboard.
</p>
<p style="font-size:15px;line-height:1.6;color:{TEXT_SECONDARY};margin:0 0 22px;">
  Junior's Earn tab now shows this in the Approved column. Want to claim another bounty? Open the tab and pick the highest fit-score one matching your platforms.
</p>
<p style="margin:0 0 16px;">{_btn("Open Junior · Earn →", f"{ctx.download_url}")}</p>
"""
    text = (
        f"Clip approved · est. {payout}.\n\n{_greeting(first_name)}\n\n"
        f"Your submission to {bounty_title} passed Whop's review. "
        "Payouts flow through Whop on their cycle.\n\n"
        f"Open Junior · Earn: {ctx.download_url}\n\n— Junior"
    )
    return subject, _shell(subject, body, ctx=ctx), text
