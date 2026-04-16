-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 001 — Ampliar VARCHAR(10) demasiado cortos
-- ══════════════════════════════════════════════════════════════
-- Los campos con DEFAULT 'desconocido' (11 chars) no cabían en
-- VARCHAR(10), rompiendo la escritura del analyzer con:
--   "value too long for type character varying(10)"
--
-- Aplicar sobre un despliegue existente (el schema.sql sólo corre
-- en la inicialización del volumen postgres_data):
--   docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
--     < db/migrations/001_widen_varchar_enums.sql
-- ══════════════════════════════════════════════════════════════

ALTER TABLE lead_financials
    ALTER COLUMN has_bank_preapproval TYPE VARCHAR(32),
    ALTER COLUMN offers_trade_in      TYPE VARCHAR(32),
    ALTER COLUMN depends_on_selling   TYPE VARCHAR(32);

ALTER TABLE lead_intent
    ALTER COLUMN is_decision_maker TYPE VARCHAR(32);

ALTER TABLE conversation_outcomes
    ALTER COLUMN recovery_probability TYPE VARCHAR(32);
