"""Seed the 9 community channels from Daniel's locked architecture.

Idempotent — safe to re-run. whop_channel_id stays null in Phase 1; the
admin fills them in via Admin HQ once the Whop chat experiences are
provisioned (or via the CLI/Whop dashboard, then PATCH each row).

Sections:
  announcements → admin-only posts.
  free_lobby    → Free Clipper Lobby.
  paid_core     → Premium Rewards HQ + Affiliate Growth Room.
  mission       → Uncle Daniel · Viral Reaction · DDB Beauty · DDB
                  Fashion · Sponsor Campaigns.

Tier values:
  free       → open to logged-out + free.
  free_paid  → open to everyone signed in.
  paid       → solo / pro / agency only.
  paid_admin → paid users + admins can post; others read-only.

Run:
  cd ~/Desktop/jnr/junior-backend
  .venv/bin/python -m scripts.seed_community_channels
"""

from __future__ import annotations

from app.db import SessionLocal
from app.models import CommunityChannel


SEEDS: list[dict] = [
    {
        "slug": "announcements",
        "name": "Announcements",
        "purpose": "Platform updates, new missions, payout updates, rule changes. Admin posts only.",
        "required_tier": "free_paid",
        "business_unit": None,
        "mission_lane": None,
        "is_admin_only": True,
        "is_locked_preview_enabled": False,
        "section": "announcements",
        "sort_order": 0,
    },
    {
        "slug": "free-clipper-lobby",
        "name": "Free Clipper Lobby",
        "purpose": "Onboarding, $1 RPM explanation, 100 free watermarked clips, Uncle Daniel starter campaign, beginner help.",
        "required_tier": "free_paid",
        "business_unit": None,
        "mission_lane": None,
        "is_admin_only": False,
        "is_locked_preview_enabled": False,
        "section": "free_lobby",
        "sort_order": 10,
    },
    {
        "slug": "premium-rewards-hq",
        "name": "Premium Rewards HQ",
        "purpose": "Main room for high-RPM campaign drops across all Daniel-owned businesses and sponsors. Paid clippers only.",
        "required_tier": "paid",
        "business_unit": None,
        "mission_lane": None,
        "is_admin_only": False,
        "is_locked_preview_enabled": True,
        "section": "paid_core",
        "sort_order": 20,
    },
    {
        "slug": "affiliate-growth-room",
        "name": "Affiliate Growth Room",
        "purpose": "50% MRR referral strategy, promo assets, referral links, leaderboards, subscriber growth. Not for clipping chat.",
        "required_tier": "paid",
        "business_unit": "liquid_clips",
        "mission_lane": None,
        "is_admin_only": False,
        "is_locked_preview_enabled": True,
        "section": "paid_core",
        "sort_order": 21,
    },
    {
        "slug": "uncle-daniel-clips",
        "name": "Uncle Daniel Clips",
        "purpose": "Controlled training content, approved episodes, clip angles, caption templates. Open to free + paid.",
        "required_tier": "free_paid",
        "business_unit": "uncle_daniel",
        "mission_lane": "training",
        "is_admin_only": False,
        "is_locked_preview_enabled": False,
        "section": "mission",
        "sort_order": 30,
    },
    {
        "slug": "viral-reaction-missions",
        "name": "Viral Reaction Missions",
        "purpose": "Viral source ideas, reaction layouts, trending people, high-upside native content. Paid clippers only.",
        "required_tier": "paid",
        "business_unit": "liquid_clips",
        "mission_lane": "main",
        "is_admin_only": False,
        "is_locked_preview_enabled": True,
        "section": "mission",
        "sort_order": 31,
    },
    {
        "slug": "ddb-beauty-clips",
        "name": "Daniel Diyepriye Beauty Clips",
        "purpose": "$10 RPM beauty campaign, product assets, UGC angles, approved captions, examples, rules.",
        "required_tier": "paid",
        "business_unit": "ddb_beauty",
        "mission_lane": "brand",
        "is_admin_only": False,
        "is_locked_preview_enabled": True,
        "section": "mission",
        "sort_order": 32,
    },
    {
        "slug": "ddb-fashion-clips",
        "name": "Daniel Diyepriye Fashion Clips",
        "purpose": "Fashion-house campaign assets, luxury storytelling clips, brand rules.",
        "required_tier": "paid",
        "business_unit": "ddb_fashion",
        "mission_lane": "brand",
        "is_admin_only": False,
        "is_locked_preview_enabled": True,
        "section": "mission",
        "sort_order": 33,
    },
    {
        "slug": "sponsor-campaigns",
        "name": "Sponsor Campaigns",
        "purpose": "External SaaS/brand campaigns with high RPM budgets. Invite-only campaigns surface here first.",
        "required_tier": "paid",
        "business_unit": "sponsors",
        "mission_lane": "sponsor",
        "is_admin_only": False,
        "is_locked_preview_enabled": True,
        "section": "mission",
        "sort_order": 34,
    },
]


def upsert(db, seed: dict) -> str:
    existing = db.query(CommunityChannel).filter_by(slug=seed["slug"]).one_or_none()
    if existing is None:
        db.add(CommunityChannel(**seed))
        return f"created {seed['slug']}"
    for k, v in seed.items():
        # Don't clobber a hand-set whop_channel_id on re-run.
        if k == "whop_channel_id" and existing.whop_channel_id:
            continue
        setattr(existing, k, v)
    return f"updated {seed['slug']}"


def main() -> None:
    with SessionLocal() as db:
        for seed in SEEDS:
            print(upsert(db, seed))
        db.commit()
    print("seed complete.")


if __name__ == "__main__":
    main()
