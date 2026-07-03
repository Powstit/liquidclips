"""Step 4 · server-owned Clipper + Agency onboarding state machines.

Defines two ordered paths per the master doc §Step 4:

* **Clipper path** — the sign-up → first-published-clip journey.
* **Agency path** — the sign-up → first-approved-submission journey.

Every transition is idempotent (by source-surface-scoped
``idempotency_key``) and audited (via ``MilestoneTransition``). The
resume helper reads whichever state a user last reached and returns
the next expected step so a cold restart / reconnect / fresh install
picks up where they left off — the master doc's ``clipper_resume`` /
``agency_resume`` assertions.

The existing ``mark_milestone`` write path in ``onboarding_milestones``
is preserved (it still stamps the ``User.onboarding_status`` snapshot);
this module adds the state-machine layer on top so both the snapshot
and the transition audit stay coherent.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal, Sequence

from sqlalchemy.orm import Session

from app.models import MilestoneTransition, User
from app.onboarding_milestones import mark_milestone

log = logging.getLogger("junior.onboarding.journeys")


Journey = Literal["clipper", "agency"]


# ---------------------------------------------------------------------------
# The closed vocabularies · adding a state requires editing here AND the
# ``MilestoneKey`` union in ``onboarding_milestones.py``.
# ---------------------------------------------------------------------------


CLIPPER_PATH: tuple[str, ...] = (
    "account_created",           # sign-up · webhooks_clerk on user.created
    "desktop_connected",         # first successful /desktop/connect
    "source_added",              # /clip/from-url or drag-drop first accepted source
    "first_clip_generated",      # engine produced a first playable clip
    "first_edit_completed",      # user saved a first edit / caption / trim
    "first_export_completed",    # /export success · file on disk
    "first_publish_or_download", # published via /publish-now OR downloaded to disk
)

AGENCY_PATH: tuple[str, ...] = (
    "account_created",           # sign-up · same anchor as clipper
    "agency_plan_active",        # subscription_status=active AND tier is agency-family
    "agency_profile_started",    # first PATCH /agency/profile with non-default fields
    "first_campaign_created",    # /agency/campaigns POST first row
    "first_invite_sent",         # /agency/{id}/roster/invite first POST
    "first_member_joined",       # AgencyMember first status=active row for the owner
    "first_submission_received", # SponsoredSubmission first row against the agency
    "first_review_completed",    # SponsoredSubmission first review_state != pending
)


JOURNEY_PATHS: dict[Journey, tuple[str, ...]] = {
    "clipper": CLIPPER_PATH,
    "agency": AGENCY_PATH,
}


# Map every state to the ``MilestoneKey`` in ``onboarding_milestones``
# it also stamps · additive · never rename. When a state doesn't have a
# legacy snapshot key, the mapping value is None and the snapshot is
# skipped for that state (audit still lands).
STATE_TO_SNAPSHOT_KEY: dict[str, str | None] = {
    # Clipper
    "account_created":           "signed_up_at",
    "desktop_connected":         "first_launch_at",
    "source_added":              None,
    "first_clip_generated":      "first_clip_at",
    "first_edit_completed":      None,
    "first_export_completed":    None,
    "first_publish_or_download": "first_publish_at",
    # Agency
    "agency_plan_active":        None,
    "agency_profile_started":    None,
    "first_campaign_created":    "agency_owner_first_campaign",
    "first_invite_sent":         "agency_owner_first_invite",
    "first_member_joined":       None,
    "first_submission_received": None,
    "first_review_completed":    None,
}


# ---------------------------------------------------------------------------
# State machine helpers
# ---------------------------------------------------------------------------


def _states_reached(db: Session, user: User, journey: Journey) -> set[str]:
    """Return the set of states this user has reached on ``journey``."""
    rows = (
        db.query(MilestoneTransition.next_state)
        .filter(
            MilestoneTransition.user_id == user.id,
            MilestoneTransition.journey == journey,
        )
        .all()
    )
    return {r[0] for r in rows}


def current_state(db: Session, user: User, journey: Journey) -> str | None:
    """Return the FURTHEST state this user has reached on ``journey``,
    or ``None`` when they haven't started. "Furthest" is defined by
    the path's ordering; a user who has reached ``first_publish`` but
    not ``first_export`` still counts as ``first_publish`` (paths can
    be walked non-linearly)."""
    reached = _states_reached(db, user, journey)
    path = JOURNEY_PATHS[journey]
    furthest: str | None = None
    for state in path:
        if state in reached:
            furthest = state
    return furthest


def next_state_for(db: Session, user: User, journey: Journey) -> str | None:
    """Return the next expected state · the master doc's resume anchor.
    Returns ``None`` when the journey is complete."""
    path = JOURNEY_PATHS[journey]
    reached = _states_reached(db, user, journey)
    for state in path:
        if state not in reached:
            return state
    return None


def journey_progress(db: Session, user: User, journey: Journey) -> dict[str, Any]:
    """Structured progress payload · consumed by /sync + HQ stuck-user view.
    Shape: journey label, path, states_reached, current, next."""
    path = JOURNEY_PATHS[journey]
    reached = _states_reached(db, user, journey)
    return {
        "journey": journey,
        "path": list(path),
        "states_reached": [s for s in path if s in reached],
        "current": current_state(db, user, journey),
        "next": next_state_for(db, user, journey),
        "complete": next_state_for(db, user, journey) is None,
    }


# ---------------------------------------------------------------------------
# Idempotent advance · the master doc's ``clipper_idempotent`` +
# ``agency_idempotent`` assertions ride on this. Repeated calls with the
# same idempotency_key are a no-op; new keys write a new transition row.
# ---------------------------------------------------------------------------


def _canonical_idempotency_key(
    user: User,
    journey: Journey,
    state: str,
    source_surface: str,
    caller_key: str | None,
) -> str:
    """Compose the unique idempotency key. Caller can pass an explicit
    key (e.g. a webhook event id) OR let the helper derive one from
    (user, journey, state) which naturally de-duplicates "first" events."""
    if caller_key:
        return f"{user.id}:{journey}:{state}:{source_surface}:{caller_key}"
    return f"{user.id}:{journey}:{state}"


def advance(
    db: Session,
    user: User,
    journey: Journey,
    state: str,
    *,
    source_surface: str,
    idempotency_key: str | None = None,
    schema_version: int = 1,
) -> bool:
    """Record a milestone transition · idempotent · audited.

    Returns True when the transition was NEW · False when it was a
    duplicate (same idempotency_key) or the state isn't in the path.
    Never raises — telemetry-critical writes should not fail request
    handlers.

    Side-effects on success:
      1. Insert a ``MilestoneTransition`` row (the audit).
      2. Stamp the corresponding ``User.onboarding_status`` snapshot
         key when the state has one (backward-compat with existing
         Kade reactive onboarding · desktop's ``onboardingEmitter``
         diffs this JSON).
    """
    if state not in JOURNEY_PATHS[journey]:
        log.warning(
            "[journeys] state=%r not in %s path — write skipped",
            state, journey,
        )
        return False

    key = _canonical_idempotency_key(user, journey, state, source_surface, idempotency_key)

    # Idempotence — check first, insert only when new.
    exists = (
        db.query(MilestoneTransition.id)
        .filter(MilestoneTransition.idempotency_key == key)
        .one_or_none()
    )
    if exists is not None:
        return False

    prev = current_state(db, user, journey)

    row = MilestoneTransition(
        id=uuid.uuid4().hex,
        user_id=str(user.id),
        journey=journey,
        prev_state=prev,
        next_state=state,
        source_surface=source_surface,
        schema_version=schema_version,
        idempotency_key=key,
    )
    try:
        db.add(row)
        db.commit()
    except Exception:  # noqa: BLE001
        # UNIQUE clash from a concurrent write — treat as no-op.
        db.rollback()
        return False

    # Also stamp the legacy snapshot when the state maps to one.
    snapshot_key = STATE_TO_SNAPSHOT_KEY.get(state)
    if snapshot_key is not None:
        # ``mark_milestone`` accepts any string per its runtime check but
        # its ``MilestoneKey`` Literal is authoritative — the mapping table
        # is confined to keys it knows about.
        try:
            mark_milestone(db, user, snapshot_key)  # type: ignore[arg-type]
        except Exception:  # noqa: BLE001
            log.warning(
                "[journeys] snapshot mirror failed · user=%s · state=%s · key=%s",
                user.id, state, snapshot_key, exc_info=True,
            )

    return True


# ---------------------------------------------------------------------------
# Resume helper · the master doc's ``clipper_resume`` + ``agency_resume``
# assertions. Returns the next expected step + surface hint the caller
# should navigate the user to.
# ---------------------------------------------------------------------------


SURFACE_FOR_NEXT_STATE: dict[str, str] = {
    # Clipper
    "account_created":           "sign-up",
    "desktop_connected":         "desktop.activation",
    "source_added":              "desktop.create.paste-url",
    "first_clip_generated":      "desktop.engine.build",
    "first_edit_completed":      "desktop.editor.save",
    "first_export_completed":    "desktop.export.dialog",
    "first_publish_or_download": "desktop.publish.modal",
    # Agency
    "agency_plan_active":        "account-app.upgrade.agency",
    "agency_profile_started":    "account-app.agency.profile",
    "first_campaign_created":    "account-app.agency.campaigns.new",
    "first_invite_sent":         "account-app.agency.roster",
    "first_member_joined":       "account-app.agency.roster",
    "first_submission_received": "account-app.agency.submissions",
    "first_review_completed":    "account-app.agency.submissions",
}


def resume(db: Session, user: User, journey: Journey) -> dict[str, Any]:
    """Where should this user pick up on ``journey``?

    Returns ``{next: str | None, surface: str | None, complete: bool,
    progress: dict}``. ``surface`` names the UI destination the client
    should route to; when the journey is complete both are ``None``.
    """
    nxt = next_state_for(db, user, journey)
    return {
        "next": nxt,
        "surface": SURFACE_FOR_NEXT_STATE.get(nxt or "", None),
        "complete": nxt is None,
        "progress": journey_progress(db, user, journey),
    }


def all_journeys(db: Session, user: User) -> dict[str, dict[str, Any]]:
    """Return progress for both journeys · consumed by /sync so the client
    can render either lane depending on the user's chosen mode."""
    return {j: journey_progress(db, user, j) for j in ("clipper", "agency")}


# ---------------------------------------------------------------------------
# Public API surface — kept in one export tuple so downstream tests / /sync
# know what's stable vs internal.
# ---------------------------------------------------------------------------

__all__: Sequence[str] = (
    "AGENCY_PATH",
    "CLIPPER_PATH",
    "JOURNEY_PATHS",
    "advance",
    "all_journeys",
    "current_state",
    "journey_progress",
    "next_state_for",
    "resume",
    "STATE_TO_SNAPSHOT_KEY",
    "SURFACE_FOR_NEXT_STATE",
)
