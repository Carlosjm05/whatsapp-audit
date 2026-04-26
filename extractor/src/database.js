// ══════════════════════════════════════════════════════════════
// DATABASE MODULE — PostgreSQL connection and queries
// ══════════════════════════════════════════════════════════════

const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');

const logger = createLogger('database');

class Database {
    constructor() {
        this.pool = null;
    }

    async connect() {
        this.pool = new Pool({
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT || '5432'),
            database: process.env.POSTGRES_DB || 'whatsapp_audit',
            user: process.env.POSTGRES_USER || 'wa_admin',
            password: process.env.POSTGRES_PASSWORD,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });

        // Verificar conexión
        const client = await this.pool.connect();
        const result = await client.query('SELECT NOW() as time');
        logger.info(`PostgreSQL conectado. Hora del servidor: ${result.rows[0].time}`);
        client.release();
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            logger.info('Pool de PostgreSQL cerrado');
        }
    }

    // ─── EXTRACTION RUNS ────────────────────────────────────
    async createExtractionRun() {
        const id = uuidv4();
        await this.pool.query(
            `INSERT INTO extraction_runs (id, status) VALUES ($1, 'running')`,
            [id]
        );
        logger.info(`Corrida de extracción creada: ${id}`);
        return id;
    }

    async updateExtractionRun(id, data) {
        const sets = [];
        const values = [id];
        let paramIndex = 2;

        for (const [key, value] of Object.entries(data)) {
            sets.push(`${key} = $${paramIndex}`);
            values.push(value);
            paramIndex++;
        }

        if (sets.length > 0) {
            await this.pool.query(
                `UPDATE extraction_runs SET ${sets.join(', ')} WHERE id = $1`,
                values
            );
        }
    }

    // ─── RAW CONVERSATIONS ──────────────────────────────────
    async getExtractedChatIds() {
        const result = await this.pool.query(
            `SELECT chat_id FROM raw_conversations WHERE extraction_status = 'extracted'`
        );
        return new Set(result.rows.map(r => r.chat_id));
    }

    async saveConversation(data) {
        const id = uuidv4();
        await this.pool.query(
            `INSERT INTO raw_conversations (
                id, extraction_run_id, chat_id, phone, whatsapp_name,
                is_group, total_messages, total_audios, total_images,
                total_documents, first_message_at, last_message_at,
                raw_data_path, extraction_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'extracted')
            ON CONFLICT (chat_id) DO UPDATE SET
                total_messages = EXCLUDED.total_messages,
                total_audios = EXCLUDED.total_audios,
                total_images = EXCLUDED.total_images,
                total_documents = EXCLUDED.total_documents,
                first_message_at = EXCLUDED.first_message_at,
                last_message_at = EXCLUDED.last_message_at,
                raw_data_path = EXCLUDED.raw_data_path,
                extraction_status = 'extracted',
                updated_at = NOW()`,
            [
                id, data.extraction_run_id, data.chat_id, data.phone,
                data.whatsapp_name, data.is_group, data.total_messages,
                data.total_audios, data.total_images, data.total_documents,
                data.first_message_at, data.last_message_at, data.raw_data_path
            ]
        );
        return id;
    }

    async markConversationFailed(chatId, error) {
        await this.pool.query(
            `INSERT INTO raw_conversations (id, chat_id, extraction_status, extraction_error, retry_count)
             VALUES ($1, $2, 'failed', $3, 1)
             ON CONFLICT (chat_id) DO UPDATE SET
                extraction_status = 'failed',
                extraction_error = $3,
                retry_count = raw_conversations.retry_count + 1,
                updated_at = NOW()`,
            [uuidv4(), chatId, error]
        );
    }

    // ─── MESSAGES ───────────────────────────────────────────
    // Estrategia: batches de 500 rows con INSERT multi-fila.
    // Si un batch falla, fallback a uno por uno para aislar el row
    // malo y poder loguear el error exacto sin perder los demás.
    // Retorna { inserted, skipped, errors: [{ id, error }] }.
    async saveMessages(conversationId, messages) {
        if (!messages || messages.length === 0) {
            return { inserted: 0, skipped: 0, errors: [] };
        }

        const BATCH_SIZE = 500;
        let inserted = 0;
        let skipped = 0;
        const errors = [];

        for (let i = 0; i < messages.length; i += BATCH_SIZE) {
            const batch = messages.slice(i, i + BATCH_SIZE);
            try {
                const r = await this._insertMessagesBatch(conversationId, batch);
                inserted += r.inserted;
                skipped += batch.length - r.inserted;
            } catch (batchErr) {
                logger.warn(
                    `Batch de ${batch.length} mensajes falló: ${batchErr.message}. ` +
                    `Reintentando uno por uno para aislar el error...`
                );
                for (const msg of batch) {
                    try {
                        const ok = await this._insertOneMessage(conversationId, msg);
                        if (ok) inserted++;
                        else skipped++;
                    } catch (rowErr) {
                        errors.push({ id: msg.message_id, error: rowErr.message });
                        if (errors.length <= 5) {
                            logger.warn(`  ❌ msg ${msg.message_id}: ${rowErr.message}`);
                        }
                    }
                }
            }
        }

        if (errors.length > 5) {
            logger.warn(`  (+${errors.length - 5} errores adicionales de INSERT ocultos)`);
        }

        return { inserted, skipped, errors };
    }

    async _insertMessagesBatch(conversationId, messages) {
        const cols = [
            'id', 'conversation_id', 'message_id', 'timestamp', 'sender',
            'sender_phone', 'sender_name', 'message_type', 'body',
            'media_path', 'media_size_bytes', 'media_duration_sec',
            'media_mimetype', 'is_forwarded', 'is_reply', 'reply_to_id',
        ];
        const rows = [];
        const values = [];
        let paramIdx = 1;

        for (const msg of messages) {
            const ph = [];
            for (let k = 0; k < cols.length; k++) ph.push(`$${paramIdx++}`);
            rows.push(`(${ph.join(', ')})`);
            values.push(
                uuidv4(), conversationId, msg.message_id,
                msg.timestamp, msg.sender, msg.sender_phone,
                msg.sender_name, msg.message_type, msg.body,
                msg.media_path, msg.media_size_bytes,
                msg.media_duration_sec, msg.media_mimetype,
                msg.is_forwarded || false, msg.is_reply || false,
                msg.reply_to_id
            );
        }

        const sql = `
            INSERT INTO messages (${cols.join(', ')})
            VALUES ${rows.join(', ')}
            ON CONFLICT (conversation_id, message_id) DO NOTHING
            RETURNING id
        `;
        const res = await this.pool.query(sql, values);
        return { inserted: res.rowCount };
    }

    async _insertOneMessage(conversationId, msg) {
        const res = await this.pool.query(
            `INSERT INTO messages (
                id, conversation_id, message_id, timestamp, sender,
                sender_phone, sender_name, message_type, body,
                media_path, media_size_bytes, media_duration_sec,
                media_mimetype, is_forwarded, is_reply, reply_to_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (conversation_id, message_id) DO NOTHING
            RETURNING id`,
            [
                uuidv4(), conversationId, msg.message_id,
                msg.timestamp, msg.sender, msg.sender_phone,
                msg.sender_name, msg.message_type, msg.body,
                msg.media_path, msg.media_size_bytes,
                msg.media_duration_sec, msg.media_mimetype,
                msg.is_forwarded || false, msg.is_reply || false,
                msg.reply_to_id,
            ]
        );
        return res.rowCount > 0;
    }

    // Elimina una conversación y sus mensajes (usado con --force).
    async deleteConversation(chatId) {
        const res = await this.pool.query(
            `DELETE FROM raw_conversations WHERE chat_id = $1 RETURNING id`,
            [chatId]
        );
        return res.rowCount;
    }

    async updateMessageMedia(conversationId, messageId, mediaInfo) {
        await this.pool.query(
            `UPDATE messages SET
                media_path = $1,
                media_size_bytes = $2,
                media_duration_sec = $3,
                media_mimetype = $4
             WHERE conversation_id = $5 AND message_id = $6`,
            [
                mediaInfo.path,
                mediaInfo.size,
                mediaInfo.duration,
                mediaInfo.mimetype,
                conversationId,
                messageId,
            ]
        );
    }

    // ─── STATISTICS ─────────────────────────────────────────
    async getExtractionStats() {
        const result = await this.pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE extraction_status = 'indexado') as indexado,
                COUNT(*) FILTER (WHERE extraction_status = 'extracted') as extracted,
                COUNT(*) FILTER (WHERE extraction_status = 'pending') as pending,
                COUNT(*) FILTER (WHERE extraction_status = 'failed') as failed,
                COALESCE(SUM(total_messages), 0) as total_messages,
                COALESCE(SUM(total_audios), 0) as total_audios
            FROM raw_conversations
        `);
        return result.rows[0];
    }

    // ─── INDEX MODE: METADATOS SIN MENSAJES ─────────────────
    // Guarda solo la "ficha" del chat (chat_id, phone, conteos, fechas).
    // NO inserta mensajes ni descarga media. Usado por modo `index`
    // (primer escaneo). Si el chat ya existe en otro estado (extracted,
    // failed), NO lo toca — el snapshot es inmutable.
    async saveConversationMetadata(data) {
        const id = uuidv4();
        const res = await this.pool.query(
            `INSERT INTO raw_conversations (
                id, extraction_run_id, chat_id, phone, whatsapp_name,
                is_group, total_messages, total_audios, total_images,
                total_documents, first_message_at, last_message_at,
                extraction_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'indexado')
            ON CONFLICT (chat_id) DO NOTHING
            RETURNING id`,
            [
                id, data.extraction_run_id, data.chat_id, data.phone,
                data.whatsapp_name, !!data.is_group,
                data.total_messages || 0, data.total_audios || 0,
                data.total_images || 0, data.total_documents || 0,
                data.first_message_at, data.last_message_at,
            ]
        );
        return res.rowCount > 0;  // true si se insertó, false si ya existía
    }

    // Asigna extract_priority a TODOS los chats con extraction_status='indexado'
    // que aún no la tengan. Orden: last_message_at DESC (más reciente primero).
    // Idempotente: chats que ya tienen prioridad NO se renumeran (snapshot
    // inmutable entre reescaneos).
    async assignExtractPriorities() {
        const res = await this.pool.query(`
            WITH ordenados AS (
                SELECT id,
                       ROW_NUMBER() OVER (ORDER BY last_message_at DESC, chat_id ASC) AS rn
                  FROM raw_conversations
                 WHERE extraction_status = 'indexado'
                   AND extract_priority IS NULL
            )
            UPDATE raw_conversations rc
               SET extract_priority = COALESCE(
                       (SELECT MAX(extract_priority)
                          FROM raw_conversations
                         WHERE extract_priority IS NOT NULL), 0
                   ) + ordenados.rn
              FROM ordenados
             WHERE rc.id = ordenados.id
        `);
        return res.rowCount;
    }

    // Próximo lote a extraer. Toma chats indexados ordenados por
    // extract_priority ASC (los de mayor prioridad = más recientes).
    async getNextExtractBatch(limit) {
        const res = await this.pool.query(
            `SELECT chat_id, whatsapp_name, phone, last_message_at, extract_priority
               FROM raw_conversations
              WHERE extraction_status = 'indexado'
                AND extract_priority IS NOT NULL
              ORDER BY extract_priority ASC
              LIMIT $1`,
            [limit]
        );
        return res.rows;
    }

    // Histograma por mes (last_message_at) + estado. Usado por preview.
    async getIndexHistogram() {
        const res = await this.pool.query(`
            SELECT to_char(date_trunc('month', last_message_at), 'YYYY-MM') AS mes,
                   COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE extraction_status = 'indexado')::int  AS indexado,
                   COUNT(*) FILTER (WHERE extraction_status = 'extracted')::int AS extracted,
                   COUNT(*) FILTER (WHERE extraction_status = 'failed')::int    AS failed
              FROM raw_conversations
             WHERE last_message_at IS NOT NULL
             GROUP BY 1
             ORDER BY 1 DESC
        `);
        return res.rows;
    }

    // Frontera actual: cuál fue el último chat extraído (en términos de
    // prioridad). Próximo lote arranca desde priority + 1.
    async getExtractionFrontier() {
        const res = await this.pool.query(`
            SELECT MAX(extract_priority) AS max_priority,
                   COUNT(*) FILTER (WHERE extraction_status = 'indexado')::int  AS indexado_pendientes,
                   COUNT(*) FILTER (WHERE extraction_status = 'extracted')::int AS extracted_total
              FROM raw_conversations
             WHERE extract_priority IS NOT NULL
        `);
        const row = res.rows[0] || {};
        // priority del próximo a procesar
        const nextRes = await this.pool.query(`
            SELECT MIN(extract_priority) AS next_priority
              FROM raw_conversations
             WHERE extraction_status = 'indexado'
               AND extract_priority IS NOT NULL
        `);
        return {
            max_priority: row.max_priority,
            indexado_pendientes: row.indexado_pendientes || 0,
            extracted_total: row.extracted_total || 0,
            next_priority: (nextRes.rows[0] || {}).next_priority,
        };
    }
}

module.exports = { Database };
