"""Junior Backend entry point.

Locally: `uvicorn app.main:app --reload --port 8000`
Railway: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.cron import start_cron, stop_cron
from app.db import Base, engine
from app.routes import admin, affiliate, connections, desktop, me, notifications, onboarding, publish, schedules, sync, telemetry, transcribe, updates, usage, webhooks_clerk, webhooks_whop, whop

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Auto-create tables locally so the dev loop is fast. Alembic owns schema
    # in production — we drop the create_all once the first migration is in.
    Base.metadata.create_all(bind=engine)
    # No alembic yet: create_all adds missing TABLES but not new COLUMNS on
    # existing tables. Idempotently ensure every column added after a table's
    # first deploy exists in prod (Postgres). ADD COLUMN IF NOT EXISTS is a
    # no-op when the column already exists; NOT NULL columns carry a DEFAULT so
    # they backfill existing rows. Each runs in its own transaction so one
    # failure can't abort the rest. New TABLES (claims, webhook logs, pending
    # memberships, telemetry) are created whole by create_all above.
    import logging as _logging
    from sqlalchemy import text as _text

    _COLUMN_MIGRATIONS = [
        # users — billing / affiliate / whop / starter-pass columns added over time
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whop_user_id varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS tier varchar NOT NULL DEFAULT 'free'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS founder_flag boolean NOT NULL DEFAULT false",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS affiliate_id varchar",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status varchar NOT NULL DEFAULT 'trial'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at timestamptz NOT NULL DEFAULT now()",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS paid_until timestamptz",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_exports_used integer NOT NULL DEFAULT 0",
        # schedules — retry policy + postiz result columns added after it shipped
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'pending'",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS postiz_post_id varchar",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS post_url varchar",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS error text",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0",
        "ALTER TABLE schedules ADD COLUMN IF NOT EXISTS next_retry_at timestamptz",
    ]
    if engine.dialect.name == "postgresql":
        for _stmt in _COLUMN_MIGRATIONS:
            try:
                with engine.begin() as _conn:
                    _conn.execute(_text(_stmt))
            except Exception as _e:  # noqa: BLE001
                _logging.getLogger("junior.schema").warning(
                    "[schema] idempotent ALTER skipped: %s (%s)", _stmt, _e
                )
    start_cron()
    try:
        yield
    finally:
        stop_cron()


app = FastAPI(
    title="Junior Backend",
    version="0.1.0",
    description="License issuance, tier resolution, webhook reconciliation for Junior.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhooks_clerk.router)
app.include_router(webhooks_whop.router)
app.include_router(desktop.router)
app.include_router(sync.router)
app.include_router(schedules.router)
app.include_router(usage.router)
app.include_router(updates.router)
app.include_router(notifications.router)
app.include_router(transcribe.router)
app.include_router(telemetry.router)
app.include_router(publish.router)
app.include_router(connections.router)
app.include_router(whop.router)
app.include_router(me.router)
app.include_router(onboarding.router)
app.include_router(affiliate.router)
app.include_router(admin.router)


@app.get("/healthcheck")
def healthcheck() -> dict:
    return {"status": "ok", "service": "junior-backend", "version": "0.1.0"}
