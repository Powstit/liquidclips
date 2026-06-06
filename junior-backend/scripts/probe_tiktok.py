"""TikTok channel-link probe — end-to-end observability for one user.

Surfaces the EXACT state of a user's TikTok SocialChannel by cross-checking:
  1. Local DB row (SocialChannel + parent User)
  2. Live Ayrshare `/user` response for the channel's profile key
  3. Recent Ayrshare webhook deliveries (WebhookEvent provider='ayrshare')
  4. The `_fetch_handle_from_ayrshare` helper used by routes/channels.py
     (so we see exactly what /channels/<id>/refresh would return right now)

Then prints a single structured report with discrepancies highlighted and
ONE recommended next action. Run when a user says "TikTok still failing".

Resolves user by exactly ONE of --user-email / --clerk-id / --channel-id.

Usage (from junior-backend/):
    source ~/.claude-credentials/clerk.env  # or whatever has AYRSHARE_API_KEY
    python3 scripts/probe_tiktok.py --user-email danieldiyepriye@gmail.com
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Make `app.*` importable when run as `python3 scripts/probe_tiktok.py`
# from the junior-backend/ working directory.
_HERE = Path(__file__).resolve().parent
_BACKEND_ROOT = _HERE.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import httpx  # noqa: E402

from app import ayrshare  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import SocialChannel, User, WebhookEvent  # noqa: E402

# ── tiny TTY-aware colour helpers ────────────────────────────────────────
_TTY = sys.stdout.isatty()


def _c(code: str, s: str) -> str:
    return f"\033[{code}m{s}\033[0m" if _TTY else s


def red(s: str) -> str:      return _c("31", s)
def green(s: str) -> str:    return _c("32", s)
def yellow(s: str) -> str:   return _c("33", s)
def cyan(s: str) -> str:     return _c("36", s)
def bold(s: str) -> str:     return _c("1", s)
def dim(s: str) -> str:      return _c("2", s)


def _hr(label: str) -> str:
    bar = "─" * max(0, 60 - len(label))
    return bold(f"── {label} {bar}")


def _fmt_dt(dt: datetime | None) -> str:
    if dt is None:
        return dim("never")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")


def _minutes_since(dt: datetime | None) -> float | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).total_seconds() / 60.0


# ── arg parsing ──────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Probe a user's TikTok SocialChannel end-to-end (DB + Ayrshare + webhooks)."
    )
    grp = p.add_mutually_exclusive_group(required=True)
    grp.add_argument("--user-email", help="resolve by users.email")
    grp.add_argument("--clerk-id", help="resolve by users.clerk_id")
    grp.add_argument("--channel-id", help="resolve by social_channels.id directly")
    p.add_argument(
        "--webhook-window",
        type=int,
        default=10,
        help="how many recent ayrshare WebhookEvent rows to show (default 10)",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="emit the report as JSON instead of human-readable text",
    )
    return p.parse_args()


# ── DB resolution ────────────────────────────────────────────────────────
def resolve_channel(
    db, *, user_email: str | None, clerk_id: str | None, channel_id: str | None
) -> tuple[User | None, SocialChannel | None, str]:
    """Returns (user, tiktok_channel, note). note is a human reason if either is None."""
    if channel_id:
        ch = db.get(SocialChannel, channel_id)
        if not ch:
            return None, None, f"no SocialChannel row with id={channel_id}"
        if ch.platform != "tiktok":
            return None, None, (
                f"channel {channel_id} is platform={ch.platform!r}, not 'tiktok'"
            )
        user = db.get(User, ch.user_id)
        return user, ch, "ok"

    user: User | None = None
    if user_email:
        user = db.query(User).filter(User.email == user_email).first()
        if not user:
            return None, None, f"no User row with email={user_email!r}"
    elif clerk_id:
        user = db.query(User).filter(User.clerk_id == clerk_id).first()
        if not user:
            return None, None, f"no User row with clerk_id={clerk_id!r}"

    if user is None:
        return None, None, "no user identifier given"

    channels = (
        db.query(SocialChannel)
        .filter(SocialChannel.user_id == user.id)
        .filter(SocialChannel.platform == "tiktok")
        .filter(SocialChannel.status != "deleted")
        .order_by(SocialChannel.created_at.asc())
        .all()
    )
    if not channels:
        return user, None, "user has no TikTok SocialChannel rows"
    if len(channels) > 1:
        # Pick the first; flag it in the report.
        return user, channels[0], (
            f"user has {len(channels)} TikTok channels — showing oldest "
            f"({channels[0].id}). Pass --channel-id to target a specific one."
        )
    return user, channels[0], "ok"


# ── Ayrshare live probe ──────────────────────────────────────────────────
def fetch_ayrshare_user(profile_key: str) -> dict[str, Any]:
    """Direct GET /user with the channel's profile key — same call the
    helper makes, but returns the full body + http meta for the report."""
    try:
        with httpx.Client(timeout=ayrshare.DEFAULT_TIMEOUT) as client:
            r = client.get(
                f"{ayrshare.AYRSHARE_BASE}/user",
                headers=ayrshare._headers(profile_key),
            )
        body: Any
        try:
            body = r.json()
        except ValueError:
            body = {"_raw": r.text[:400]}
        return {
            "ok": r.status_code == 200,
            "status_code": r.status_code,
            "body": body,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "status_code": None, "body": None, "error": str(exc)}


def extract_tiktok_state(ayr_body: dict[str, Any] | None) -> dict[str, Any]:
    """Distil what Ayrshare's /user response says about TikTok specifically."""
    out: dict[str, Any] = {
        "linked": False,
        "handle": None,
        "display_name": None,
        "user_image": None,
        "raw_token_fields": {},
    }
    if not isinstance(ayr_body, dict):
        return out

    display_names = ayr_body.get("displayNames") or {}
    if isinstance(display_names, dict) and "tiktok" in display_names:
        out["display_name"] = str(display_names["tiktok"])

    active = ayr_body.get("activeSocialAccounts") or []
    if isinstance(active, list):
        out["linked"] = any(str(p).lower() == "tiktok" for p in active)
    elif isinstance(active, dict):
        if "tiktok" in active:
            out["linked"] = True
            out["handle"] = str(active["tiktok"]) if active["tiktok"] else None

    # Ayrshare nests handles under platform-keyed objects on some plans.
    for key in ("tiktok", "tiktokDetails", "tiktokAccount"):
        v = ayr_body.get(key)
        if isinstance(v, dict):
            out["raw_token_fields"][key] = {
                k: v.get(k) for k in ("username", "displayName", "userImage", "id") if k in v
            }
            out["handle"] = out["handle"] or v.get("username") or v.get("displayName")
            out["user_image"] = out["user_image"] or v.get("userImage")
            out["linked"] = True

    return out


