-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 006 — Tiempos de respuesta con horario laboral
-- ══════════════════════════════════════════════════════════════
-- Fecha: 2026-04-23
-- Idempotente.
--
-- Cambios:
--   1) Columnas sunday_avg_minutes + sunday_response_count en response_times.
--   2) NO modifica datos existentes — el script de recompute se corre
--      aparte: docker compose run --rm analyzer python -m src.recompute_metrics
-- ══════════════════════════════════════════════════════════════

ALTER TABLE response_times
    ADD COLUMN IF NOT EXISTS sunday_avg_minutes    DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS sunday_response_count INTEGER DEFAULT 0;

COMMIT;
