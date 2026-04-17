"""Catálogos de proyectos y asesores de Ortiz Finca Raíz.

Se leen desde DB (`projects_catalog` / `advisors_catalog`), con cache
en memoria (TTL configurable). Esto permite que los catálogos sean
editables desde el dashboard sin redeploy.

Si la DB no está disponible al arrancar, se usa un fallback hardcoded
mínimo (los 13 proyectos y 8 asesores que ya conocíamos) para que el
analyzer nunca rompa por problemas de infraestructura.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import unicodedata
from typing import Iterable, List, Optional, Tuple

log = logging.getLogger("analyzer.catalogos")

# TTL del cache en segundos. 60s significa que si agregas un proyecto
# en el panel, los próximos análisis lo verán en <= 1 min.
CATALOG_TTL_SECONDS = int(os.getenv("CATALOG_TTL_SECONDS", "60"))


# ─── FALLBACK (si DB no está disponible) ─────────────────────
_FALLBACK_PROJECTS: List[Tuple[str, List[str]]] = [
    ("Oasis del Olimpo", ["oasis del olimpo", "olimpo", "parcelacion olimpo",
                          "parcelación olimpo"]),
    ("Oasis Ecológico", ["oasis ecologico", "oasis ecológico", "oasis"]),
    ("Brisas del Río", ["brisas del rio", "brisas del río", "brisas"]),
    ("Caracolí", ["caracoli", "caracolí"]),
    ("Jardines de Bellavista", ["jardines de bellavista", "jardines bellavista"]),
    ("Bellavista", ["bellavista"]),
    ("Miramonte", ["miramonte"]),
    ("Cancún", ["cancun", "cancún"]),
    ("Fincas de San Isidro", ["fincas de san isidro", "san isidro",
                              "fincas san isidro"]),
    ("Cielito Lindo", ["cielito lindo", "cielito"]),
    ("Mirador de Anapoima campestre",
        ["mirador de anapoima campestre", "mirador anapoima campestre"]),
    ("Condominio Mirador de Anapoima",
        ["condominio mirador de anapoima", "condominio mirador anapoima",
         "mirador de anapoima", "mirador anapoima"]),
    ("Cardón", ["cardon", "cardón"]),
]

_FALLBACK_ADVISORS: List[Tuple[str, List[str]]] = [
    ("Ronald", ["ronald"]),
    ("Jhon", ["jhon", "john"]),
    ("Sandra", ["sandra"]),
    ("Tatiana", ["tatiana", "tati"]),
    ("Pilar", ["pilar"]),
    ("Valentina", ["valentina", "vale"]),
    ("Oscar", ["oscar", "óscar"]),
    ("Daniela", ["daniela", "dani"]),
]


# ─── CACHE THREAD-SAFE ───────────────────────────────────────
_cache_lock = threading.Lock()
_projects_cache: Optional[List[Tuple[str, List[str]]]] = None
_advisors_cache: Optional[List[Tuple[str, List[str]]]] = None
_projects_loaded_at: float = 0.0
_advisors_loaded_at: float = 0.0


def _load_projects_from_db() -> Optional[List[Tuple[str, List[str]]]]:
    """Lee la tabla projects_catalog. Devuelve None si falla."""
    try:
        from . import db as analyzer_db
        with analyzer_db.cursor(commit=False) as cur:
            cur.execute(
                """SELECT canonical_name, COALESCE(aliases, ARRAY[]::TEXT[]) AS aliases
                   FROM projects_catalog
                   WHERE is_active = TRUE
                   ORDER BY LENGTH(canonical_name) DESC, canonical_name ASC"""
            )
            rows = cur.fetchall()
        # Orden por longitud del nombre canónico DESC: garantiza que
        # "Mirador de Anapoima campestre" (más largo) gane sobre
        # "Mirador de Anapoima" en el matching por substring.
        return [(r["canonical_name"], list(r["aliases"] or [])) for r in rows]
    except Exception as e:
        log.warning("No pude cargar projects_catalog de DB (%s). Usando fallback.", e)
        return None


def _load_advisors_from_db() -> Optional[List[Tuple[str, List[str]]]]:
    try:
        from . import db as analyzer_db
        with analyzer_db.cursor(commit=False) as cur:
            cur.execute(
                """SELECT canonical_name, COALESCE(aliases, ARRAY[]::TEXT[]) AS aliases
                   FROM advisors_catalog
                   WHERE is_active = TRUE
                   ORDER BY canonical_name ASC"""
            )
            rows = cur.fetchall()
        return [(r["canonical_name"], list(r["aliases"] or [])) for r in rows]
    except Exception as e:
        log.warning("No pude cargar advisors_catalog de DB (%s). Usando fallback.", e)
        return None


def _get_projects() -> List[Tuple[str, List[str]]]:
    global _projects_cache, _projects_loaded_at
    now = time.time()
    with _cache_lock:
        if (_projects_cache is not None
                and (now - _projects_loaded_at) < CATALOG_TTL_SECONDS):
            return _projects_cache
    # Fuera del lock (operación I/O).
    fresh = _load_projects_from_db()
    with _cache_lock:
        _projects_cache = fresh if fresh else _FALLBACK_PROJECTS
        _projects_loaded_at = now
        return _projects_cache


def _get_advisors() -> List[Tuple[str, List[str]]]:
    global _advisors_cache, _advisors_loaded_at
    now = time.time()
    with _cache_lock:
        if (_advisors_cache is not None
                and (now - _advisors_loaded_at) < CATALOG_TTL_SECONDS):
            return _advisors_cache
    fresh = _load_advisors_from_db()
    with _cache_lock:
        _advisors_cache = fresh if fresh else _FALLBACK_ADVISORS
        _advisors_loaded_at = now
        return _advisors_cache


def invalidate_cache() -> None:
    """Fuerza recarga en la próxima llamada. Útil si el API publicara
    eventos (no lo hace hoy; el TTL hace el trabajo)."""
    global _projects_loaded_at, _advisors_loaded_at
    with _cache_lock:
        _projects_loaded_at = 0.0
        _advisors_loaded_at = 0.0


# ─── NORMALIZACIÓN ───────────────────────────────────────────
def _normalize(s: str) -> str:
    """Lower + sin tildes + espacios colapsados."""
    if not s:
        return ""
    s = s.strip().lower()
    s = "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )
    return " ".join(s.split())


def _match_catalog(value: Optional[str],
                   catalog: List[Tuple[str, List[str]]]) -> Optional[str]:
    if not value:
        return None
    norm = _normalize(value)
    if not norm:
        return None
    for canonical, aliases in catalog:
        # Match canónico normalizado (por si el alias no está registrado).
        if _normalize(canonical) in norm:
            return canonical
        for alias in aliases:
            if _normalize(alias) in norm:
                return canonical
    return None


def normalize_proyecto(name: Optional[str]) -> Optional[str]:
    if not name:
        return name
    match = _match_catalog(name, _get_projects())
    return match if match else name


def normalize_asesor(name: Optional[str]) -> Optional[str]:
    if not name:
        return name
    match = _match_catalog(name, _get_advisors())
    return match if match else name


def normalize_project_list(names: Iterable[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for n in names or []:
        if not isinstance(n, str):
            continue
        canonical = normalize_proyecto(n) or n
        key = _normalize(canonical)
        if key and key not in seen:
            seen.add(key)
            out.append(canonical)
    return out


def proyectos_context_string() -> str:
    return "\n".join(f"  - {canonical}" for canonical, _ in _get_projects())


def asesores_context_string() -> str:
    return ", ".join(canonical for canonical, _ in _get_advisors())
