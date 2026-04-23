-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 005 — QR público, multi-usuario admin, override manual
-- ══════════════════════════════════════════════════════════════
-- Fecha: 2026-04-23
-- Idempotente: usa IF NOT EXISTS / DO blocks. Se puede correr múltiples veces.
--
-- Cambios:
--   1) Tabla admin_users (multi-usuario: vos + cliente + más en el futuro).
--      El env ADMIN_USER/ADMIN_PASSWORD sigue funcionando como fallback.
--   2) Tabla qr_share_tokens (links públicos temporales para que el
--      cliente escanee QR sin loguearse).
--   3) Columnas manual_* en conversation_outcomes (override del análisis
--      de IA por parte del operador humano).
-- ══════════════════════════════════════════════════════════════

-- ─── 1. ADMIN_USERS (multi-usuario) ──────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
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

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_admin_users_active   ON admin_users(is_active);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION touch_admin_users_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_users_touch ON admin_users;
CREATE TRIGGER trg_admin_users_touch
    BEFORE UPDATE ON admin_users
    FOR EACH ROW EXECUTE FUNCTION touch_admin_users_updated_at();

-- ─── 2. QR_SHARE_TOKENS (links públicos temporales) ─────────
-- Single-use, expiran a los 10 min, se invalidan al escanear el QR.
-- El admin genera un token desde /conexion → copia link → manda a cliente.
CREATE TABLE IF NOT EXISTS qr_share_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token           VARCHAR(64) NOT NULL UNIQUE,      -- random URL-safe
    created_by      VARCHAR(64) NOT NULL,             -- admin username
    note            VARCHAR(255),                      -- ej. "Para Oscar - 23 abr"
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,                      -- cuando se escaneó/usó
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON qr_share_tokens(token);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires ON qr_share_tokens(expires_at);

-- ─── 3. MANUAL OVERRIDE en conversation_outcomes ─────────────
-- Permite que el operador marque manualmente "esto SÍ se cerró" o
-- "no es recuperable" cuando la IA se equivocó. La columna manual_*
-- TIENE PRECEDENCIA sobre la del análisis automático en lecturas/UI.
ALTER TABLE conversation_outcomes
    ADD COLUMN IF NOT EXISTS manual_status        VARCHAR(30),
    ADD COLUMN IF NOT EXISTS manual_is_recoverable BOOLEAN,
    ADD COLUMN IF NOT EXISTS manual_notes         TEXT,
    ADD COLUMN IF NOT EXISTS manual_overridden_by VARCHAR(64),
    ADD COLUMN IF NOT EXISTS manual_overridden_at TIMESTAMPTZ;

-- Constraint para manual_status: mismos valores que final_status.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'conversation_outcomes_manual_status_check'
    ) THEN
        ALTER TABLE conversation_outcomes
            ADD CONSTRAINT conversation_outcomes_manual_status_check
            CHECK (manual_status IS NULL OR manual_status IN (
                'venta_cerrada','visita_agendada','negociacion_activa',
                'seguimiento_activo','se_enfrio','ghosteado_por_asesor',
                'ghosteado_por_lead','descalificado','nunca_calificado',
                'spam','numero_equivocado','datos_insuficientes'
            ));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_outcomes_manual_status
    ON conversation_outcomes(manual_status)
    WHERE manual_status IS NOT NULL;

-- ─── 4. SEED: usuarios iniciales ─────────────────────────────
-- Crear usuarios solo si no existen. Las contraseñas se hashean en
-- runtime por la API (bcrypt). Acá usamos placeholders que los marcan
-- como "needs password reset" — la API expone /auth/bootstrap-users
-- que ejecutamos una sola vez post-deploy para setear los hashes.
--
-- Si vas a hacer deploy en cero, podés correr este script manual:
--   docker compose exec api python -m src.cli_users add Oscar_Accedo OscarOrt --role=operator
-- (no lo agregamos a esta migración para no acoplar SQL a python).

COMMIT;
