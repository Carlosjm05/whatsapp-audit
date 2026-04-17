"""CRUD de catálogos editables (proyectos y asesores).

Administrados desde /catalogos en el dashboard. El analyzer los
consume con cache de 60s (ver analyzer/src/catalogos.py).
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..db import execute, fetch_all, fetch_one

router = APIRouter(prefix="/api/catalogs", tags=["catalogs"])


# ─── SCHEMAS ─────────────────────────────────────────────────
class ProjectIn(BaseModel):
    canonical_name: str = Field(..., min_length=1, max_length=255)
    aliases: List[str] = Field(default_factory=list)
    project_type: Optional[str] = None
    city: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True


class ProjectUpdate(BaseModel):
    canonical_name: Optional[str] = Field(None, min_length=1, max_length=255)
    aliases: Optional[List[str]] = None
    project_type: Optional[str] = None
    city: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class AdvisorIn(BaseModel):
    canonical_name: str = Field(..., min_length=1, max_length=255)
    aliases: List[str] = Field(default_factory=list)
    phone: Optional[str] = Field(None, max_length=20)
    is_active: bool = True


class AdvisorUpdate(BaseModel):
    canonical_name: Optional[str] = Field(None, min_length=1, max_length=255)
    aliases: Optional[List[str]] = None
    phone: Optional[str] = Field(None, max_length=20)
    is_active: Optional[bool] = None


def _parse_id(v: str) -> str:
    try:
        return str(uuid.UUID(v))
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="ID inválido")


# ─── PROYECTOS ───────────────────────────────────────────────
@router.get("/projects")
def list_projects(_user: str = Depends(get_current_user)) -> dict:
    rows = fetch_all(
        """SELECT id, canonical_name, COALESCE(aliases, ARRAY[]::TEXT[]) AS aliases,
                  project_type, city, description, is_active,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
             FROM projects_catalog
            ORDER BY canonical_name ASC"""
    )
    return {"items": rows}


@router.post("/projects", status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectIn, _user: str = Depends(get_current_user)) -> dict:
    existing = fetch_one(
        "SELECT id FROM projects_catalog WHERE canonical_name = %s",
        [body.canonical_name],
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe un proyecto con el nombre '{body.canonical_name}'",
        )
    row = fetch_one(
        """INSERT INTO projects_catalog
             (canonical_name, aliases, project_type, city, description, is_active)
           VALUES (%s, %s, %s, %s, %s, %s)
           RETURNING id, canonical_name, aliases, project_type, city,
                     description, is_active""",
        [
            body.canonical_name,
            body.aliases,
            body.project_type,
            body.city,
            body.description,
            body.is_active,
        ],
    )
    return row or {}


@router.patch("/projects/{project_id}")
def update_project(
    project_id: str,
    body: ProjectUpdate,
    _user: str = Depends(get_current_user),
) -> dict:
    pid = _parse_id(project_id)
    existing = fetch_one("SELECT id FROM projects_catalog WHERE id = %s", [pid])
    if not existing:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    fields: list[str] = []
    params: list = []
    for field in ("canonical_name", "aliases", "project_type", "city",
                  "description", "is_active"):
        val = getattr(body, field)
        if val is not None:
            fields.append(f"{field} = %s")
            params.append(val)

    if not fields:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar")

    # Validar unicidad si cambia el nombre.
    if body.canonical_name is not None:
        dup = fetch_one(
            """SELECT id FROM projects_catalog
                WHERE canonical_name = %s AND id <> %s""",
            [body.canonical_name, pid],
        )
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe otro proyecto con el nombre '{body.canonical_name}'",
            )

    fields.append("updated_at = NOW()")
    params.append(pid)
    execute(
        f"UPDATE projects_catalog SET {', '.join(fields)} WHERE id = %s",
        params,
    )

    row = fetch_one(
        """SELECT id, canonical_name, aliases, project_type, city,
                  description, is_active
             FROM projects_catalog WHERE id = %s""",
        [pid],
    )
    return row or {}


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: str,
    _user: str = Depends(get_current_user),
) -> dict:
    pid = _parse_id(project_id)
    row = fetch_one("SELECT id FROM projects_catalog WHERE id = %s", [pid])
    if not row:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    execute("DELETE FROM projects_catalog WHERE id = %s", [pid])
    return {"ok": True, "id": pid}


# ─── ASESORES ────────────────────────────────────────────────
@router.get("/advisors")
def list_advisors(_user: str = Depends(get_current_user)) -> dict:
    rows = fetch_all(
        """SELECT id, canonical_name, COALESCE(aliases, ARRAY[]::TEXT[]) AS aliases,
                  phone, is_active,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
                  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
             FROM advisors_catalog
            ORDER BY canonical_name ASC"""
    )
    return {"items": rows}


@router.post("/advisors", status_code=status.HTTP_201_CREATED)
def create_advisor(body: AdvisorIn, _user: str = Depends(get_current_user)) -> dict:
    existing = fetch_one(
        "SELECT id FROM advisors_catalog WHERE canonical_name = %s",
        [body.canonical_name],
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Ya existe un asesor con el nombre '{body.canonical_name}'",
        )
    row = fetch_one(
        """INSERT INTO advisors_catalog
             (canonical_name, aliases, phone, is_active)
           VALUES (%s, %s, %s, %s)
           RETURNING id, canonical_name, aliases, phone, is_active""",
        [body.canonical_name, body.aliases, body.phone, body.is_active],
    )
    return row or {}


@router.patch("/advisors/{advisor_id}")
def update_advisor(
    advisor_id: str,
    body: AdvisorUpdate,
    _user: str = Depends(get_current_user),
) -> dict:
    aid = _parse_id(advisor_id)
    existing = fetch_one("SELECT id FROM advisors_catalog WHERE id = %s", [aid])
    if not existing:
        raise HTTPException(status_code=404, detail="Asesor no encontrado")

    fields: list[str] = []
    params: list = []
    for field in ("canonical_name", "aliases", "phone", "is_active"):
        val = getattr(body, field)
        if val is not None:
            fields.append(f"{field} = %s")
            params.append(val)

    if not fields:
        raise HTTPException(status_code=400, detail="Sin campos para actualizar")

    if body.canonical_name is not None:
        dup = fetch_one(
            """SELECT id FROM advisors_catalog
                WHERE canonical_name = %s AND id <> %s""",
            [body.canonical_name, aid],
        )
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe otro asesor con el nombre '{body.canonical_name}'",
            )

    fields.append("updated_at = NOW()")
    params.append(aid)
    execute(
        f"UPDATE advisors_catalog SET {', '.join(fields)} WHERE id = %s",
        params,
    )

    row = fetch_one(
        """SELECT id, canonical_name, aliases, phone, is_active
             FROM advisors_catalog WHERE id = %s""",
        [aid],
    )
    return row or {}


@router.delete("/advisors/{advisor_id}")
def delete_advisor(
    advisor_id: str,
    _user: str = Depends(get_current_user),
) -> dict:
    aid = _parse_id(advisor_id)
    row = fetch_one("SELECT id FROM advisors_catalog WHERE id = %s", [aid])
    if not row:
        raise HTTPException(status_code=404, detail="Asesor no encontrado")
    execute("DELETE FROM advisors_catalog WHERE id = %s", [aid])
    return {"ok": True, "id": aid}
