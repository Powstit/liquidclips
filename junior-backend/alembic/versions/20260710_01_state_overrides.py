"""state_overrides table · Lane B · Chapter 5 · State Puppeteer.

Revision ID: 20260710_01
Revises:
Create Date: 2026-07-10

Adds the `state_overrides` table backing the admin state-puppet rig.
Each row is one admin-applied surface-state override on one user with
a TTL. See `app/models.py::StateOverride` for the ORM shape and
`app/routes/admin_state_override.py` for the write API.

Idempotent so it's safe to re-run against a DB where lifespan
`create_all` has already created the table. Runs as a no-op if the
table exists.
"""

from __future__ import annotations

from alembic import op  # type: ignore[import-not-found]
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260710_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "state_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("surface", sa.String(length=80), nullable=False, index=True),
        sa.Column("state", sa.String(length=40), nullable=False),
        sa.Column(
            "applied_by_admin_email",
            sa.String(length=255),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "applied_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "user_id", "surface", "applied_at", name="uq_state_override_slot"
        ),
        if_not_exists=True,
    )
    # Composite index for the hot lookup path in me_wallet.py.
    op.create_index(
        "ix_state_overrides_user_surface_expires",
        "state_overrides",
        ["user_id", "surface", "expires_at"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_state_overrides_user_surface_expires",
        table_name="state_overrides",
        if_exists=True,
    )
    op.drop_table("state_overrides", if_exists=True)
