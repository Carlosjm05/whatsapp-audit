-- ══════════════════════════════════════════════════════════════
-- WHATSAPP AUDIT SYSTEM — ESQUEMA DE BASE DE DATOS
-- ══════════════════════════════════════════════════════════════
-- Ejecutado automáticamente al crear el contenedor de PostgreSQL
-- ══════════════════════════════════════════════════════════════

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- búsqueda fuzzy de texto

-- ─────────────────────────────────────────────
-- TABLA: extraction_runs
-- Registro de cada corrida de extracción
-- ─────────────────────────────────────────────
CREATE TABLE extraction_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'paused')),
    total_chats     INTEGER DEFAULT 0,
    extracted_chats INTEGER DEFAULT 0,
    failed_chats    INTEGER DEFAULT 0,
    error_log       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: raw_conversations
-- Conversaciones crudas extraídas de WhatsApp
-- ─────────────────────────────────────────────
CREATE TABLE raw_conversations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    extraction_run_id   UUID REFERENCES extraction_runs(id),
    chat_id             VARCHAR(50) NOT NULL UNIQUE,
    phone               VARCHAR(20),
    whatsapp_name       VARCHAR(255),
    is_group            BOOLEAN DEFAULT false,
    total_messages      INTEGER DEFAULT 0,
    total_audios        INTEGER DEFAULT 0,
    total_images        INTEGER DEFAULT 0,
    total_documents     INTEGER DEFAULT 0,
    first_message_at    TIMESTAMPTZ,
    last_message_at     TIMESTAMPTZ,
    raw_data_path       TEXT,
    extraction_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (extraction_status IN ('pending', 'extracting', 'extracted', 'failed', 'skipped')),
    extraction_error    TEXT,
    retry_count         INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: messages
-- Cada mensaje individual extraído
-- ─────────────────────────────────────────────
CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id     UUID NOT NULL REFERENCES raw_conversations(id) ON DELETE CASCADE,
    message_id          VARCHAR(100) NOT NULL,
    timestamp           TIMESTAMPTZ NOT NULL,
    sender              VARCHAR(50) NOT NULL CHECK (sender IN ('lead', 'asesor', 'system')),
    sender_phone        VARCHAR(20),
    sender_name         VARCHAR(255),
    message_type        VARCHAR(20) NOT NULL
                        CHECK (message_type IN ('text', 'audio', 'image', 'video', 'document', 'sticker', 'location', 'contact', 'other')),
    body                TEXT,
    media_path          TEXT,
    media_size_bytes    BIGINT,
    media_duration_sec  INTEGER,
    media_mimetype      VARCHAR(100),
    is_forwarded        BOOLEAN DEFAULT false,
    is_reply            BOOLEAN DEFAULT false,
    reply_to_id         VARCHAR(100),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(conversation_id, message_id)
);

-- ─────────────────────────────────────────────
-- TABLA: transcriptions
-- Transcripciones de audios (Whisper)
-- ─────────────────────────────────────────────
CREATE TABLE transcriptions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id          UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    conversation_id     UUID NOT NULL REFERENCES raw_conversations(id) ON DELETE CASCADE,
    audio_duration_sec  INTEGER,
    transcription_text  TEXT,
    confidence_score    DECIMAL(4,3),
    language            VARCHAR(10) DEFAULT 'es',
    is_low_confidence   BOOLEAN DEFAULT false,
    whisper_model       VARCHAR(50) DEFAULT 'whisper-1',
    cost_usd            DECIMAL(8,6),
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
    error_message       TEXT,
    retry_count         INTEGER DEFAULT 0,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: unified_transcripts
-- Transcript completo unificado (texto + audios)
-- Esto es lo que se le pasa a Claude
-- ─────────────────────────────────────────────
CREATE TABLE unified_transcripts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id     UUID NOT NULL UNIQUE REFERENCES raw_conversations(id) ON DELETE CASCADE,
    full_transcript     TEXT NOT NULL,
    total_messages      INTEGER DEFAULT 0,
    total_from_lead     INTEGER DEFAULT 0,
    total_from_asesor   INTEGER DEFAULT 0,
    total_audios_included INTEGER DEFAULT 0,
    total_audios_failed INTEGER DEFAULT 0,
    word_count          INTEGER DEFAULT 0,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: leads
