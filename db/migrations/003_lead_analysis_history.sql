-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 003 — Tabla lead_analysis_history para Feature 5
-- ══════════════════════════════════════════════════════════════
-- Registra cada análisis/re-análisis de un lead para historico.
-- El análisis "actual" (leads.*) es siempre la última entrada
-- completada. Esta tabla preserva versiones anteriores.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lead_analysis_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    triggered_by    VARCHAR(50) DEFAULT 'auto',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    model_used      VARCHAR(100),
    cost_usd        DECIMAL(10, 6),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    error_message   TEXT,
    diff_summary    TEXT,
    raw_output      JSONB
);

CREATE INDEX IF NOT EXISTS idx_lah_lead_id ON lead_analysis_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_lah_started_at ON lead_analysis_history(started_at DESC);
