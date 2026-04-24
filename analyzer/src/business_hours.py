"""Cálculo de tiempos de respuesta dentro de horario laboral.

Reglas de negocio de Óscar (definidas el 2026-04-23):
  - Horario activo: Lunes a Sábado, 7:00 a 19:00 (hora local Colombia).
  - Domingos: NO se mide tiempo de respuesta — se trackea aparte como
    métrica separada para visibilidad sin que infle los KPIs.
  - Si el lead escribe fuera del horario activo, el tiempo de respuesta
    empieza a contarse al inicio del próximo bloque activo.
  - Si la respuesta cae fuera del horario activo, ese tramo no cuenta.

Esto reemplaza el viejo cálculo wall-clock que mostraba 36 horas para
mensajes nocturnos / fin de semana, distorsionando todas las métricas.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Tuple


# Configuración (constantes para que sea trivial de auditar / cambiar).
BUSINESS_START_HOUR = 7      # 07:00
BUSINESS_END_HOUR = 19       # 19:00
# weekday(): Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
BUSINESS_WEEKDAYS = {0, 1, 2, 3, 4, 5}   # Lun-Sáb. Sin domingos.
SUNDAY = 6


def is_business_time(dt: datetime) -> bool:
    """¿Está dentro de Lun-Sáb 7-19?"""
    if dt.weekday() not in BUSINESS_WEEKDAYS:
        return False
    return BUSINESS_START_HOUR <= dt.hour < BUSINESS_END_HOUR


def is_sunday(dt: datetime) -> bool:
    return dt.weekday() == SUNDAY


def _next_business_open(dt: datetime) -> datetime:
    """Devuelve el próximo instante de apertura activa >= dt."""
    cur = dt
    # Bucle máx 14 iteraciones (2 semanas) — siempre encuentra apertura.
    for _ in range(14):
        if cur.weekday() in BUSINESS_WEEKDAYS:
            open_time = cur.replace(
                hour=BUSINESS_START_HOUR, minute=0, second=0, microsecond=0
            )
            close_time = cur.replace(
                hour=BUSINESS_END_HOUR, minute=0, second=0, microsecond=0
            )
            if cur < open_time:
                return open_time
            if cur < close_time:
                return cur          # ya estamos dentro
            # Después del cierre: ir al día siguiente al inicio.
        # Avanzar al siguiente día a las 00:00.
        cur = (cur + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    # Edge case extremo (no debería pasar).
    return dt


def business_minutes_between(start: datetime, end: datetime) -> float:
    """Minutos *de horario laboral* transcurridos entre `start` y `end`.

    Si el rango cae 100% fuera del horario, devuelve 0. Si cubre noches
    o fines de semana, esos tramos no cuentan.

    Asumimos timezone consistente en ambos timestamps (no hace
    conversiones — quien llama debe normalizar a hora local Colombia).
    """
    if end <= start:
        return 0.0

    total_seconds = 0.0
    # Iteramos día por día desde start hasta end, sumando solo el tramo
    # que cae dentro del horario activo de cada día.
    cur = start
    safety = 0
    while cur < end and safety < 400:   # 400 días = >1 año, suficiente
        safety += 1
        if cur.weekday() in BUSINESS_WEEKDAYS:
            day_open = cur.replace(
                hour=BUSINESS_START_HOUR, minute=0, second=0, microsecond=0
            )
            day_close = cur.replace(
                hour=BUSINESS_END_HOUR, minute=0, second=0, microsecond=0
            )
            # Intersección [max(cur, day_open), min(end, day_close)]
            seg_start = max(cur, day_open)
            seg_end = min(end, day_close)
            if seg_end > seg_start:
                total_seconds += (seg_end - seg_start).total_seconds()
        # Saltar al inicio del próximo día.
        cur = (cur + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

    return round(total_seconds / 60.0, 2)


def response_time_minutes(
    lead_msg_at: datetime,
    advisor_msg_at: datetime,
) -> Tuple[float, str]:
    """Calcula el tiempo de respuesta efectivo y devuelve también el
    bucket: 'business' (Lun-Sáb 7-19) o 'sunday'.

    REGLAS:
      - Si AMBOS mensajes son del MISMO domingo → bucket 'sunday',
        wall-clock minutes (Óscar quiere ver cuánto tarda el asesor
        cuando responde activamente en domingo).
      - Si el lead escribe domingo y el asesor responde lunes o
        después → bucket 'business', tiempo desde el lunes 7am.
        Esto evita que un caso "lead escribió domingo, asesor
        respondió martes" infle artificialmente el avg de domingo
        con números tipo 4000 min.
      - Si el lead escribe entre semana fuera de horario (ej. mar
        23:00) → bucket 'business', tiempo desde el próximo abrir.
      - Si el asesor responde antes del próximo abrir → 0 min.
    """
    # Caso "respuesta dentro del mismo domingo"
    if is_sunday(lead_msg_at) and is_sunday(advisor_msg_at):
        # Asegurar que es la MISMA fecha domingo (no dos domingos distintos
        # con una semana de diferencia, lo cual sería absurdo pero defensivo).
        if lead_msg_at.date() == advisor_msg_at.date():
            wall_clock = (advisor_msg_at - lead_msg_at).total_seconds() / 60.0
            return round(max(0.0, wall_clock), 2), "sunday"

    # Caso "respuesta dentro del mismo bloque business" o cualquier
    # otro caso (incluido "lead domingo, respuesta lun+"):
    effective_start = _next_business_open(lead_msg_at)
    if advisor_msg_at <= effective_start:
        # Asesor respondió ANTES del próximo bloque laboral (overachiever)
        # o el lead escribió en horario y el asesor también.
        # Si ambos están dentro de horario activo, el cálculo correcto es
        # la diferencia directa.
        if is_business_time(lead_msg_at) and is_business_time(advisor_msg_at):
            mins = (advisor_msg_at - lead_msg_at).total_seconds() / 60.0
            return round(max(0.0, mins), 2), "business"
        return 0.0, "business"
    return business_minutes_between(effective_start, advisor_msg_at), "business"
