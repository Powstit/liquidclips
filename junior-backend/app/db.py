"""SQLAlchemy engine + session.

We use sync SQLAlchemy 2.x with FastAPI's threadpool dependency-injection
pattern — same as the official FastAPI SQL tutorial. Async is unnecessary
at our scale (≤ a few k MAU) and async-SQLAlchemy has sharper edges.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


settings = get_settings()

# SQLite needs `check_same_thread=False` for FastAPI's threadpool; Postgres
# ignores the kwarg.
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

# 2026-07-08 · pool sizing bumped from SQLAlchemy defaults (5 + 10 = 15)
# after k6 loads on 2026-07-07 exhausted the pool inside 60s. Defaults
# are for demo apps · a real backend serving even mid-thousand concurrent
# users needs an order of magnitude more. Sync SQLAlchemy on FastAPI's
# threadpool caps effective concurrency at the smaller of (worker threads,
# pool_size + max_overflow). Uvicorn's default threadpool is 40 threads
# per worker · a pool of 60 (20 + 40) keeps the threadpool as the ceiling
# and lets Railway autoscale by adding more replicas when needed. SQLite
# gets a pass — it's dev-only and doesn't use these knobs anyway.
_is_sqlite = settings.database_url.startswith("sqlite")
_pool_kwargs = {} if _is_sqlite else {
    "pool_size": 20,
    "max_overflow": 40,
    "pool_recycle": 300,       # recycle stale conns every 5m (Railway idle-kills at ~15m)
    "pool_timeout": 10,         # fail fast if pool exhausted (was 30s default)
}
engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    future=True,
    **_pool_kwargs,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Single declarative base for every model."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency that yields a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Use this in code that isn't behind a FastAPI dependency (CLI scripts, jobs)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
