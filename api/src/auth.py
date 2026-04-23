"""Autenticación JWT (multi-usuario) para el API de auditoría.

Soporta dos fuentes de usuarios:
  1) ADMIN_USER/ADMIN_PASSWORD del .env — super-admin baked-in (always works).
  2) Tabla `admin_users` de Postgres — usuarios extra creados via CLI o
     futuro panel. Hash bcrypt en password_hash.

Si el usuario existe en ambos lados, el de la DB tiene precedencia.
El JWT lleva `sub` (username) y `role` (admin|operator|viewer).

Nota: NO uses `from __future__ import annotations` aquí. El decorador
`@limiter.limit` de slowapi envuelve el handler y Pydantic pierde la
referencia a `LoginRequest` cuando las anotaciones son strings lazy
(PEP 563), arrojando PydanticUndefinedAnnotation al arrancar el API.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from .config import get_settings
from .db import execute, fetch_one
from .ratelimit import limiter

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# tokenUrl es informativo; aceptamos bodies JSON, no form-urlencoded.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# bcrypt directo en vez de passlib porque passlib 1.7.4 rompe con bcrypt 4.x
# (AttributeError: module 'bcrypt' has no attribute '__about__').
# Limit duro de bcrypt: 72 bytes — truncamos defensivamente con el mismo
# criterio que passlib usaba (los chars >72 son ignorados igual).
_BCRYPT_MAX = 72


def _truncate(plain: str) -> bytes:
    return plain.encode("utf-8")[:_BCRYPT_MAX]


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_truncate(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_truncate(plain), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(subject: str, role: str = "admin") -> Tuple[str, int]:
    s = get_settings()
    expires_delta = timedelta(hours=s.jwt_expiry_hours)
    expire = datetime.now(tz=timezone.utc) + expires_delta
    payload = {
        "sub": subject,
        "role": role,
        "exp": expire,
        "iat": datetime.now(tz=timezone.utc),
    }
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


def get_current_user_with_role(token: Optional[str] = Depends(oauth2_scheme)) -> dict:
    """Versión extendida que devuelve username + role. Usar en endpoints
    que necesiten autorización por rol (ej. solo admin puede crear users)."""
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
        return {"username": str(sub), "role": str(payload.get("role") or "viewer")}
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token inválido: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _authenticate(username: str, password: str) -> Optional[dict]:
    """Devuelve {'username','role'} si las creds son válidas, o None.

    Orden de chequeo:
      1) Tabla admin_users (si la DB la tiene) — username case-insensitive.
      2) Fallback al ADMIN_USER/ADMIN_PASSWORD del .env (super-admin).
    """
    # 1) DB
    try:
        row = fetch_one(
            """SELECT username, password_hash, role, is_active
                 FROM admin_users
                WHERE LOWER(username) = LOWER(%s)
                LIMIT 1""",
            [username],
        )
        if row and row.get("is_active") and verify_password(password, row["password_hash"]):
            # Marca last_login en background (best-effort).
            try:
                execute(
                    "UPDATE admin_users SET last_login_at = NOW() WHERE LOWER(username) = LOWER(%s)",
                    [username],
                )
            except Exception:
                pass
            return {"username": row["username"], "role": row["role"]}
    except Exception as e:
        # Si la tabla no existe (DB vieja), seguimos al fallback.
        log.debug("admin_users lookup falló (probablemente tabla no existe): %s", e)

    # 2) Fallback env
    s = get_settings()
    if s.admin_user and s.admin_password:
        if username == s.admin_user and password == s.admin_password:
            return {"username": s.admin_user, "role": "admin"}
    return None


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest) -> TokenResponse:
    """Login multi-usuario. Limitado a 5 intentos/min por IP."""
    s = get_settings()
    if not s.admin_password:
        # No bloquea login DB-based si está configurado; pero si NO hay nada,
        # el sistema no puede autenticar.
        log.warning("ADMIN_PASSWORD no configurada — solo usuarios DB pueden loguear")

    user = _authenticate(body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    token, expires_in = create_access_token(user["username"], user["role"])
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
        user={"username": user["username"], "role": user["role"]},
    )


@router.get("/me", tags=["auth"])
def me(current: dict = Depends(get_current_user_with_role)) -> dict:
    """Quién soy (devuelto del JWT). Útil para el dashboard."""
    return current
