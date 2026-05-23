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

engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True, future=True)

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
