-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 004 — Campos para el prompt v2 de Óscar
-- ══════════════════════════════════════════════════════════════
-- Agrega columnas nuevas para:
--   - Demografía del lead (ocupación, rango edad, contexto familiar)
--   - Confianza del análisis
--   - Compliance binarios del asesor (speed, followup)
--   - Múltiples asesores involucrados
--   - Causa granular de pérdida (perdido_por)
--   - Verbatims del punto de pérdida y pico de intención
--   - Acción concreta siguiente
--
-- Idempotente (ADD COLUMN IF NOT EXISTS + CHECK CONSTRAINT via DO block).
-- Aplicable en prod sin wipe.
-- ══════════════════════════════════════════════════════════════

-- ─── leads ────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS occupation VARCHAR(150);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS age_range VARCHAR(20);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS family_context TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS analysis_confidence VARCHAR(10);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_age_range_chk'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_age_range_chk
      CHECK (age_range IS NULL OR age_range IN
        ('18-25','25-35','35-50','50-65','65+','desconocido'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_analysis_confidence_chk'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_analysis_confidence_chk
      CHECK (analysis_confidence IS NULL OR analysis_confidence IN
        ('alta','media','baja'));
  END IF;
END $$;

-- ─── advisor_scores ───────────────────────────────────────
ALTER TABLE advisor_scores ADD COLUMN IF NOT EXISTS
    advisors_involved TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE advisor_scores ADD COLUMN IF NOT EXISTS speed_compliance BOOLEAN;
ALTER TABLE advisor_scores ADD COLUMN IF NOT EXISTS followup_compliance BOOLEAN;

-- ─── conversation_outcomes ────────────────────────────────
ALTER TABLE conversation_outcomes ADD COLUMN IF NOT EXISTS perdido_por VARCHAR(40);
ALTER TABLE conversation_outcomes ADD COLUMN IF NOT EXISTS loss_point_verbatim TEXT;
ALTER TABLE conversation_outcomes ADD COLUMN IF NOT EXISTS peak_intent_verbatim TEXT;
ALTER TABLE conversation_outcomes ADD COLUMN IF NOT EXISTS next_concrete_action TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outcomes_perdido_por_chk'
  ) THEN
    ALTER TABLE conversation_outcomes ADD CONSTRAINT outcomes_perdido_por_chk
      CHECK (perdido_por IS NULL OR perdido_por IN (
        'asesor_lento','asesor_sin_seguimiento','asesor_no_califico',
        'asesor_no_cerro','asesor_info_incompleta',
        'asesor_no_consulto_de_vuelta',
        'lead_desaparecio','lead_fuera_portafolio','lead_sin_decision',
        'lead_presupuesto','lead_competencia','ambos','no_aplica'
      ));
  END IF;
END $$;

-- ─── Índices útiles para el panel Leads fantasma ──────────
CREATE INDEX IF NOT EXISTS idx_outcomes_perdido_por ON conversation_outcomes(perdido_por);
CREATE INDEX IF NOT EXISTS idx_advisor_speed_compliance ON advisor_scores(speed_compliance)
    WHERE speed_compliance = false;
CREATE INDEX IF NOT EXISTS idx_advisor_followup_compliance ON advisor_scores(followup_compliance)
    WHERE followup_compliance = false;
