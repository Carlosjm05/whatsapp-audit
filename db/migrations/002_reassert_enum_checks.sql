-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 002 — Re-asegurar CHECK constraints de enums
-- ══════════════════════════════════════════════════════════════
-- Despliegues antiguos pueden tener CHECK constraints inconsistentes
-- (por ejemplo, sin 'desconocido' en yes/no/unknown). Esta migración
-- DROPs e inserta las versiones correctas de todos los CHECK que el
-- analyzer usa.
--
-- Aplicar:
--   docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
--     < db/migrations/002_reassert_enum_checks.sql
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- ─── lead_financials ─────────────────────────────────────────
ALTER TABLE lead_financials
    DROP CONSTRAINT IF EXISTS lead_financials_has_bank_preapproval_check,
    DROP CONSTRAINT IF EXISTS lead_financials_offers_trade_in_check,
    DROP CONSTRAINT IF EXISTS lead_financials_depends_on_selling_check,
    DROP CONSTRAINT IF EXISTS lead_financials_budget_range_check,
    DROP CONSTRAINT IF EXISTS lead_financials_payment_method_check;

ALTER TABLE lead_financials
    ADD CONSTRAINT lead_financials_has_bank_preapproval_check
        CHECK (has_bank_preapproval IN ('si', 'no', 'desconocido')),
    ADD CONSTRAINT lead_financials_offers_trade_in_check
        CHECK (offers_trade_in IN ('si', 'no', 'desconocido')),
    ADD CONSTRAINT lead_financials_depends_on_selling_check
        CHECK (depends_on_selling IN ('si', 'no', 'desconocido')),
    ADD CONSTRAINT lead_financials_budget_range_check
        CHECK (budget_range IN ('menos_50m', '50_100m', '100_200m', '200_500m', 'mas_500m', 'no_especificado')),
    ADD CONSTRAINT lead_financials_payment_method_check
        CHECK (payment_method IN ('contado', 'credito_bancario', 'leasing', 'financiacion_directa', 'cuotas', 'subsidio', 'mixto', 'no_especificado'));

-- ─── lead_interests ──────────────────────────────────────────
ALTER TABLE lead_interests
    DROP CONSTRAINT IF EXISTS lead_interests_product_type_check,
    DROP CONSTRAINT IF EXISTS lead_interests_purpose_check;

ALTER TABLE lead_interests
    ADD CONSTRAINT lead_interests_product_type_check
        CHECK (product_type IN ('lote', 'arriendo', 'compra_inmueble', 'inversion', 'local_comercial', 'bodega', 'finca', 'otro')),
    ADD CONSTRAINT lead_interests_purpose_check
        CHECK (purpose IN ('vivienda_propia', 'inversion', 'negocio', 'arrendar_terceros', 'otro', 'no_especificado'));

-- ─── lead_intent ─────────────────────────────────────────────
ALTER TABLE lead_intent
    DROP CONSTRAINT IF EXISTS lead_intent_urgency_check,
    DROP CONSTRAINT IF EXISTS lead_intent_is_decision_maker_check;

ALTER TABLE lead_intent
    ADD CONSTRAINT lead_intent_urgency_check
        CHECK (urgency IN ('comprar_ya', '1_3_meses', '3_6_meses', 'mas_6_meses', 'no_sabe', 'no_especificado')),
    ADD CONSTRAINT lead_intent_is_decision_maker_check
        CHECK (is_decision_maker IN ('si', 'no_pareja', 'no_socio', 'no_familiar', 'desconocido'));

-- ─── lead_objections ─────────────────────────────────────────
ALTER TABLE lead_objections
    DROP CONSTRAINT IF EXISTS lead_objections_objection_type_check;

ALTER TABLE lead_objections
    ADD CONSTRAINT lead_objections_objection_type_check
        CHECK (objection_type IN ('precio', 'ubicacion', 'confianza', 'tiempo', 'financiacion', 'competencia', 'condiciones_inmueble', 'documentacion', 'otro'));

-- ─── leads ───────────────────────────────────────────────────
ALTER TABLE leads
    DROP CONSTRAINT IF EXISTS leads_lead_source_check;

ALTER TABLE leads
    ADD CONSTRAINT leads_lead_source_check
        CHECK (lead_source IN ('anuncio_facebook', 'anuncio_instagram', 'google_ads', 'referido', 'busqueda_organica', 'portal_inmobiliario', 'otro', 'desconocido'));

-- ─── conversation_outcomes ───────────────────────────────────
ALTER TABLE conversation_outcomes
    DROP CONSTRAINT IF EXISTS conversation_outcomes_final_status_check,
    DROP CONSTRAINT IF EXISTS conversation_outcomes_recovery_probability_check,
    DROP CONSTRAINT IF EXISTS conversation_outcomes_recovery_priority_check;

ALTER TABLE conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_final_status_check
        CHECK (final_status IN (
            'venta_cerrada', 'visita_agendada', 'negociacion_activa',
            'seguimiento_activo', 'se_enfrio', 'ghosteado_por_asesor',
            'ghosteado_por_lead', 'descalificado', 'nunca_calificado',
            'spam', 'numero_equivocado', 'datos_insuficientes'
        )),
    ADD CONSTRAINT conversation_outcomes_recovery_probability_check
        CHECK (recovery_probability IN ('alta', 'media', 'baja', 'no_aplica')),
    ADD CONSTRAINT conversation_outcomes_recovery_priority_check
        CHECK (recovery_priority IN ('esta_semana', 'este_mes', 'puede_esperar', 'no_aplica'));

-- ─── response_times ──────────────────────────────────────────
ALTER TABLE response_times
    DROP CONSTRAINT IF EXISTS response_times_response_time_category_check;

ALTER TABLE response_times
    ADD CONSTRAINT response_times_response_time_category_check
        CHECK (response_time_category IN ('excelente', 'bueno', 'regular', 'malo', 'critico'));

COMMIT;
