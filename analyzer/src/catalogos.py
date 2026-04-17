"""Catálogos de proyectos y asesores conocidos de Ortiz Finca Raíz.

Se usan para:
  1. Dar contexto a Claude en el prompt (evitar que confunda ciudades
     con nombres de proyectos, o que invente asesores).
  2. Post-procesar la salida para normalizar nombres (ej. "Brisas"
     -> "Brisas del Río").

Si agregan un proyecto/asesor nuevo, actualizar este archivo y
reiniciar el analyzer.
"""
from __future__ import annotations

import unicodedata
from typing import Iterable, Optional


# ─── PROYECTOS ───────────────────────────────────────────────
# Cada entry: nombre canónico + lista de aliases (sin tildes, minúsculas).
# El orden importa: los más específicos primero (para que "Mirador de
# Anapoima campestre" gane sobre "Mirador de Anapoima" si ambos matchean).
PROYECTOS: list[tuple[str, list[str]]] = [
    ("Oasis del Olimpo", ["oasis del olimpo", "olimpo", "parcelacion olimpo",
                          "parcelación olimpo"]),
    ("Oasis Ecológico", ["oasis ecologico", "oasis ecológico", "oasis"]),
    ("Brisas del Río", ["brisas del rio", "brisas del río", "brisas"]),
    ("Caracolí", ["caracoli", "caracolí"]),
    ("Jardines de Bellavista", ["jardines de bellavista", "jardines bellavista"]),
    ("Bellavista", ["bellavista"]),
    ("Miramonte", ["miramonte"]),
    ("Cancún", ["cancun", "cancún"]),
    ("Fincas de San Isidro", ["fincas de san isidro", "san isidro", "fincas san isidro"]),
    ("Cielito Lindo", ["cielito lindo", "cielito"]),
    ("Mirador de Anapoima campestre",
        ["mirador de anapoima campestre", "mirador anapoima campestre"]),
    ("Condominio Mirador de Anapoima",
        ["condominio mirador de anapoima", "condominio mirador anapoima",
         "mirador de anapoima", "mirador anapoima"]),
    ("Cardón", ["cardon", "cardón"]),
]

# ─── ASESORES ────────────────────────────────────────────────
ASESORES: list[tuple[str, list[str]]] = [
    ("Ronald", ["ronald"]),
    ("Jhon", ["jhon", "john"]),
    ("Sandra", ["sandra"]),
    ("Tatiana", ["tatiana", "tati"]),
    ("Pilar", ["pilar"]),
    ("Valentina", ["valentina", "vale"]),
    ("Oscar", ["oscar", "óscar"]),
    ("Daniela", ["daniela", "dani"]),
]


def _normalize(s: str) -> str:
    """Lower + sin tildes + espacios colapsados."""
    if not s:
        return ""
    s = s.strip().lower()
    # Quitar tildes/diacríticos.
    s = "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )
    # Colapsar espacios.
    return " ".join(s.split())


def _match_catalog(value: Optional[str],
                   catalog: list[tuple[str, list[str]]]) -> Optional[str]:
    """Devuelve el nombre canónico si `value` hace match con algún alias,
    o None si no encuentra nada. Busca substring match — ej. si el lead
    dijo "el proyecto brisas del rio me interesa", matchea 'brisas del rio'.
    """
    if not value:
        return None
    norm = _normalize(value)
    if not norm:
        return None
    # Orden del catálogo importa: entries más específicos van primero.
    for canonical, aliases in catalog:
        for alias in aliases:
            if alias in norm:
                return canonical
    return None


def normalize_proyecto(name: Optional[str]) -> Optional[str]:
    """Dado un nombre de proyecto crudo (lo que devuelve Claude), intenta
    mapear al nombre canónico del catálogo. Si no hace match con ningún
    alias conocido, devuelve el valor original (Claude pudo haber detectado
    un proyecto nuevo que aún no está en el catálogo)."""
    if not name:
        return name
    match = _match_catalog(name, PROYECTOS)
    return match if match else name


def normalize_asesor(name: Optional[str]) -> Optional[str]:
    """Dado un nombre de asesor crudo, mapea al canónico. Si no matchea,
    devuelve el valor original (podría ser un asesor nuevo o un nombre
    distinto)."""
    if not name:
        return name
    match = _match_catalog(name, ASESORES)
    return match if match else name


def normalize_project_list(names: Iterable[str]) -> list[str]:
    """Normaliza una lista de proyectos deduplicando por nombre canónico."""
    seen: set[str] = set()
    out: list[str] = []
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
    """Devuelve una lista formateada de proyectos conocidos para meter
    en el prompt."""
    return "\n".join(f"  - {canonical}" for canonical, _ in PROYECTOS)


def asesores_context_string() -> str:
    """Devuelve una lista formateada de asesores conocidos para el prompt."""
    return ", ".join(canonical for canonical, _ in ASESORES)
