-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 007 — Índices faltantes para queries calientes
-- ══════════════════════════════════════════════════════════════
-- Fecha: 2026-04-23
-- Idempotente.
--
-- Auditoría detectó queries que hacen full scan de tablas medianas:
--   1) qr_share_tokens: filtro `only_active` por (revoked_at, used_at, expires_at)
--   2) lead_analysis_history: filtros por (lead_id, status, started_at) en
--      mark_history_processing/completed/failed.
--   3) leads.conversation_id ya tiene UNIQUE — confirmamos que sigue ahí.
-- ══════════════════════════════════════════════════════════════

-- 1) qr_share_tokens: index parcial para "tokens activos" (más frecuente).
-- Cubre: WHERE revoked_at IS NULL AND used_at IS NULL AND expires_at > NOW()
CREATE INDEX IF NOT EXISTS idx_qr_tokens_active
    ON qr_share_tokens(expires_at)
    WHERE revoked_at IS NULL AND used_at IS NULL;

-- 2) lead_analysis_history: compuesto para mark_history_*.
-- Las queries hacen WHERE lead_id=? AND status=? ORDER BY started_at.
CREATE INDEX IF NOT EXISTS idx_lah_lead_status_started
    ON lead_analysis_history(lead_id, status, started_at DESC);

-- 3) lead_analysis_history: index para query del endpoint /analysis-history
-- (filtra por lead_id, ordena por started_at DESC).
CREATE INDEX IF NOT EXISTS idx_lah_lead_started
    ON lead_analysis_history(lead_id, started_at DESC);

-- 4) Garantizar UNIQUE(conversation_id) en leads. El schema.sql lo declara,
-- pero migraciones viejas pueden no tenerlo. Si ya existe, este DO no hace
-- nada (no se puede usar IF NOT EXISTS con ADD CONSTRAINT en pg <11).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'leads_conversation_id_key'
    ) THEN
        ALTER TABLE leads ADD CONSTRAINT leads_conversation_id_key UNIQUE (conversation_id);
    END IF;
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END$$;

-- 5) cost queries: index sobre processed_at/completed_at SOLO para 'completed'
-- (la mayoría de queries filtran por status='completed' además de la fecha).
CREATE INDEX IF NOT EXISTS idx_transcriptions_completed_at
    ON transcriptions(processed_at)
    WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_lah_completed_at
    ON lead_analysis_history(completed_at)
    WHERE status = 'completed';

COMMIT;