-- Datos principales del lead (extraídos por IA)
-- ─────────────────────────────────────────────
CREATE TABLE leads (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id         UUID NOT NULL UNIQUE REFERENCES raw_conversations(id) ON DELETE CASCADE,
    phone                   VARCHAR(20),
    whatsapp_name           VARCHAR(255),
    real_name               VARCHAR(255),
    city                    VARCHAR(255),
    zone                    VARCHAR(255),
    -- Demografía inferida del chat (prompt v2, 2026-04-17). Nullable.
    occupation              VARCHAR(150),
    age_range               VARCHAR(20)
                            CHECK (age_range IS NULL OR age_range IN ('18-25','25-35','35-50','50-65','65+','desconocido')),
    family_context          TEXT,
    analysis_confidence     VARCHAR(10)
                            CHECK (analysis_confidence IS NULL OR analysis_confidence IN ('alta','media','baja')),
    lead_source             VARCHAR(50)
                            CHECK (lead_source IN ('anuncio_facebook', 'anuncio_instagram', 'google_ads', 'referido', 'busqueda_organica', 'portal_inmobiliario', 'otro', 'desconocido')),
    lead_source_detail      TEXT,
    first_contact_at        TIMESTAMPTZ,
    last_contact_at         TIMESTAMPTZ,
    conversation_days       INTEGER,
    datos_insuficientes     BOOLEAN DEFAULT false,
    analysis_status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed', 'insufficient_data')),
    analysis_error          TEXT,
    analysis_retry_count    INTEGER DEFAULT 0,
    analyzed_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: lead_interests
-- Qué le interesa al lead (lista: N por lead)
-- ─────────────────────────────────────────────
CREATE TABLE lead_interests (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    product_type        VARCHAR(50)
                        CHECK (product_type IN ('lote', 'arriendo', 'compra_inmueble', 'inversion', 'local_comercial', 'bodega', 'finca', 'otro')),
    project_name        VARCHAR(255),
    all_projects_mentioned TEXT[],
    desired_zone        VARCHAR(255),
    desired_size        TEXT,
    desired_features    TEXT,
    purpose             VARCHAR(50)
                        CHECK (purpose IN ('vivienda_propia', 'inversion', 'negocio', 'arrendar_terceros', 'otro', 'no_especificado')),
    specific_conditions TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: lead_financials
-- Situación financiera del lead (UNIQUE por lead)
-- ─────────────────────────────────────────────
CREATE TABLE lead_financials (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    budget_verbatim             TEXT,
    budget_estimated_cop        BIGINT,
    budget_range                VARCHAR(30)
                                CHECK (budget_range IN ('menos_50m', '50_100m', '100_200m', '200_500m', 'mas_500m', 'no_especificado')),
    payment_method              VARCHAR(50)
                                CHECK (payment_method IN ('contado', 'credito_bancario', 'leasing', 'financiacion_directa', 'cuotas', 'subsidio', 'mixto', 'no_especificado')),
    has_bank_preapproval        VARCHAR(32) DEFAULT 'desconocido'
                                CHECK (has_bank_preapproval IN ('si', 'no', 'desconocido')),
    offers_trade_in             VARCHAR(32) DEFAULT 'desconocido'
                                CHECK (offers_trade_in IN ('si', 'no', 'desconocido')),
    depends_on_selling          VARCHAR(32) DEFAULT 'desconocido'
                                CHECK (depends_on_selling IN ('si', 'no', 'desconocido')),
    positive_financial_signals  TEXT[],
    negative_financial_signals  TEXT[],
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: lead_intent
-- Intención y urgencia de compra (UNIQUE por lead)
-- ─────────────────────────────────────────────
CREATE TABLE lead_intent (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                 UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    intent_score            SMALLINT DEFAULT 5 CHECK (intent_score BETWEEN 1 AND 10),
    intent_justification    TEXT,
    urgency                 VARCHAR(30)
                            CHECK (urgency IN ('comprar_ya', '1_3_meses', '3_6_meses', 'mas_6_meses', 'no_sabe', 'no_especificado')),
    high_urgency_signals    TEXT[],
    low_urgency_signals     TEXT[],
    is_decision_maker       VARCHAR(32) DEFAULT 'desconocido'
                            CHECK (is_decision_maker IN ('si', 'no_pareja', 'no_socio', 'no_familiar', 'desconocido')),
    comparing_competitors   BOOLEAN DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: lead_objections
-- Objeciones y dudas del lead (lista: N por lead)
-- ─────────────────────────────────────────────
CREATE TABLE lead_objections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    objection_text      TEXT NOT NULL,
    objection_verbatim  TEXT,
    objection_type      VARCHAR(30)
                        CHECK (objection_type IN ('precio', 'ubicacion', 'confianza', 'tiempo', 'financiacion', 'competencia', 'condiciones_inmueble', 'documentacion', 'otro')),
    was_resolved        BOOLEAN DEFAULT false,
    advisor_response    TEXT,
    response_quality    SMALLINT CHECK (response_quality BETWEEN 1 AND 10),
    is_hidden_objection BOOLEAN DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: conversation_metrics
-- Métricas de la conversación (UNIQUE por lead)
-- ─────────────────────────────────────────────
CREATE TABLE conversation_metrics (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id             UUID NOT NULL REFERENCES raw_conversations(id) ON DELETE CASCADE,
    total_messages              INTEGER DEFAULT 0,
    advisor_messages            INTEGER DEFAULT 0,
    lead_messages               INTEGER DEFAULT 0,
    advisor_audios              INTEGER DEFAULT 0,
    lead_audios                 INTEGER DEFAULT 0,
    sent_project_info           BOOLEAN DEFAULT false,
    sent_prices                 BOOLEAN DEFAULT false,
    asked_qualification_questions BOOLEAN DEFAULT false,
    offered_alternatives        BOOLEAN DEFAULT false,
    proposed_visit              BOOLEAN DEFAULT false,
    attempted_close             BOOLEAN DEFAULT false,
    did_followup                BOOLEAN DEFAULT false,
    followup_attempts           INTEGER DEFAULT 0,
    used_generic_messages       BOOLEAN DEFAULT false,
    answered_all_questions      BOOLEAN DEFAULT false,
    unanswered_questions        TEXT[],
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: response_times
-- Tiempos de respuesta (UNIQUE por lead)
-- ─────────────────────────────────────────────
CREATE TABLE response_times (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    first_response_minutes      DECIMAL(10,2),
    avg_response_minutes        DECIMAL(10,2),
    longest_gap_hours           DECIMAL(10,2),
    unanswered_messages_count   INTEGER DEFAULT 0,
    lead_had_to_repeat          BOOLEAN DEFAULT false,
    repeat_count                INTEGER DEFAULT 0,
    advisor_active_hours        TEXT,
    response_time_category      VARCHAR(20)
                                CHECK (response_time_category IN ('excelente', 'bueno', 'regular', 'malo', 'critico')),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: advisor_scores
-- Calificación del asesor por conversación (UNIQUE por lead)
-- ─────────────────────────────────────────────
CREATE TABLE advisor_scores (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id             UUID NOT NULL REFERENCES raw_conversations(id) ON DELETE CASCADE,
    advisor_name                VARCHAR(255),
    advisor_phone               VARCHAR(20),
    -- Todos los asesores que intervinieron (en WhatsApp compartido).
    advisors_involved           TEXT[] DEFAULT ARRAY[]::TEXT[],
    speed_score                 SMALLINT CHECK (speed_score BETWEEN 1 AND 10),
    qualification_score         SMALLINT CHECK (qualification_score BETWEEN 1 AND 10),
    product_presentation_score  SMALLINT CHECK (product_presentation_score BETWEEN 1 AND 10),
    objection_handling_score    SMALLINT CHECK (objection_handling_score BETWEEN 1 AND 10),
    closing_attempt_score       SMALLINT CHECK (closing_attempt_score BETWEEN 1 AND 10),
    followup_score              SMALLINT CHECK (followup_score BETWEEN 1 AND 10),
    overall_score               DECIMAL(4,2),
    -- Señales binarias (SLA duro de Oscar).
    speed_compliance            BOOLEAN,
    followup_compliance         BOOLEAN,
    errors_list                 TEXT[],
    strengths_list              TEXT[],
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: conversation_outcomes
-- En qué terminó la conversación (UNIQUE por lead)
-- ─────────────────────────────────────────────
CREATE TABLE conversation_outcomes (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    final_status                VARCHAR(30) NOT NULL
                                CHECK (final_status IN (
                                    'venta_cerrada',
                                    'visita_agendada',
                                    'negociacion_activa',
                                    'seguimiento_activo',
                                    'se_enfrio',
                                    'ghosteado_por_asesor',
                                    'ghosteado_por_lead',
                                    'descalificado',
                                    'nunca_calificado',
                                    'spam',
                                    'numero_equivocado',
                                    'datos_insuficientes'
                                )),
    loss_reason                 TEXT,
    loss_point_description      TEXT,
    is_recoverable              BOOLEAN DEFAULT false,
    recovery_probability        VARCHAR(32)
                                CHECK (recovery_probability IN ('alta', 'media', 'baja', 'no_aplica')),
    recovery_reason             TEXT,
    not_recoverable_reason      TEXT,
    recovery_strategy           TEXT,
    recovery_message_suggestion TEXT,
    alternative_product         TEXT,
    recovery_priority           VARCHAR(20)
                                CHECK (recovery_priority IN ('esta_semana', 'este_mes', 'puede_esperar', 'no_aplica')),
    -- Causa granular de la pérdida (prompt v2).
    perdido_por                 VARCHAR(40)
                                CHECK (perdido_por IS NULL OR perdido_por IN (
                                    'asesor_lento','asesor_sin_seguimiento','asesor_no_califico',
                                    'asesor_no_cerro','asesor_info_incompleta',
                                    'asesor_no_consulto_de_vuelta',
                                    'lead_desaparecio','lead_fuera_portafolio','lead_sin_decision',
                                    'lead_presupuesto','lead_competencia','ambos','no_aplica'
                                )),
    loss_point_verbatim         TEXT,
    peak_intent_verbatim        TEXT,
    next_concrete_action        TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: competitor_intel
-- Inteligencia competitiva (lista: N por lead)
-- ─────────────────────────────────────────────
CREATE TABLE competitor_intel (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                 UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    competitor_name         VARCHAR(255),
    competitor_offer        TEXT,
    why_considering         TEXT,
    went_with_competitor    BOOLEAN DEFAULT false,
    reason_chose_competitor TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: conversation_summaries
-- Resumen ejecutivo de cada conversación (UNIQUE por lead)
-- ─────────────────────────────────────────────
CREATE TABLE conversation_summaries (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id             UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id     UUID NOT NULL REFERENCES raw_conversations(id) ON DELETE CASCADE,
    summary_text        TEXT NOT NULL,
    key_takeaways       TEXT[],
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: dapta_knowledge_base
-- Base de conocimiento para Dapta
-- ─────────────────────────────────────────────
CREATE TABLE dapta_knowledge_base (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_type          VARCHAR(30) NOT NULL
                        CHECK (entry_type IN ('pregunta_frecuente', 'objecion_comun', 'senal_compra', 'senal_abandono', 'info_proyecto', 'respuesta_ideal')),
    category            VARCHAR(50),
    content_text        TEXT NOT NULL,
    verbatim_examples   TEXT[],
    frequency_count     INTEGER DEFAULT 1,
    related_project     VARCHAR(255),
    ideal_response      TEXT,
    source_leads        UUID[],
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: lead_analysis_history
-- Historial de cada análisis/re-análisis de un lead.
-- El análisis "actual" (leads.*) es siempre la última entrada
-- completada. Esta tabla preserva versiones anteriores.
-- Antes vivía en db/migrations/003_* — integrada aquí 2026-04-16.
-- ─────────────────────────────────────────────
CREATE TABLE lead_analysis_history (
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

-- ─────────────────────────────────────────────
-- TABLA: projects_catalog
-- Catálogo editable de proyectos de Ortiz Finca Raíz.
-- El analyzer lo usa para normalizar nombres de proyectos detectados.
-- Administrable desde /catalogos en el dashboard.
-- ─────────────────────────────────────────────
CREATE TABLE projects_catalog (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_name  VARCHAR(255) NOT NULL UNIQUE,
    aliases         TEXT[] DEFAULT ARRAY[]::TEXT[],
    project_type    VARCHAR(50),
    city            VARCHAR(100),
    description     TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_projects_catalog_active ON projects_catalog(is_active);

-- ─────────────────────────────────────────────
-- TABLA: advisors_catalog
-- Catálogo editable de asesores. Mismo propósito.
-- ─────────────────────────────────────────────
CREATE TABLE advisors_catalog (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_name  VARCHAR(255) NOT NULL UNIQUE,
    aliases         TEXT[] DEFAULT ARRAY[]::TEXT[],
    phone           VARCHAR(20),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_advisors_catalog_active ON advisors_catalog(is_active);

-- ─────────────────────────────────────────────
-- TABLA: admin_users
-- Multi-usuario para el dashboard. ADMIN_USER/ADMIN_PASSWORD del .env
-- siguen funcionando como fallback (un único super-admin baked-in).
-- Esta tabla agrega usuarios extra (operadores, viewers).
-- ─────────────────────────────────────────────
CREATE TABLE admin_users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(64) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,            -- bcrypt
    full_name       VARCHAR(150),
    role            VARCHAR(32) NOT NULL DEFAULT 'operator'
                    CHECK (role IN ('admin', 'operator', 'viewer')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_admin_users_username ON admin_users(LOWER(username));
CREATE INDEX idx_admin_users_active   ON admin_users(is_active);

CREATE OR REPLACE FUNCTION touch_admin_users_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_admin_users_touch
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION touch_admin_users_updated_at();

-- ─────────────────────────────────────────────
-- TABLA: qr_share_tokens
-- Links públicos temporales para que el cliente escanee el QR sin
-- loguearse. Single-use, expiran a los 10 min, se invalidan al
-- escanearse el QR exitosamente.
-- ─────────────────────────────────────────────
CREATE TABLE qr_share_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token           VARCHAR(64) NOT NULL UNIQUE,      -- random URL-safe (≥32 chars)
    created_by      VARCHAR(64) NOT NULL,             -- username del admin que lo generó
    note            VARCHAR(255),                      -- ej. "Para Oscar - 23 abr"
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,                      -- cuando se escaneó/usó
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_qr_tokens_token   ON qr_share_tokens(token);
CREATE INDEX idx_qr_tokens_expires ON qr_share_tokens(expires_at);

-- ─────────────────────────────────────────────
-- ALTER conversation_outcomes — manual override del análisis IA.
-- Si el operador marca manual_status, este TIENE PRECEDENCIA sobre
-- final_status en lecturas/UI. Permite corregir análisis equivocados
-- (ej. "ya pagó" detectado como lead activo).
-- ─────────────────────────────────────────────
ALTER TABLE conversation_outcomes
    ADD COLUMN IF NOT EXISTS manual_status        VARCHAR(30),
    ADD COLUMN IF NOT EXISTS manual_is_recoverable BOOLEAN,
    ADD COLUMN IF NOT EXISTS manual_notes         TEXT,
    ADD COLUMN IF NOT EXISTS manual_overridden_by VARCHAR(64),
    ADD COLUMN IF NOT EXISTS manual_overridden_at TIMESTAMPTZ;

ALTER TABLE conversation_outcomes
    ADD CONSTRAINT conversation_outcomes_manual_status_check
    CHECK (manual_status IS NULL OR manual_status IN (
        'venta_cerrada','visita_agendada','negociacion_activa',
        'seguimiento_activo','se_enfrio','ghosteado_por_asesor',
        'ghosteado_por_lead','descalificado','nunca_calificado',
        'spam','numero_equivocado','datos_insuficientes'
    ));

CREATE INDEX idx_outcomes_manual_status
    ON conversation_outcomes(manual_status)
    WHERE manual_status IS NOT NULL;
