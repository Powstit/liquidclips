"""Automated launch function heat-map.

Runs non-destructive checks for the public customer journey and production
rails. Intended for Railway cron: no card charges, posts, OAuth mutations, or
payout changes. Red failures email admins; every run can be captured to
PostHog for trend visibility.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.db import engine, session_scope
from app.models import DesktopErrorEvent, Schedule, SocialChannel, User, WebhookEventLog

log = logging.getLogger("junior.function_heatmap")

_LAST_RESULT: dict[str, Any] | None = None


def _now() -> datetime:
    now = datetime.now(timezone.utc)
    if engine.dialect.name == "sqlite":
        return now.replace(tzinfo=None)
    return now


def _gate(
    key: str,
    label: str,
    status: str,
    detail: str,
    *,
    owner: str,
    action: str | None = None,
    value: Any = None,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "status": status,
        "detail": detail,
        "owner": owner,
        "action": action,
        "value": value,
    }


def _url_gate(client: httpx.Client, key: str, label: str, url: str, *, owner: str) -> dict[str, Any]:
    try:
        res = client.get(url, follow_redirects=True)
        ok = 200 <= res.status_code < 400
        return _gate(
            key,
            label,
            "ok" if ok else "fail",
            f"HTTP {res.status_code} · {res.url}",
            owner=owner,
            action=None if ok else f"Check deployment/DNS for {url}",
            value={"url": url, "status_code": res.status_code, "final_url": str(res.url)},
        )
    except Exception as exc:  # noqa: BLE001
        return _gate(
            key,
            label,
            "fail",
            f"{type(exc).__name__}: {exc}",
            owner=owner,
            action=f"Check deployment/DNS for {url}",
            value={"url": url},
        )


def _config_gate(key: str, label: str, ok: bool, *, owner: str, detail: str) -> dict[str, Any]:
    return _gate(
        key,
        label,
        "ok" if ok else "fail",
        detail if ok else f"Missing config: {detail}",
        owner=owner,
        action=None if ok else "Set the Railway environment variable.",
    )


def run_function_heatmap(*, notify: bool = False, source: str = "manual") -> dict[str, Any]:
    """Run the heat-map once and optionally email admins on red gates."""
    global _LAST_RESULT
    s = get_settings()
    gates: list[dict[str, Any]] = []
    now = _now()
    day_ago = now - timedelta(hours=24)
    hour_ago = now - timedelta(hours=1)

    with httpx.Client(timeout=12.0, headers={"User-Agent": "Liquid Clips function heatmap"}) as client:
        gates.extend([
            _url_gate(client, "site_home", "Marketing home", s.public_site_url, owner="marketing"),
            _url_gate(client, "site_download", "Download page", s.app_download_url, owner="marketing"),
            _url_gate(client, "account_app", "Account app", s.account_site_url, owner="account-app"),
            _url_gate(client, "account_checkout", "Checkout entry", f"{s.account_site_url.rstrip('/')}/checkout", owner="account-app"),
            _url_gate(client, "account_admin_gate", "Admin sign-in gate", f"{s.account_site_url.rstrip('/')}/admin", owner="account-app"),
            _url_gate(client, "web_demo", "Demo app", "https://app.jnremployee.com", owner="marketing"),
            _url_gate(client, "partner_app", "Affiliate sign-in", s.whop_partner_dashboard_url, owner="partner"),
            _url_gate(client, "api_health", "Backend health", "https://api.jnremployee.com/health", owner="backend"),
            _url_gate(client, "campaigns_public", "Campaign catalog", "https://api.jnremployee.com/campaigns", owner="backend"),
        ])

        update_url = s.tauri_update_endpoint.strip()
        if update_url:
            gates.append(_url_gate(client, "updates_public", "Updater manifest", update_url, owner="release"))

    gates.extend([
        _config_gate("internal_secret", "Internal proxy secret", bool(s.internal_api_secret), owner="backend", detail="Account app -> backend proxy auth."),
        _config_gate("clerk_secret", "Clerk backend API", bool(s.clerk_secret_key), owner="account-app", detail="Clerk metadata/account sync."),
        _config_gate("clerk_webhook", "Clerk webhook secret", bool(s.clerk_webhook_secret), owner="account-app", detail="Signup and billing webhooks."),
        _config_gate("whop_api", "Whop API", bool(s.whop_api_key), owner="earn", detail="Whop rewards/affiliate reconciliation."),
        _config_gate("whop_webhook", "Whop webhook secret", bool(s.whop_webhook_secret), owner="earn", detail="Whop purchase and payout events."),
        _config_gate("resend", "Resend email", bool(s.resend_api_key), owner="notifications", detail="Customer/admin email alerts."),
        _config_gate("posthog", "PostHog", bool(s.posthog_key), owner="analytics", detail="Launch telemetry."),
        _config_gate("stripe_connect", "Stripe Connect", bool(s.stripe_secret_key), owner="payouts", detail="Non-Whop affiliate payout onboarding."),
        _config_gate("ayrshare", "Ayrshare API", bool(os.environ.get("AYRSHARE_API_KEY", "").strip()), owner="publish", detail="Multi-channel publishing."),
        _config_gate(
            "ayrshare_linker",
            "Ayrshare OAuth linker",
            bool(os.environ.get("AYRSHARE_JWT_PRIVATE_KEY", "").strip() and os.environ.get("AYRSHARE_DOMAIN", "").strip()),
            owner="publish",
            detail="In-app social account linking.",
        ),
    ])

    with session_scope() as db:
        try:
            users_total = db.query(User).count()
            gates.append(_gate("db", "Database", "ok", f"Connected ({engine.dialect.name}) · {users_total} user row(s).", owner="backend", value={"users": users_total}))
        except Exception as exc:  # noqa: BLE001
            gates.append(_gate("db", "Database", "fail", f"DB query failed: {type(exc).__name__}", owner="backend", action="Check DATABASE_URL / Railway Postgres."))

        try:
            error_channels = db.query(SocialChannel).filter(SocialChannel.status == "error").count()
            active_channels = db.query(SocialChannel).filter(SocialChannel.status == "active").count()
            gates.append(_gate(
                "social_channels",
                "Connected social channels",
                "fail" if error_channels else "ok",
                f"{active_channels} active · {error_channels} error.",
                owner="publish",
                action="Open Admin HQ -> Postiz/Schedule and inspect errored channels." if error_channels else None,
                value={"active": active_channels, "error": error_channels},
            ))
        except Exception as exc:  # noqa: BLE001
            gates.append(_gate("social_channels", "Connected social channels", "fail", f"Channel table check failed: {type(exc).__name__}", owner="publish", action="Run backend migrations / Railway boot migrations."))

        try:
            failed_schedules = db.query(Schedule).filter(Schedule.status == "failed", Schedule.updated_at >= day_ago).count()
            stuck_uploading = db.query(Schedule).filter(Schedule.status == "uploading", Schedule.updated_at <= hour_ago).count()
            gates.append(_gate(
                "schedule_queue",
                "Schedule queue",
                "fail" if failed_schedules or stuck_uploading else "ok",
                f"{failed_schedules} failed in 24h · {stuck_uploading} uploading >1h.",
                owner="publish",
                action="Inspect failed/stuck schedule rows." if failed_schedules or stuck_uploading else None,
                value={"failed_24h": failed_schedules, "stuck_uploading": stuck_uploading},
            ))
        except Exception as exc:  # noqa: BLE001
            gates.append(_gate("schedule_queue", "Schedule queue", "fail", f"Schedule table check failed: {type(exc).__name__}", owner="publish", action="Run backend migrations / Railway boot migrations."))

        try:
            webhook_failures = db.query(WebhookEventLog).filter(WebhookEventLog.status == "failed", WebhookEventLog.received_at >= day_ago).count()
            gates.append(_gate(
                "webhooks",
                "Webhook processing",
                "fail" if webhook_failures else "ok",
                f"{webhook_failures} failed webhook(s) in 24h.",
                owner="backend",
                action="Open Admin HQ -> Webhooks filtered to failed." if webhook_failures else None,
                value={"failed_24h": webhook_failures},
            ))
        except Exception as exc:  # noqa: BLE001
            gates.append(_gate("webhooks", "Webhook processing", "fail", f"Webhook table check failed: {type(exc).__name__}", owner="backend", action="Run backend migrations / Railway boot migrations."))

        try:
            desktop_errors = db.query(DesktopErrorEvent).filter(DesktopErrorEvent.created_at >= day_ago).count()
            gates.append(_gate(
                "desktop_errors",
                "Desktop error telemetry",
                "fail" if desktop_errors >= 5 else "warn" if desktop_errors else "ok",
                f"{desktop_errors} desktop error event(s) in 24h.",
                owner="desktop",
                action="Open Admin HQ -> Bugs." if desktop_errors else None,
                value={"events_24h": desktop_errors},
            ))
        except Exception as exc:  # noqa: BLE001
            gates.append(_gate("desktop_errors", "Desktop error telemetry", "fail", f"Desktop error table check failed: {type(exc).__name__}", owner="desktop", action="Run backend migrations / Railway boot migrations."))

    failures = [g for g in gates if g["status"] == "fail"]
    warnings = [g for g in gates if g["status"] == "warn"]
    overall = "fail" if failures else "warn" if warnings else "ok"
    score = round(100 * sum(1 for g in gates if g["status"] == "ok") / max(1, len(gates)))
    result = {
        "overall": overall,
        "score": score,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "gates": gates,
        "failures": len(failures),
        "warnings": len(warnings),
    }
    _LAST_RESULT = result
    _capture_heatmap(result)
    if notify and failures:
        _notify_admin_inbox(result)
        _email_failures(result)
    return result


def latest_function_heatmap() -> dict[str, Any] | None:
    return _LAST_RESULT


# Customer-facing surface map. Only these gates are visible on /status — every
# vendor-secret check (Clerk, Whop, Resend, Stripe, PostHog, Ayrshare, etc.) is
# intentionally hidden so the public page is not a vendor-stack recon surface.
# Labels here are neutral product surfaces, NOT internal team/route names.
_PUBLIC_GATE_LABELS: dict[str, str] = {
    "site_home": "Marketing site",
    "site_download": "Download page",
    "account_app": "Account portal",
    "account_checkout": "Checkout",
    "web_demo": "Demo workspace",
    "partner_app": "Affiliate portal",
    "api_health": "API",
    "campaigns_public": "Campaign catalog",
    "updates_public": "Desktop updater",
    "db": "Database",
    "social_channels": "Social channels",
    "schedule_queue": "Scheduler",
    "webhooks": "Webhooks",
    "desktop_errors": "Desktop client",
}


def public_function_heatmap(result: dict[str, Any]) -> dict[str, Any]:
    """Return a customer-safe status payload with no internals.

    Admin HQ gets full gate detail; the public page must not leak URLs, stack
    text, vendor secret names, owner emails, DB counts, or remediation notes.
    Recomputes overall + score from the surface-only subset so a missing vendor
    env never marks the public page red on its own.
    """
    gates: list[dict[str, str]] = []
    for gate in result.get("gates", []):
        if not isinstance(gate, dict):
            continue
        key = str(gate.get("key") or "")
        if key not in _PUBLIC_GATE_LABELS:
            continue
        raw_status = str(gate.get("status") or "warn")
        status_value = raw_status if raw_status in {"ok", "warn", "fail"} else "warn"
        gates.append({
            "key": key,
            "label": _PUBLIC_GATE_LABELS[key],
            "status": status_value,
        })
    status_order = {"fail": 0, "warn": 1, "ok": 2}
    gates.sort(key=lambda g: (status_order.get(str(g["status"]), 9), str(g["label"])))
    failures = sum(1 for g in gates if g["status"] == "fail")
    warnings = sum(1 for g in gates if g["status"] == "warn")
    overall = "fail" if failures else "warn" if warnings else "ok"
    score = round(100 * sum(1 for g in gates if g["status"] == "ok") / max(1, len(gates)))
    return {
        "overall": overall,
        "score": score,
        "generated_at": result.get("generated_at"),
        "checks": len(gates),
        "failures": failures,
        "warnings": warnings,
        "gates": gates,
        "message": "All visible checks are automated and non-destructive. Internal diagnostics are shown only to Liquid Clips admins.",
    }


def _capture_heatmap(result: dict[str, Any]) -> None:
    try:
        from app.analytics import capture

        capture(
            user_id="system:railway:function-heatmap",
            event="function_heatmap_failed" if result["overall"] == "fail" else "function_heatmap_checked",
            properties={
                "overall": result["overall"],
                "score": result["score"],
                "failures": result["failures"],
                "warnings": result["warnings"],
                "source": result["source"],
            },
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("[function_heatmap] PostHog capture failed: %s", exc)


def _email_failures(result: dict[str, Any]) -> None:
    try:
        from app.mailer import send_admin_function_heatmap_alert

        send_admin_function_heatmap_alert(result)
    except Exception as exc:  # noqa: BLE001
        log.warning("[function_heatmap] admin email failed: %s", exc)


def _notify_admin_inbox(result: dict[str, Any]) -> None:
    """Write a high-priority inbox alert for every admin account in-app.

    Railway can run this every five hours, so alerts are deduped per UTC hour
    and admin user. Email still fans out separately; this keeps the product
    itself showing the same red-gate state without relying on an inbox crawl.
    """
    try:
        from app.features import ADMIN_EMAILS
        from app.routes.notifications import write_notification

        failures = [g for g in result.get("gates", []) if isinstance(g, dict) and g.get("status") == "fail"]
        if not failures:
            return

        score = result.get("score", "—")
        top = failures[:3]
        labels = ", ".join(str(g.get("label") or g.get("key") or "Unknown") for g in top)
        extra = len(failures) - len(top)
        if extra > 0:
            labels = f"{labels}, +{extra} more"
        body = (
            f"Railway's 5-hour launch heat-map found {len(failures)} red gate(s). "
            f"Score {score}/100. First failures: {labels}. Open Admin HQ -> Function Heat Map."
        )
        bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H")
        admin_emails = {e.strip().lower() for e in ADMIN_EMAILS if e and e.strip()}

        with session_scope() as db:
            admins = [u for u in db.query(User).all() if (u.email or "").strip().lower() in admin_emails]
            for admin in admins:
                write_notification(
                    db,
                    user_id=admin.id,
                    category="system_update",
                    title="Function heat-map found red gates",
                    body=body[:600],
                    priority="high",
                    action_kind="open_admin",
                    action_data={
                        "panel": "function_heatmap",
                        "score": score,
                        "failures": len(failures),
                        "source": result.get("source"),
                    },
                    external_dedup_key=f"function-heatmap-red-{bucket}-{admin.id}",
                )
    except Exception as exc:  # noqa: BLE001
        log.warning("[function_heatmap] admin inbox alert failed: %s", exc)
