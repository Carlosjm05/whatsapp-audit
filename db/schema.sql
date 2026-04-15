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
    total_audios    INTEGER DEFAULT 0,
    total_media     INTEGER DEFAULT 0,
    disk_usage_mb   DECIMAL(10,2) DEFAULT 0,
    error_log       TEXT,
    metadata        JSONB DEFAULT '{}'::jsonb,
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
-- Qué le interesa al lead
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
-- Situación financiera del lead
-- ─────────────────────────────────────────────
CREATE TABLE lead_financials (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    budget_verbatim             TEXT,
    budget_estimated_cop        BIGINT,
    budget_range                VARCHAR(30)
                                CHECK (budget_range IN ('menos_50m', '50_100m', '100_200m', '200_500m', 'mas_500m', 'no_especificado')),
    payment_method              VARCHAR(50)
                                CHECK (payment_method IN ('contado', 'credito_bancario', 'leasing', 'financiacion_directa', 'cuotas', 'subsidio', 'mixto', 'no_especificado')),
    has_bank_preapproval        VARCHAR(10) DEFAULT 'desconocido'
                                CHECK (has_bank_preapproval IN ('si', 'no', 'desconocido')),
    offers_trade_in             VARCHAR(10) DEFAULT 'desconocido'
                                CHECK (offers_trade_in IN ('si', 'no', 'desconocido')),
    depends_on_selling          VARCHAR(10) DEFAULT 'desconocido'
                                CHECK (depends_on_selling IN ('si', 'no', 'desconocido')),
    positive_financial_signals  TEXT[],
    negative_financial_signals  TEXT[],
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: lead_intent
-- Intención y urgencia de compra
-- ─────────────────────────────────────────────
CREATE TABLE lead_intent (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                 UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    intent_score            SMALLINT CHECK (intent_score BETWEEN 1 AND 10),
    intent_justification    TEXT,
    urgency                 VARCHAR(30)
                            CHECK (urgency IN ('comprar_ya', '1_3_meses', '3_6_meses', 'mas_6_meses', 'no_sabe', 'no_especificado')),
    high_urgency_signals    TEXT[],
    low_urgency_signals     TEXT[],
    is_decision_maker       VARCHAR(20) DEFAULT 'desconocido'
                            CHECK (is_decision_maker IN ('si', 'no_pareja', 'no_socio', 'no_familiar', 'desconocido')),
    comparing_competitors   BOOLEAN DEFAULT false,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: lead_objections
-- Objeciones y dudas del lead
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
-- Métricas de la conversación
-- ─────────────────────────────────────────────
CREATE TABLE conversation_metrics (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
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
-- Tiempos de respuesta
-- ─────────────────────────────────────────────
CREATE TABLE response_times (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
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
-- Calificación del asesor por conversación
-- ─────────────────────────────────────────────
CREATE TABLE advisor_scores (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    conversation_id             UUID NOT NULL REFERENCES raw_conversations(id) ON DELETE CASCADE,
    advisor_name                VARCHAR(255),
    advisor_phone               VARCHAR(20),
    speed_score                 SMALLINT CHECK (speed_score BETWEEN 1 AND 10),
    qualification_score         SMALLINT CHECK (qualification_score BETWEEN 1 AND 10),
    product_presentation_score  SMALLINT CHECK (product_presentation_score BETWEEN 1 AND 10),
    objection_handling_score    SMALLINT CHECK (objection_handling_score BETWEEN 1 AND 10),
    closing_attempt_score       SMALLINT CHECK (closing_attempt_score BETWEEN 1 AND 10),
    followup_score              SMALLINT CHECK (followup_score BETWEEN 1 AND 10),
    overall_score               DECIMAL(4,2),
    errors_list                 TEXT[],
    strengths_list              TEXT[],
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: conversation_outcomes
-- En qué terminó la conversación
-- ─────────────────────────────────────────────
CREATE TABLE conversation_outcomes (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id                     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
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
    recovery_probability        VARCHAR(10)
                                CHECK (recovery_probability IN ('alta', 'media', 'baja', 'no_aplica')),
    recovery_reason             TEXT,
    not_recoverable_reason      TEXT,
    recovery_strategy           TEXT,
    recovery_message_suggestion TEXT,
    alternative_product         TEXT,
    recovery_priority           VARCHAR(20)
                                CHECK (recovery_priority IN ('esta_semana', 'este_mes', 'puede_esperar', 'no_aplica')),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: competitor_intel
-- Inteligencia competitiva
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
-- Resumen ejecutivo de cada conversación
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
-- TABLA: system_logs
-- Logs del sistema para monitoreo
-- ─────────────────────────────────────────────
CREATE TABLE system_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module          VARCHAR(30) NOT NULL
                    CHECK (module IN ('extractor', 'transcriber', 'analyzer', 'api', 'backup', 'system')),
    level           VARCHAR(10) NOT NULL
                    CHECK (level IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    message         TEXT NOT NULL,
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: processing_stats
-- Estadísticas de procesamiento en tiempo real
-- ─────────────────────────────────────────────
CREATE TABLE processing_stats (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module              VARCHAR(30) NOT NULL,
    stat_key            VARCHAR(100) NOT NULL,
    stat_value          DECIMAL(15,4),
    stat_text           TEXT,
    recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(module, stat_key, recorded_at)
);

-- ─────────────────────────────────────────────
-- TABLA: projects_catalog
-- Catálogo de proyectos de Ortiz Finca Raíz
-- (se llena manualmente antes de correr el análisis)
-- ─────────────────────────────────────────────
CREATE TABLE projects_catalog (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name    VARCHAR(255) NOT NULL UNIQUE,
    project_type    VARCHAR(50),
    location        VARCHAR(255),
    city            VARCHAR(100),
    price_range     VARCHAR(100),
    description     TEXT,
    is_active       BOOLEAN DEFAULT true,
    aliases         TEXT[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- TABLA: advisors_catalog
-- Catálogo de asesores
-- (se llena manualmente antes de correr el análisis)
-- ─────────────────────────────────────────────
CREATE TABLE advisors_catalog (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    advisor_name    VARCHAR(255) NOT NULL,
    advisor_phone   VARCHAR(20) UNIQUE,
    is_active       BOOLEAN DEFAULT true,
    aliases         TEXT[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
