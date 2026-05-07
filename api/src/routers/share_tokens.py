"""Gestión de tokens del informe público — solo admin.

Endpoints (todos bajo `/api/admin/share-tokens` — JWT + rol admin):
  GET   /api/admin/share-tokens              → listar tokens (sin plaintext)
  POST  /api/admin/share-tokens              → crear token (devuelve plaintext UNA vez)
  POST  /api/admin/share-tokens/{id}/revoke  → revocar (soft)
  DELETE /api/admin/share-tokens/{id}        → eliminar (hard, audit trail se pierde)

El plaintext del token solo se devuelve en el response del POST de
creación. En DB guardamos sha256(plaintext); si el dump de DB se filtra,
los tokens no son utilizables.

La validación pública (consumida por public_report.py) está en
`validate_public_token` — hashea, busca, marca uso, devuelve si vale.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import require_admin
from ..config import get_settings
from ..db import execute, fetch_all, fetch_one

router = APIRouter(prefix="/api/admin/share-tokens", tags=["admin-share-tokens"])


# ─── Schemas ────────────────────────────────────────────────
class TokenCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=255,
                       description="Etiqueta para identificar el enlace")
    expires_in_days: Optional[int] = Field(
        None, ge=1, le=3650,
        description="Días hasta expiración. Vacío = no expira.",
    )


class TokenInfo(BaseModel):
    id: str
    label: str
    created_by: str
    created_at: str
    expires_at: Optional[str]
    revoked_at: Optional[str]
    last_used_at: Optional[str]
    use_count: int
    is_active: bool
    fingerprint: str  # primeros 8 chars del hash, para identificar visualmente


class TokenCreateResponse(TokenInfo):
    """Respuesta del POST: incluye el token plano y la URL relativa.
    Esto es lo único que se muestra UNA vez. Después solo metadatos."""
    token: str
    url_path: str  # ej. "/reporte?k=abc123def..."


# ─── Helpers ────────────────────────────────────────────────
def _hash_token(plain: str) -> str:
    """sha256 hex. No usamos bcrypt: los tokens tienen 256+ bits de
    entropía aleatoria, no son passwords adivinables."""
    return hashlib.sha256(plain.encode("utf-8")).hexdigest()


def _row_to_info(row: dict) -> TokenInfo:
    now = datetime.now(timezone.utc)
    expires = row.get("expires_at")
    revoked = row.get("revoked_at")
    is_active = (
        revoked is None
        and (expires is None or expires > now)
    )
    return TokenInfo(
        id=str(row["id"]),
        label=row["label"],
        created_by=row["created_by"],
        created_at=row["created_at"].isoformat() if row["created_at"] else "",
        expires_at=expires.isoformat() if expires else None,
        revoked_at=revoked.isoformat() if revoked else None,
        last_used_at=row["last_used_at"].isoformat() if row.get("last_used_at") else None,
        use_count=int(row.get("use_count") or 0),
        is_active=is_active,
        fingerprint=str(row["token_hash"])[:8],
    )


def validate_public_token(plaintext: str) -> bool:
    """Validador para el endpoint público.

    1) Hashea el plaintext.
    2) Busca en `public_report_tokens` un registro activo.
    3) Si existe: actualiza last_used_at + use_count y devuelve True.
    4) Si no: cae al fallback ENV (PUBLIC_REPORT_TOKEN).
    5) Si tampoco coincide: devuelve False.

    Constant-time tanto en el lookup DB (sha256 igualdad bit-a-bit) como
    en el fallback env (hmac.compare_digest).
    """
    if not plaintext:
        return False

    h = _hash_token(plaintext)
    row = fetch_one(
        """SELECT id, expires_at, revoked_at
             FROM public_report_tokens
            WHERE token_hash = %s
              AND revoked_at IS NULL
              AND (expires_at IS NULL OR expires_at > NOW())
            LIMIT 1""",
        [h],
    )
    if row:
        # Best-effort: actualizar uso. Si falla no bloquea acceso.
        try:
            execute(
                """UPDATE public_report_tokens
                      SET last_used_at = NOW(),
                          use_count = use_count + 1
                    WHERE id = %s""",
                [row["id"]],
            )
        except Exception:
            pass
        return True

    # Fallback al token del .env (compatibilidad con setup viejo).
    expected_env = get_settings().public_report_token
    if expected_env and hmac.compare_digest(plaintext, expected_env):
        return True

    return False


# ─── Endpoints admin ────────────────────────────────────────
@router.get("")
def list_tokens(_admin: dict = Depends(require_admin)) -> dict:
    """Lista todos los tokens. NO devuelve plaintext (no lo tenemos)."""
    rows = fetch_all(
        """SELECT id, token_hash, label, created_by, created_at,
                  expires_at, revoked_at, last_used_at, use_count
             FROM public_report_tokens
            ORDER BY created_at DESC
            LIMIT 200"""
    )
    items = [_row_to_info(r).model_dump() for r in rows]
    return {"items": items}


@router.post("", response_model=TokenCreateResponse)
def create_token(
    body: TokenCreate,
    admin: dict = Depends(require_admin),
) -> TokenCreateResponse:
    """Crea un nuevo enlace y devuelve la URL UNA SOLA VEZ.

    El admin debe copiar el `url_path` ahora — después solo se ve la
    metadata (label, fingerprint, fechas, uso).
    """
    plaintext = secrets.token_urlsafe(32)  # ~43 chars URL-safe = 256 bits
    h = _hash_token(plaintext)

    expires_at: Optional[datetime] = None
    if body.expires_in_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    execute(
        """INSERT INTO public_report_tokens
             (token_hash, label, created_by, expires_at)
           VALUES (%s, %s, %s, %s)""",
        [h, body.label.strip(), admin["username"], expires_at],
    )
    row = fetch_one(
        """SELECT id, token_hash, label, created_by, created_at,
                  expires_at, revoked_at, last_used_at, use_count
             FROM public_report_tokens
            WHERE token_hash = %s""",
        [h],
    )
    base = _row_to_info(row).model_dump()
    return TokenCreateResponse(
        **base,
        token=plaintext,
        url_path=f"/reporte?k={plaintext}",
    )


@router.post("/{token_id}/revoke")
def revoke_token(
    token_id: str,
    _admin: dict = Depends(require_admin),
) -> dict:
    """Revoca un token. El enlace deja de funcionar inmediatamente."""
    affected = execute(
        """UPDATE public_report_tokens
              SET revoked_at = NOW()
            WHERE id = %s
              AND revoked_at IS NULL""",
        [token_id],
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Token no encontrado o ya revocado")
    return {"ok": True, "revoked": True}


@router.delete("/{token_id}")
def delete_token(
    token_id: str,
    _admin: dict = Depends(require_admin),
) -> dict:
    """Elimina el token físicamente. Pierde el rastro de auditoría —
    preferir revoke. Disponible para casos donde haya que limpiar
    tokens de prueba o accidentales."""
    affected = execute(
        "DELETE FROM public_report_tokens WHERE id = %s",
        [token_id],
    )
    if affected == 0:
        raise HTTPException(status_code=404, detail="Token no encontrado")
    return {"ok": True, "deleted": True}
