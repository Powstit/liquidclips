"""Liquid Studio · analysis-hours billing.

Revision ID: 20260717_01
Revises: 20260710_01
Create Date: 2026-07-17

Adds the orthogonal `plan_tier` column + Free-bundle state machine +
Studio allowance columns to `users`, plus the `source_analysis` and
`usage_reservation` tables backing the reserve/settle/release contract.

Idempotent so it's safe to re-run against a database where the lifespan
`ALTER TABLE IF NOT EXISTS` block in `app/main.py` has already applied
the same changes at boot. Runs as a no-op when columns/tables exist.

The billing layer is orthogonal to `users.tier` — Agency capabilities
(`agency_solo`, `agency`, `agency_whitelabel`, `autopilot`, `channel`,
campaign-creation gates, submission review, agency mode toggle) are
NOT touched by this migration. See `scripts/backfill_plan_tier.py` for
the migration of existing users into the new plan_tier space.
"""

from __future__ import annotations

from alembic import op  # type: ignore[import-not-found]
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260717_01"
down_revision = "20260710_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users columns ────────────────────────────────────────────────
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column(
                "plan_tier",
                sa.String(),
                nullable=False,
                server_default="free",
            ),
            if_not_exists=True,
        )
        batch.add_column(
            sa.Column(
                "free_bundle_state",
                sa.String(),
                nullable=False,
                server_default="available",
            ),
            if_not_exists=True,
        )
        batch.add_column(sa.Column("free_source_content_hash", sa.String(), nullable=True), if_not_exists=True)
        batch.add_column(sa.Column("free_analysis_id", sa.String(), nullable=True), if_not_exists=True)
        batch.add_column(sa.Column("free_bundle_reserved_at", sa.DateTime(timezone=True), nullable=True), if_not_exists=True)
        batch.add_column(sa.Column("free_bundle_claimed_at", sa.DateTime(timezone=True), nullable=True), if_not_exists=True)
        batch.add_column(sa.Column("free_clips_generated", sa.Integer(), nullable=True), if_not_exists=True)
        batch.add_column(sa.Column("allowance_period_start", sa.DateTime(timezone=True), nullable=True), if_not_exists=True)
        batch.add_column(sa.Column("allowance_period_end", sa.DateTime(timezone=True), nullable=True), if_not_exists=True)
        batch.add_column(sa.Column("allowance_issued_seconds", sa.Integer(), nullable=False, server_default="0"), if_not_exists=True)
        batch.add_column(sa.Column("allowance_used_seconds", sa.Integer(), nullable=False, server_default="0"), if_not_exists=True)
        batch.add_column(sa.Column("allowance_reserved_seconds", sa.Integer(), nullable=False, server_default="0"), if_not_exists=True)

    op.create_index("ix_users_plan_tier", "users", ["plan_tier"], if_not_exists=True)
    op.create_index("ix_users_free_bundle_state", "users", ["free_bundle_state"], if_not_exists=True)

    # ── source_analysis ──────────────────────────────────────────────
    op.create_table(
        "source_analysis",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("content_hash", sa.String(length=128), nullable=False),
        sa.Column("transcript_hash", sa.String(length=128), nullable=True),
        sa.Column("analysis_version", sa.String(length=20), nullable=False, server_default="v1"),
        sa.Column("speech_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider", sa.String(length=40), nullable=True),
        sa.Column("model", sa.String(length=60), nullable=True),
        sa.Column("cost_usd_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "user_id", "content_hash", "analysis_version",
            name="uq_source_analysis_reservation",
        ),
        if_not_exists=True,
    )

    # ── usage_reservation ────────────────────────────────────────────
    op.create_table(
        "usage_reservation",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "source_analysis_id",
            sa.String(),
            sa.ForeignKey("source_analysis.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("plan_tier_at_reserve", sa.String(), nullable=False),
        sa.Column("reserved_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("actual_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider", sa.String(length=40), nullable=True),
        sa.Column("model", sa.String(length=60), nullable=True),
        sa.Column("state", sa.String(length=20), nullable=False, server_default="reserved", index=True),
        sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("abandoned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("correlation_id", sa.String(length=80), nullable=True, index=True),
        sa.Column("release_reason", sa.String(length=200), nullable=True),
        if_not_exists=True,
    )
    op.create_index(
        "uq_usage_reservation_settled_per_analysis",
        "usage_reservation",
        ["source_analysis_id"],
        unique=True,
        postgresql_where=sa.text("state = 'settled' AND source_analysis_id IS NOT NULL"),
        if_not_exists=True,
    )

    # ── plan_allowance_grant ─────────────────────────────────────────
    op.create_table(
        "plan_allowance_grant",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("whop_payment_id", sa.String(length=120), nullable=False, unique=True, index=True),
        sa.Column("whop_plan_id", sa.String(length=120), nullable=True),
        sa.Column("plan_tier", sa.String(length=40), nullable=False, server_default="studio"),
        sa.Column("billing_period_start", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("billing_period_end", sa.DateTime(timezone=True), nullable=True, index=True),
        sa.Column("issued_seconds", sa.Integer(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("plan_allowance_grant", if_exists=True)
    op.drop_index("uq_usage_reservation_settled_per_analysis", table_name="usage_reservation", if_exists=True)
    op.drop_table("usage_reservation", if_exists=True)
    op.drop_table("source_analysis", if_exists=True)
    with op.batch_alter_table("users") as batch:
        for col in (
            "plan_tier",
            "free_bundle_state",
            "free_source_content_hash",
            "free_analysis_id",
            "free_bundle_reserved_at",
            "free_bundle_claimed_at",
            "free_clips_generated",
            "allowance_period_start",
            "allowance_period_end",
            "allowance_issued_seconds",
            "allowance_used_seconds",
            "allowance_reserved_seconds",
        ):
            batch.drop_column(col, if_exists=True)
