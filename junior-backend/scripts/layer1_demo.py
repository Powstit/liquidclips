"""Layer 1 · reliability sprint · live proof harness.

Not a test — a scripted walk of the dead-letter, retry, reconciliation and
breadcrumb paths that emits log lines proving each mechanism fires against
a real (in-memory) SQLite database. Emits three artefacts to stdout, one
per section header, so a single invocation produces every text log the
PROOF.md file asserts on.

Run:  .venv/bin/python scripts/layer1_demo.py

Written 2026-07-04 for Layer 1 receipt capture.
"""

from __future__ import annotations

import json
import logging
import sys
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, ".")

# Configure a stdout-only logger so the demo output is deterministic.
logging.basicConfig(
    level=logging.INFO,
    stream=sys.stdout,
    format="[%(asctime)sZ] %(levelname)s %(name)s · %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    force=True,
)

demo_log = logging.getLogger("layer1_demo")

from app.db import Base
import app.db as _appdb
from app.models import User, WebhookDeadLetter, WebhookEvent
from app.routes import webhooks_whop

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
Base.metadata.create_all(bind=engine)
Session = sessionmaker(bind=engine, expire_on_commit=False, future=True)

# The dead-letter writer opens its own SessionLocal — point it at ours.
_appdb.SessionLocal = Session


# ─── SECTION 1 · Dead-letter write + retry ─────────────────────────
demo_log.info("=== SECTION 1 · dead-letter write + retry ===")

session = Session()
user = User(
    id=uuid.uuid4().hex,
    clerk_id="user_demo",
    email="demo@example.com",
    tier="free",
    subscription_status="trial",
)
session.add(user)
session.commit()

msg_id = f"msg_{uuid.uuid4().hex[:12]}"
event_type = "payment.succeeded"
payload = {
    "id": msg_id,
    "type": event_type,
    "data": {
        "id": msg_id,
        "plan": {"id": "plan_qe8AFXj9J3SWi", "title": None},
        "user": {"email": user.email, "id": "user_whop_demo"},
        "renewal_period_end": int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
    },
}
payload_json = json.dumps(payload)

dl_id = webhooks_whop._record_dead_letter(
    session,
    event_id=msg_id,
    event_type=event_type,
    payload_json=payload_json,
    error="synthetic_upstream_500_for_demo",
)
demo_log.info("dead_letter_written · id=%s · event_id=%s · event_type=%s", dl_id, msg_id, event_type)

# Verify it landed
dl_row = session.query(WebhookDeadLetter).filter_by(event_id=msg_id).one()
demo_log.info("dead_letter row · resolved_at=%s · retry_count=%s · error=%r",
              dl_row.resolved_at, dl_row.retry_count, dl_row.error)

# Retry — because the underlying handlers WILL work now (no monkeypatched failure),
# retry should succeed.
ok, note = webhooks_whop.retry_dead_letter(session, dl_id)
demo_log.info("retry_dead_letter · ok=%s · note=%s", ok, note)
if note == "retry_succeeded":
    demo_log.info("Dead-letter path proven end-to-end · retry_succeeded fired")
else:
    demo_log.error("Dead-letter retry did NOT surface retry_succeeded · investigate")


# ─── SECTION 2 · Reconciliation with synthetic drift ───────────────
demo_log.info("=== SECTION 2 · reconciliation synthetic drift ===")

user_aligned = User(
    id=uuid.uuid4().hex,
    clerk_id="user_aligned",
    email="aligned@example.com",
    tier="solo",
    subscription_status="active",
    whop_user_id="user_whop_aligned",
    paid_until=datetime(2026, 8, 1, tzinfo=timezone.utc),
)
user_drifted = User(
    id=uuid.uuid4().hex,
    clerk_id="user_drifted",
    email="drifted@example.com",
    tier="solo",
    subscription_status="active",
    whop_user_id="user_whop_drifted",
    paid_until=datetime(2026, 7, 4, tzinfo=timezone.utc),  # our stale value
)
session.add_all([user_aligned, user_drifted])
session.commit()


def _synthetic_whop_memberships(_since):
    """Whop's own view — aligned agrees, drifted has a NEWER renewal on Whop."""
    return [
        {
            "user": {"id": "user_whop_aligned", "email": user_aligned.email},
            "status": "active",
            "valid_until": int(datetime(2026, 8, 1, tzinfo=timezone.utc).timestamp()),
            "plan": {"id": "plan_qe8AFXj9J3SWi"},
        },
        {
            "user": {"id": "user_whop_drifted", "email": user_drifted.email},
            "status": "active",
            "valid_until": int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp()),
            "plan": {"id": "plan_qe8AFXj9J3SWi"},
        },
    ]


summary = webhooks_whop.reconcile_whop_memberships(
    session,
    fetch_memberships=_synthetic_whop_memberships,
    logger=demo_log,
)
demo_log.info("reconciliation summary · checked=%s · drift_pct=%s · severity=%s",
              summary["checked"], summary["drift_pct"], summary["severity"])


# ─── SECTION 3 · Sentry breadcrumb capture ─────────────────────────
demo_log.info("=== SECTION 3 · Sentry breadcrumb capture ===")

# Substitute a shim so add_breadcrumb collects into a local list.
crumbs: list[dict] = []
class _ShimSentry:
    @staticmethod
    def add_breadcrumb(*, category, message, level=None, data=None):
        crumbs.append({"category": category, "message": message, "data": data or {}})

import sys as _sys
_sys.modules["sentry_sdk"] = _ShimSentry

# Fire a payment_succeeded through the handler directly (no HTTP round-trip).
webhooks_whop._handle_payment_succeeded(session, {
    "id": f"pay_{uuid.uuid4().hex[:12]}",
    "plan": {"id": "plan_qe8AFXj9J3SWi"},
    "user": {"email": user.email, "id": "user_whop_demo"},
    "renewal_period_end": int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp()),
})

for c in crumbs:
    demo_log.info("breadcrumb · category=%s · message=%s · data=%s",
                  c["category"], c["message"], c["data"])

# Explicit summary line — includes the exact category the PROOF.md asserts on.
categories = sorted({c["category"] for c in crumbs})
demo_log.info("breadcrumb categories seen · %s", categories)

demo_log.info("=== END OF LAYER 1 PROOF HARNESS ===")
