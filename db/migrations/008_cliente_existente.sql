-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 008 — final_status 'cliente_existente' + ghost_score
-- ══════════════════════════════════════════════════════════════
-- Fecha: 2026-04-24
-- Idempotente.
--
-- 1) Agrega 'cliente_existente' al enum final_status (clientes que ya
--    compraron y siguen hablando por postventa: escrituración, obra,
--    trámites). Antes se confundían con negociacion_activa o
--    seguimiento_activo y aparecían como "recuperables".
-- 2) Agrega columna ghost_score en conversation_outcomes para ordenar
--    en /ghosts por prioridad de recuperación ponderada.
-- ══════════════════════════════════════════════════════════════

-- 1) Re-emitir el CHECK constraint de final_status + manual_status
-- con el valor nuevo. Postgres no permite ALTER ... ADD VALUE sobre
-- check constraints, hay que DROP + ADD.
ALTER TABLE conversation_outcomes
    DROP CONSTRAINT IF EXISTS conversation_outcomes_final_status_check;

ALTER TABLE conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_final_status_check
    CHECK (final_status IN (
        'venta_cerrada', 'cliente_existente', 'visita_agendada',
        'negociacion_activa', 'seguimiento_activo', 'se_enfrio',
        'ghosteado_por_asesor', 'ghosteado_por_lead', 'descalificado',
        'nunca_calificado', 'spam', 'numero_equivocado', 'datos_insuficientes'
    ));

ALTER TABLE conversation_outcomes
    DROP CONSTRAINT IF EXISTS conversation_outcomes_manual_status_check;

ALTER TABLE conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_manual_status_check
    CHECK (manual_status IS NULL OR manual_status IN (
        'venta_cerrada', 'cliente_existente', 'visita_agendada',
        'negociacion_activa', 'seguimiento_activo', 'se_enfrio',
        'ghosteado_por_asesor', 'ghosteado_por_lead', 'descalificado',
        'nunca_calificado', 'spam', 'numero_equivocado', 'datos_insuficientes'
    ));

-- 2) ghost_score: 0..100, calculado por Python al persistir análisis.
-- Se usa para ordenar /ghosts por ROI de recuperación.
ALTER TABLE conversation_outcomes
    ADD COLUMN IF NOT EXISTS ghost_score INTEGER;

CREATE INDEX IF NOT EXISTS idx_outcomes_ghost_score
    ON conversation_outcomes(ghost_score DESC NULLS LAST);

COMMIT;
