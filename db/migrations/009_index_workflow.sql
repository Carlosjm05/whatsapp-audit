-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN 009 — Workflow de indexado y extracción por lotes
-- ══════════════════════════════════════════════════════════════
-- Fecha: 2026-04-26
-- Idempotente.
--
-- Cambios:
--   1) Agrega 'indexado' al CHECK de extraction_status. Estado nuevo:
--      el chat ya tiene metadatos (chat_id, phone, conteos, fechas) en
--      raw_conversations PERO aún no tiene mensajes en messages ni media
--      descargada. Se obtiene del modo `npm run index` (primer escaneo).
--   2) Columna extract_priority: orden determinístico de procesamiento.
--      Asignada durante index con ROW_NUMBER() OVER (ORDER BY
--      last_message_at DESC). Permite que los lotes de 1000 sean
--      siempre los mismos aunque haya múltiples reescaneos del QR.
--   3) Índices para queries del modo extract.
-- ══════════════════════════════════════════════════════════════

-- 1) Re-emitir el CHECK constraint con 'indexado' incluido.
ALTER TABLE raw_conversations
    DROP CONSTRAINT IF EXISTS raw_conversations_extraction_status_check;

ALTER TABLE raw_conversations
    ADD CONSTRAINT raw_conversations_extraction_status_check
    CHECK (extraction_status IN (
        'pending', 'indexado', 'extracting', 'extracted', 'failed', 'skipped'
    ));

-- 2) Columna extract_priority. NULL para chats que no fueron indexados
-- (extracción legacy directa). Si != NULL, define el orden de batches.
ALTER TABLE raw_conversations
    ADD COLUMN IF NOT EXISTS extract_priority INTEGER;

-- 3) Índices.
-- Index parcial: solo chats indexados pendientes de extraer.
CREATE INDEX IF NOT EXISTS idx_raw_conv_indexado_priority
    ON raw_conversations(extract_priority)
    WHERE extraction_status = 'indexado';

-- Index compuesto para preview/stats por estado + orden.
CREATE INDEX IF NOT EXISTS idx_raw_conv_status_priority
    ON raw_conversations(extraction_status, extract_priority);