# ── webhook timeline ─────────────────────────────────────────────────────
def recent_ayrshare_webhooks(db, limit: int) -> list[WebhookEvent]:
    """Last N Ayrshare webhook events. WebhookEvent doesn't carry the
    profile key directly — Ayrshare's payload-level idempotency keys don't
    include it — so we surface the org-wide tail. This is still the
    fastest way to spot a stalled delivery loop."""
    return (
        db.query(WebhookEvent)
        .filter(WebhookEvent.provider == "ayrshare")
        .order_by(WebhookEvent.received_at.desc())
        .limit(limit)
        .all()
    )


# ── report assembly ──────────────────────────────────────────────────────
def build_report(
    *,
    user: User | None,
    channel: SocialChannel | None,
    note: str,
    ayr: dict[str, Any] | None,
    tiktok_state: dict[str, Any] | None,
    helper_result: tuple[str | None, str] | None,
    webhooks: list[WebhookEvent],
) -> dict[str, Any]:
    db_block: dict[str, Any] = {}
    if channel:
        db_block = {
            "channel_id": channel.id,
            "user_id": channel.user_id,
            "platform": channel.platform,
            "status": channel.status,
            "handle": channel.handle,
            "label": channel.label,
            "ayrshare_profile_key_present": bool(channel.ayrshare_profile_key),
            "ayrshare_profile_key_tail": (
                channel.ayrshare_profile_key[-6:] if channel.ayrshare_profile_key else None
            ),
            "ayrshare_ref_id": channel.ayrshare_ref_id,
            "last_refreshed_at": channel.last_refreshed_at.isoformat() if channel.last_refreshed_at else None,
            "minutes_since_refresh": _minutes_since(channel.last_refreshed_at),
            "created_at": channel.created_at.isoformat() if channel.created_at else None,
            "total_posts": channel.total_posts,
        }
    user_block: dict[str, Any] = {}
    if user:
        user_block = {
            "id": user.id,
            "email": user.email,
            "clerk_id": user.clerk_id,
            "tier": user.tier,
        }

    ayr_block: dict[str, Any] = {}
    if ayr is not None:
        ayr_block = {
            "ok": ayr.get("ok"),
            "status_code": ayr.get("status_code"),
            "error": ayr.get("error"),
            "tiktok": tiktok_state or {},
        }

    helper_block: dict[str, Any] = {}
    if helper_result is not None:
        helper_block = {
            "handle": helper_result[0],
            "status": helper_result[1],
        }

    webhook_block = [
        {
            "received_at": w.received_at.isoformat() if w.received_at else None,
            "external_id": w.external_id,
            "event_type": w.event_type,
            "body_hash_tail": w.body_hash[-8:] if w.body_hash else None,
        }
        for w in webhooks
    ]

    discrepancies: list[str] = []
    action = "no action — channel looks healthy"

    if channel and ayr is not None and tiktok_state is not None:
        # 1. DB status vs Ayrshare linkage
        db_status = channel.status
        ayr_linked = bool(tiktok_state.get("linked"))
        if db_status == "active" and not ayr_linked:
            discrepancies.append(
                "DB says status=active but Ayrshare /user shows NO TikTok in activeSocialAccounts."
            )
            action = (
                "Reset channel.status to 'pending_link' and resend the Ayrshare linker JWT "
                "(POST /channels/<id>/link-url) so the user re-OAuths TikTok."
            )
        elif db_status in ("pending_link", "error") and ayr_linked:
            discrepancies.append(
                f"Ayrshare HAS TikTok linked but DB still says status={db_status!r}."
            )
            action = (
                "Call POST /channels/<id>/refresh — the link succeeded but the DB never caught up. "
                "If that 500s, run the refresh path manually with the helper result above."
            )

        # 2. Handle drift
        ayr_handle = tiktok_state.get("handle") or tiktok_state.get("display_name")
        if ayr_linked and ayr_handle and channel.handle and ayr_handle != channel.handle:
            discrepancies.append(
                f"Handle drift — DB={channel.handle!r} vs Ayrshare={ayr_handle!r}."
            )
            if action.startswith("no action"):
                action = "POST /channels/<id>/refresh to pull the latest handle from Ayrshare."
        if ayr_linked and ayr_handle and not channel.handle:
            discrepancies.append(
                f"Ayrshare has handle={ayr_handle!r} but DB.handle is NULL."
            )
            if action.startswith("no action"):
                action = "POST /channels/<id>/refresh to backfill handle."

        # 3. Stale refresh
        mins = _minutes_since(channel.last_refreshed_at)
        if mins is None:
            discrepancies.append("last_refreshed_at is NULL — channel has never been refreshed.")
            if action.startswith("no action"):
                action = "POST /channels/<id>/refresh once to populate last_refreshed_at."
        elif mins > 60 * 24:
            discrepancies.append(
                f"last_refreshed_at was {mins/60:.1f}h ago — refresh job may be stuck."
            )

        # 4. Helper vs raw HTTP disagreement
        if helper_result is not None:
            h_handle, h_status = helper_result
            if h_status == "error":
                discrepancies.append(
                    "_fetch_handle_from_ayrshare returned status='error' — the helper hit "
                    "an exception or non-200. Live HTTP call result above is the ground truth."
                )
                action = (
                    "Check AYRSHARE_API_KEY is present in this shell + the profile key is "
                    "valid. Re-run after `source ~/.claude-credentials/ayrshare.env`."
                )
            elif h_status == "pending_link" and ayr_linked:
                discrepancies.append(
                    "Helper says pending_link but Ayrshare /user does list TikTok — payload "
                    "shape may have changed; check displayNames / activeSocialAccounts."
                )

        # 5. Ayrshare unreachable
        if not ayr.get("ok"):
            sc = ayr.get("status_code")
            err = ayr.get("error")
            discrepancies.append(
                f"Ayrshare /user returned non-200 (status={sc} error={err}). "
                "Cannot trust DB row until this is resolved."
            )
            action = (
                "Re-export AYRSHARE_API_KEY and re-run. If 401: profile key is dead, "
                "force re-link. If 5xx: Ayrshare-side outage — retry in a few minutes."
            )

    return {
        "user": user_block,
        "channel": db_block,
        "ayrshare": ayr_block,
        "helper": helper_block,
        "webhooks": webhook_block,
        "discrepancies": discrepancies,
        "recommended_action": action,
        "resolution_note": note,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ── pretty printing ──────────────────────────────────────────────────────
def print_human_report(rep: dict[str, Any]) -> None:
    print()
    print(bold(cyan("TikTok Channel Probe")))
    print(dim(f"generated_at: {rep['generated_at']}"))
    if rep["resolution_note"] != "ok":
        print(yellow(f"note: {rep['resolution_note']}"))
    print()

    # USER
    print(_hr("USER"))
    if rep["user"]:
        u = rep["user"]
        print(f"  id          : {u['id']}")
        print(f"  email       : {u['email']}")
        print(f"  clerk_id    : {u['clerk_id']}")
        print(f"  tier        : {u['tier']}")
    else:
        print(red("  no user resolved"))
    print()

    # CHANNEL
    print(_hr("DB · SocialChannel"))
    ch = rep["channel"]
    if ch:
        print(f"  channel_id        : {ch['channel_id']}")
        print(f"  platform          : {ch['platform']}")
        status_render = ch["status"]
        if status_render == "active":
            status_render = green(status_render)
        elif status_render in ("error", "deleted"):
            status_render = red(status_render)
        else:
            status_render = yellow(status_render)
        print(f"  status            : {status_render}")
        print(f"  handle            : {ch['handle'] or dim('NULL')}")
        print(f"  label             : {ch['label']}")
        print(
            f"  profile_key       : "
            + (green(f"set (...{ch['ayrshare_profile_key_tail']})") if ch["ayrshare_profile_key_present"] else red("MISSING"))
        )
        print(f"  ayrshare_ref_id   : {ch['ayrshare_ref_id'] or dim('NULL')}")
        last_ref = ch["last_refreshed_at"] or dim("never")
        mins = ch["minutes_since_refresh"]
        suffix = f" ({mins:.1f}m ago)" if mins is not None else ""
        print(f"  last_refreshed_at : {last_ref}{suffix}")
        print(f"  created_at        : {ch['created_at']}")
        print(f"  total_posts       : {ch['total_posts']}")
    else:
        print(red("  no TikTok channel resolved"))
    print()

    # AYRSHARE
    print(_hr("Ayrshare · GET /user"))
    a = rep["ayrshare"]
    if a:
        if a.get("ok"):
            print(green(f"  HTTP {a['status_code']} OK"))
        else:
            print(red(f"  HTTP {a.get('status_code')} ERROR — {a.get('error') or 'non-200'}"))
        t = a.get("tiktok") or {}
        linked = t.get("linked")
        print(f"  tiktok linked     : " + (green("yes") if linked else red("no")))
        print(f"  tiktok handle     : {t.get('handle') or dim('NULL')}")
        print(f"  tiktok displayName: {t.get('display_name') or dim('NULL')}")
        if t.get("raw_token_fields"):
            print(f"  raw fields        : {json.dumps(t['raw_token_fields'], default=str)[:240]}")
    else:
        print(dim("  not probed (missing channel or profile key)"))
    print()

    # HELPER
    print(_hr("Helper · _fetch_handle_from_ayrshare"))
    h = rep["helper"]
    if h:
        h_status = h["status"]
        rendered = green(h_status) if h_status == "active" else (red(h_status) if h_status == "error" else yellow(h_status))
        print(f"  returns           : (handle={h['handle']!r}, status={rendered})")
    else:
        print(dim("  not invoked"))
    print()

    # WEBHOOKS
    print(_hr(f"Recent Ayrshare WebhookEvents (last {len(rep['webhooks'])})"))
    if not rep["webhooks"]:
        print(dim("  none — Ayrshare has not delivered any webhooks to this backend"))
    else:
        for w in rep["webhooks"]:
            ts = w["received_at"] or "?"
            ext = w["external_id"]
            print(f"  {ts}  {w['event_type']:<12}  {ext}")
    print()

    # DISCREPANCIES
    print(_hr("Discrepancies"))
    if not rep["discrepancies"]:
        print(green("  none — DB and Ayrshare agree."))
    else:
        for d in rep["discrepancies"]:
            print(red(f"  ! {d}"))
    print()

    # ACTION
    print(_hr("Recommended action"))
    print(bold(f"  → {rep['recommended_action']}"))
    print()


# ── main ─────────────────────────────────────────────────────────────────
def main() -> int:
    args = parse_args()
    settings = get_settings()
    # database_url comes from app.config.settings → env DATABASE_URL.
    db_url_hint = settings.database_url
    if "@" in db_url_hint:
        # crude masking for "postgres://user:pw@host/db" style strings
        head, tail = db_url_hint.split("@", 1)
        if "://" in head:
            scheme, creds = head.split("://", 1)
            db_url_hint = f"{scheme}://***@{tail}"
    print(dim(f"db: {db_url_hint}"), file=sys.stderr)

    if not ayrshare.is_configured():
        print(
            yellow(
                "warning: AYRSHARE_API_KEY not set — live Ayrshare probe will fail. "
                "Source ~/.claude-credentials/ayrshare.env (or equivalent) and re-run."
            ),
            file=sys.stderr,
        )

    db = SessionLocal()
    try:
        user, channel, note = resolve_channel(
            db,
            user_email=args.user_email,
            clerk_id=args.clerk_id,
            channel_id=args.channel_id,
        )

        ayr: dict[str, Any] | None = None
        tiktok_state: dict[str, Any] | None = None
        helper_result: tuple[str | None, str] | None = None

        if channel and channel.ayrshare_profile_key:
            ayr = fetch_ayrshare_user(channel.ayrshare_profile_key)
            tiktok_state = extract_tiktok_state(ayr.get("body") if isinstance(ayr.get("body"), dict) else None)

            # Invoke the production helper so we see what /channels/<id>/refresh
            # would actually persist right now.
            try:
                from app.routes.channels import _fetch_handle_from_ayrshare
                helper_result = _fetch_handle_from_ayrshare(
                    channel.ayrshare_profile_key, channel.platform
                )
            except Exception as exc:  # noqa: BLE001
                helper_result = (None, f"exception: {exc!s}")

        webhooks = recent_ayrshare_webhooks(db, args.webhook_window)

        report = build_report(
            user=user,
            channel=channel,
            note=note,
            ayr=ayr,
            tiktok_state=tiktok_state,
            helper_result=helper_result,
            webhooks=webhooks,
        )

        if args.json:
            print(json.dumps(report, indent=2, default=str))
        else:
            print_human_report(report)

        # Exit non-zero if we found discrepancies or couldn't resolve.
        if not channel or report["discrepancies"]:
            return 1
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
