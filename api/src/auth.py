"""JWT authentication for the audit API (single-user)."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from .config import get_settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# tokenUrl is informational; we accept JSON login bodies, not form-urlencoded.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


def create_access_token(subject: str) -> tuple[str, int]:
    s = get_settings()
    expires_delta = timedelta(hours=s.jwt_expiry_hours)
    expire = datetime.now(tz=timezone.utc) + expires_delta
    payload = {"sub": subject, "exp": expire, "iat": datetime.now(tz=timezone.utc)}
    token = jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)
    return token, int(expires_delta.total_seconds())


def decode_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])


def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> str:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authorization token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if not sub:
            raise JWTError("missing sub")
        return str(sub)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest) -> TokenResponse:
    s = get_settings()
    if not s.admin_password:
        log.error("ADMIN_PASSWORD not configured")
        raise HTTPException(status_code=500, detail="Server auth not configured")

    if body.username != s.admin_user or body.password != s.admin_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token, expires_in = create_access_token(body.username)
    return TokenResponse(access_token=token, token_type="bearer", expires_in=expires_in)
