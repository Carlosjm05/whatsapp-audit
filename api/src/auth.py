"""Autenticación JWT (admin único) para el API de auditoría.

Nota: NO uses `from __future__ import annotations` aquí. El decorador
`@limiter.limit` de slowapi envuelve el handler y Pydantic pierde la
referencia a `LoginRequest` cuando las anotaciones son strings lazy
(PEP 563), arrojando PydanticUndefinedAnnotation al arrancar el API.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from .config import get_settings
from .ratelimit import limiter

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# tokenUrl es informativo; aceptamos bodies JSON, no form-urlencoded.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


def create_access_token(subject: str) -> Tuple[str, int]:
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
            detail="Token de autorización faltante",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(token)
        sub = payload.get("sub")
        if not sub:
            raise JWTError("falta 'sub'")
        return str(sub)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token inválido: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest) -> TokenResponse:
    """Login del único admin. Limitado a 5 intentos/min por IP."""
    s = get_settings()
    if not s.admin_password:
        log.error("ADMIN_PASSWORD no configurada")
        raise HTTPException(
            status_code=500,
            detail="Autenticación del servidor no configurada",
        )

    if body.username != s.admin_user or body.password != s.admin_password:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    token, expires_in = create_access_token(body.username)
    return TokenResponse(access_token=token, token_type="bearer", expires_in=expires_in)
