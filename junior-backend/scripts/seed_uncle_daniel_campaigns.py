"""Seed the three Uncle Daniel funnel campaigns into sponsored_campaigns.

Phase 1 of the Uncle Daniel funnel (v0.7.55). Idempotent — safe to re-run.
Each campaign is upserted by slug; existing rows get their funnel fields
patched without touching the legacy `rpm_cents` (which the cinematic
carousel still uses as a fallback).

Architecture (locked):
  campaign_model: "One campaign, multiple missions/content lanes,
                   tier-aware payout states."
  Each lane is its own sponsored_campaigns row sharing the same payout
  ladder: $1 RPM free / $5 RPM premium / $4 RPM bonus paid by admin until
  Whop transfers wire up.

Mission types:
  uncle_daniel    — controlled training content (free + paid)
  viral_reaction  — main paid use case (paid priority)
  software_proof  — software proof / OpusClip comparisons (paid or bonus)

Run:
  cd ~/Desktop/jnr/junior-backend
  .venv/bin/python -m scripts.seed_uncle_daniel_campaigns
"""

from __future__ import annotations

from app.db import SessionLocal
from app.models import SponsoredCampaign


SEEDS: list[dict] = [
    {
        "slug": "clip-uncle-daniel-content",
        "name": "Clip Uncle Daniel Content",
        "brand": "Liquid Clips",
        "subtitle": "Educational + entertaining Uncle Daniel clips. Open to free + paid.",
        "type": "public",
        "status": "live",
        # Legacy single value — surfaces still reading it see the premium total.
        "rpm_cents": 500,
        # New ladder.
        "base_rpm_cents": 100,        # $1 RPM free
        "premium_rpm_cents": 500,     # $5 RPM premium
        "premium_bonus_cents": 400,   # $4 RPM bonus (admin pays out of band)
        "budget_cents": 500_000,      # $5,000 pool — opening allocation
        "funded_pct": 0,
        "duration_label": "Always on",
        "whop_url": "https://whop.com/liquidclips/forums-83fovyATgXDQpO/app/",
        "banner_url": "https://api.jnremployee.com/static/campaigns/uncle-daniel.png",
        "eligibility": [
            "Open to every Liquid Clips user (free + paid).",
            "Free: $1 RPM, watermarked exports, 100-clip starter cap still applies.",
            "Paid ($29.99/mo): $5 RPM total, watermark-free, 50% MRR unlocked on every paid referral.",
        ],
        "visibility_tiers": ["free", "solo", "pro", "agency"],
        "min_lc_score": 0,
        "cta_text": "Open campaign brief →",
        "sort_order": 0,
        # Free/paid copy per Daniel's locked spec — paid copy is intentionally
        # explicit that submission happens THROUGH WHOP (LC never re-implements
        # Whop's approval).
        "free_banner_text": "You are eligible for $1 RPM. Upgrade to unlock $5 RPM + 50% MRR.",
        "premium_banner_text": "$5 RPM unlocked. Submit through Whop, then Liquid Clips tracks your +$4 RPM bonus.",
        "mission_type": "uncle_daniel",
        "mission_lane": "training",
        "requires_membership": False,
        "watermark_allowed": True,
        # Whop side intentionally not created yet — Phase 1 pays manually.
        "whop_campaign_id": None,
        "whop_campaign_url": None,
    },
    {
        "slug": "viral-reaction-clips",
        "name": "Viral Reaction Clips",
        "brand": "Liquid Clips",
        "subtitle": "Clip viral moments, reactions, podcasts, streamers, trending content with Liquid Clips reaction layouts.",
        "type": "public",
        "status": "live",
        "rpm_cents": 500,
        "base_rpm_cents": 100,
        "premium_rpm_cents": 500,
        "premium_bonus_cents": 400,
        "budget_cents": 1_000_000,
        "funded_pct": 0,
        "duration_label": "Ongoing",
        "whop_url": "https://whop.com/liquidclips/forums-83fovyATgXDQpO/app/",
        "banner_url": "https://api.jnremployee.com/static/campaigns/viral-reaction.png",
        "eligibility": [
            "Paid priority — premium clippers get the $5 RPM ladder.",
            "Free clippers can still ship watermarked reaction clips at $1 RPM.",
            "Use Liquid Clips reaction layouts so the watermark drives top-of-funnel installs.",
        ],
        "visibility_tiers": ["free", "solo", "pro", "agency"],
        "min_lc_score": 0,
        "cta_text": "See reaction brief →",
        "sort_order": 1,
        "free_banner_text": "Reaction layouts at $1 RPM (watermarked). Upgrade to unlock $5 RPM + 50% MRR.",
        "premium_banner_text": "$5 RPM on reactions. Submit through Whop, Liquid Clips tracks your +$4 RPM bonus. 50% MRR unlocked.",
        "mission_type": "viral_reaction",
        "mission_lane": "main",
        # Paid priority but not strictly gated — free clippers ship watermarked.
        "requires_membership": False,
        "watermark_allowed": True,
        "whop_campaign_id": None,
        "whop_campaign_url": None,
    },
    {
        "slug": "liquid-clips-proof-clips",
        "name": "Liquid Clips Proof Clips",
        "brand": "Liquid Clips",
        "subtitle": "App comparisons, OpusClip comparisons, before/after workflows. Proof Liquid Clips ships better campaign clips.",
        "type": "public",
        "status": "live",
        "rpm_cents": 500,
        "base_rpm_cents": 100,
        "premium_rpm_cents": 500,
        "premium_bonus_cents": 400,
        "budget_cents": 250_000,
        "funded_pct": 0,
        "duration_label": "Ongoing",
        "whop_url": "https://whop.com/liquidclips/forums-83fovyATgXDQpO/app/",
        "banner_url": "https://api.jnremployee.com/static/campaigns/proof.png",
        "eligibility": [
            "Premium clippers only — proof clips need watermark-free exports.",
            "Show the LC workflow, the comparison split, and the output beat.",
            "Bonus payouts go through admin review until automated transfers ship.",
        ],
        "visibility_tiers": ["solo", "pro", "agency"],
        "min_lc_score": 0,
        "cta_text": "See proof brief →",
        "sort_order": 2,
        "free_banner_text": None,
        "premium_banner_text": "$5 RPM on proof clips. Submit through Whop; Liquid Clips tracks your +$4 bonus. Watermark-free only.",
        "mission_type": "software_proof",
        "mission_lane": "proof",
        "requires_membership": True,
        # Watermark-free exports only — proof clips lose the comparison value
        # if there's a watermark on the LC side.
        "watermark_allowed": False,
        "whop_campaign_id": None,
        "whop_campaign_url": None,
    },
]


def upsert(db, seed: dict) -> str:
    existing = db.query(SponsoredCampaign).filter_by(slug=seed["slug"]).one_or_none()
    if existing is None:
        c = SponsoredCampaign(**seed)
        db.add(c)
        return f"created {seed['slug']}"
    for k, v in seed.items():
        # Don't clobber a manually-tuned rpm_cents on re-run, but every
        # other field is server-driven — overwrite freely.
        if k == "rpm_cents" and existing.rpm_cents and existing.rpm_cents != seed["rpm_cents"]:
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
