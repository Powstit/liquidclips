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
from app.routes import connections, desktop, me, notifications, onboarding, publish, schedules, sync, transcribe, updates, usage, webhooks_clerk, webhooks_whop, whop

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Auto-create tables locally so the dev loop is fast. Alembic owns schema
    # in production — we drop the create_all once the first migration is in.
    Base.metadata.create_all(bind=engine)
    # No alembic yet: create_all adds missing TABLES but not new COLUMNS on existing
    # tables. Idempotently ensure recently-added columns exist (Postgres prod).
    from sqlalchemy import text as _text
    try:
        with engine.begin() as _conn:
            if _conn.dialect.name == "postgresql":
                _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS starter_exports_used integer NOT NULL DEFAULT 0"))
    except Exception:
        pass
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
app.include_router(publish.router)
app.include_router(connections.router)
app.include_router(whop.router)
app.include_router(me.router)
app.include_router(onboarding.router)


@app.get("/healthcheck")
def healthcheck() -> dict:
    return {"status": "ok", "service": "junior-backend", "version": "0.1.0"}
