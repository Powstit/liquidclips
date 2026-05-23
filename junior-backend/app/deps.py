"""Common FastAPI dependencies — license JWT auth, etc."""

from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.jwt_signer import verify_license_jwt
from app.models import User


def license_claims(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = authorization.split(None, 1)[1].strip()
    try:
        return verify_license_jwt(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "license expired") from None
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid license: {e}") from None


def current_user(
    claims: Annotated[dict, Depends(license_claims)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = db.get(User, claims["sub"])
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "license user not found")

    # Master-admin override — danieldiyepriye@gmail.com and any other email in
    # ADMIN_EMAILS (app/features.py) gets Autopilot+Founder regardless of what
    # Clerk billing says. We mutate the SQLAlchemy session object in-memory
    # only; nothing is committed, so the DB row stays the source of truth for
    # billing reconciliation. Every downstream `user.tier` / `user.founder_flag`
    # read sees the elevated values automatically.
    from app.features import is_admin_email
    if is_admin_email(user.email):
        user.tier = "autopilot"
        user.founder_flag = True
        db.expunge(user)  # detach so SQLAlchemy never flushes the in-memory change

    return user
