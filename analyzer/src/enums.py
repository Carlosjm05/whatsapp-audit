"""Enums compartidos entre validator.py y db.py.

Antes estaban duplicados idénticos en ambos módulos (con sufijo `_SET` en
db.py), lo que hacía que cualquier cambio requiriera editar dos lugares y
era fuente común de bugs. Vive aquí como única fuente de verdad.
"""
from __future__ import annotations


LEAD_SOURCES = {
    "anuncio_facebook", "anuncio_instagram", "google_ads", "referido",
    "busqueda_organica", "portal_inmobiliario", "otro", "desconocido",
}

PRODUCT_TYPES = {
    "lote", "arriendo", "compra_inmueble", "inversion", "local_comercial",
    "bodega", "finca", "otro",
}

PURPOSES = {
    "vivienda_propia", "inversion", "negocio", "arrendar_terceros", "otro",
    "no_especificado",
}

BUDGET_RANGES = {
    "menos_50m", "50_100m", "100_200m", "200_500m", "mas_500m",
    "no_especificado",
}

PAYMENT_METHODS = {
    "contado", "credito_bancario", "leasing", "financiacion_directa",
    "cuotas", "subsidio", "mixto", "no_especificado",
}

YES_NO_UNKNOWN = {"si", "no", "desconocido"}

URGENCIES = {
    "comprar_ya", "1_3_meses", "3_6_meses", "mas_6_meses", "no_sabe",
    "no_especificado",
}

DECISION_MAKERS = {"si", "no_pareja", "no_socio", "no_familiar", "desconocido"}

OBJECTION_TYPES = {
    "precio", "ubicacion", "confianza", "tiempo", "financiacion",
    "competencia", "condiciones_inmueble", "documentacion", "otro",
}

RESPONSE_TIME_CATEGORIES = {"excelente", "bueno", "regular", "malo", "critico"}

FINAL_STATUSES = {
    "venta_cerrada", "visita_agendada", "negociacion_activa",
    "seguimiento_activo", "se_enfrio", "ghosteado_por_asesor",
    "ghosteado_por_lead", "descalificado", "nunca_calificado", "spam",
    "numero_equivocado", "datos_insuficientes",
}

RECOVERY_PROB = {"alta", "media", "baja", "no_aplica"}

RECOVERY_PRIORITY = {"esta_semana", "este_mes", "puede_esperar", "no_aplica"}
