-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 010 — Tokens del informe público (panel admin)
-- ══════════════════════════════════════════════════════════════
-- Fecha: 2026-05-07
-- Idempotente.
--
-- Permite que el admin del dashboard genere/revoque enlaces para
-- compartir el informe `/reporte` sin tener que tocar el `.env` ni
-- reiniciar el API. El token plano solo existe en la respuesta del
-- endpoint POST de creación; en DB guardamos solo el sha256.
--
-- Estructura paralela a `qr_share_tokens` pero con dos diferencias:
--   1) Almacena hash, no plaintext (los tokens del informe son de larga
--      duración — opcional caducidad — y queremos que un dump de DB no
--      regale acceso al informe).
--   2) Tracking de uso (last_used_at, use_count) para auditar quién
--      está mirando el informe.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public_report_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_hash      VARCHAR(64) NOT NULL UNIQUE,         -- sha256 hex del plaintext
    label           VARCHAR(255) NOT NULL,                -- ej. "Para Oscar - reunión jun"
    created_by      VARCHAR(64) NOT NULL,                 -- username del admin que lo creó
    expires_at      TIMESTAMPTZ,                          -- NULL = nunca expira
    revoked_at      TIMESTAMPTZ,                          -- NULL = activo
    last_used_at    TIMESTAMPTZ,
    use_count       INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup principal: el endpoint público hashea el token recibido y
-- busca por token_hash. Index UNIQUE ya lo cubre, pero un index
-- adicional sobre (revoked_at, expires_at) ayuda en listados del admin.
CREATE INDEX IF NOT EXISTS idx_public_report_tokens_active
    ON public_report_tokens(revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_public_report_tokens_created_at
    ON public_report_tokens(created_at DESC);
