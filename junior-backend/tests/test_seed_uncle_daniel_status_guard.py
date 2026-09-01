"""Guards the 2026-09-01 fix: the Uncle Daniel funnel seed script must not
silently revert a manually-suspended/closed campaign's status back to
"live" on re-run (it runs on every backend lifespan startup)."""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import SponsoredCampaign
from scripts.seed_uncle_daniel_campaigns import SEEDS, upsert


def _session_local():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def test_first_run_creates_with_seed_default_status():
    session_local = _session_local()
    seed = SEEDS[0]
    with session_local() as db:
        assert upsert(db, seed) == f"created {seed['slug']}"
        db.commit()
        row = db.query(SponsoredCampaign).filter_by(slug=seed["slug"]).one()
        assert row.status == seed["status"] == "live"


def test_rerun_does_not_revert_a_manually_suspended_campaign():
    session_local = _session_local()
    seed = SEEDS[0]
    with session_local() as db:
        upsert(db, seed)
        db.commit()

    # Simulate the real /agency/campaigns/{slug}/status endpoint suspending it.
    with session_local() as db:
        row = db.query(SponsoredCampaign).filter_by(slug=seed["slug"]).one()
        row.status = "coming_soon"
        db.commit()

    # Backend restarts, seed script re-runs (this is the exact bug scenario).
    with session_local() as db:
        assert upsert(db, seed) == f"updated {seed['slug']}"
        db.commit()
        row = db.query(SponsoredCampaign).filter_by(slug=seed["slug"]).one()
        assert row.status == "coming_soon", "seed re-run must not clobber a manual status change"


def test_rerun_still_updates_other_seed_driven_fields():
    session_local = _session_local()
    seed = SEEDS[0]
    with session_local() as db:
        upsert(db, seed)
        db.commit()
        row = db.query(SponsoredCampaign).filter_by(slug=seed["slug"]).one()
        row.status = "coming_soon"
        row.subtitle = "stale local edit"
        db.commit()

    with session_local() as db:
        upsert(db, seed)
        db.commit()
        row = db.query(SponsoredCampaign).filter_by(slug=seed["slug"]).one()
        # Non-status fields stay server-driven, exactly as before this fix.
        assert row.subtitle == seed["subtitle"]
        assert row.status == "coming_soon"
