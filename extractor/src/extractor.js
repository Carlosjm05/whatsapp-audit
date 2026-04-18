// ══════════════════════════════════════════════════════════════
// EXTRACTOR — Procesa mensajes de Baileys y guarda en BD
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const P = require('pino');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');
const { sleep, sanitizeFilename, formatPhone } = require('./utils');

// Baileys media download
const baileys = require('@whiskeysockets/baileys');
const { downloadMediaMessage } = baileys;

const logger = createLogger('extractor');

const MEDIA_TYPES = new Set(['audio', 'image', 'video', 'document']);
const MEDIA_CONCURRENCY = parseInt(process.env.MEDIA_CONCURRENCY || '5', 10);
// Timeout duro por media. Si Baileys se cuelga en un download (pasa
// ocasionalmente con media raro o red inestable), no esperamos más que
// esto — cuenta como fallo y seguimos.
const MEDIA_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || '30000', 10);

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0B';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

class Extractor {
    constructor(sock, db, config) {
        this.sock = sock;
        this.db = db;
        this.config = config;
        this.dataDir = config.dataDir;
        this.skipMedia = !!config.skipMedia;
        this.ensureDirectories();
    }

    ensureDirectories() {
        const dirs = ['raw', 'audios', 'images', 'documents'].map(
            d => path.join(this.dataDir, d)
        );
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }

    // ─── EXTRAER UN CHAT COMPLETO (2 fases) ─────────────────
    // Fase 1: procesar todos los mensajes (metadata de texto)
    //         y guardarlos en BD con media_path=null.
    // Fase 2: descargar media en paralelo (worker pool) y
    //         hacer UPDATE en BD con los paths. Las fallas
    //         dejan media_path=null pero el texto queda intacto.
    async extractChat(jid, chatName, messages, runId) {
        const contactNumber = jid.replace('@s.whatsapp.net', '');

        try {
            logger.info(`  🔍 ${chatName}: ${messages.length} mensajes sincronizados del Store`);

            const deduped = this._deduplicateMessages(messages);
            const dupSkipped = messages.length - deduped.length;
            if (dupSkipped > 0) {
                logger.info(`     Deduplicados: ${deduped.length} únicos (${dupSkipped} duplicados descartados)`);
            }

            const sorted = deduped.sort((a, b) =>
                Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
            );

            // ── FASE 1: procesar metadatos (sin descargar media) ──
            const processedMessages = [];
            const mediaQueue = []; // { rawMsg, type, messageId }
            let audioCount = 0;
            let imageCount = 0;
            let docCount = 0;
            let firstMessageAt = null;
            let lastMessageAt = null;

            // Contadores de por qué se descartan mensajes
            const filtered = {
                noContent: 0,
                noUnwrap: 0,
                typeOther: 0,
                textEmpty: 0,
                processError: 0,
            };

            for (const msg of sorted) {
                try {
                    const processed = this.processMessageMetadata(msg, jid, contactNumber, filtered);
                    if (!processed) continue;

                    processedMessages.push(processed);

                    if (processed.message_type === 'audio') audioCount++;
                    if (processed.message_type === 'image') imageCount++;
                    if (processed.message_type === 'document') docCount++;

                    const ts = new Date(processed.timestamp);
                    if (!firstMessageAt || ts < firstMessageAt) firstMessageAt = ts;
                    if (!lastMessageAt || ts > lastMessageAt) lastMessageAt = ts;

                    // Encolar media para fase 2
                    if (MEDIA_TYPES.has(processed.message_type)) {
                        mediaQueue.push({
                            rawMsg: msg,
                            type: processed.message_type,
                            messageId: processed.message_id,
                        });
                    }
                } catch (msgError) {
                    filtered.processError++;
                    logger.warn(`  ⚠️  Error procesando mensaje ${msg.key?.id}: ${msgError.message}`);
                }
            }

            // Desglose detallado de filtros
            logger.info(
                `     Filtros: ${processedMessages.length} mantenidos | ` +
                `${filtered.noContent} sin-content | ${filtered.noUnwrap} sin-unwrap | ` +
                `${filtered.typeOther} tipo-other | ${filtered.textEmpty} texto-vacío | ` +
                `${filtered.processError} errores`
            );

            if (processedMessages.length === 0) {
                logger.info(`  ⏭️  ${chatName}: 0 mensajes procesables`);
                return;
            }

            logger.info(
                `  📝 ${chatName}: ${processedMessages.length} msgs a guardar ` +
                `(${mediaQueue.length} media${this.skipMedia ? ', --skip-media' : ''})`
            );

            // Guardar JSON crudo en disco
            const rawPath = path.join(this.dataDir, 'raw', `${sanitizeFilename(jid)}.json`);
            const rawData = {
                chat_id: jid,
                contact_name: chatName,
                phone: formatPhone(contactNumber),
                is_group: false,
                messages: processedMessages,
                total_messages: processedMessages.length,
                total_audios: audioCount,
                total_images: imageCount,
                total_documents: docCount,
                first_message_at: firstMessageAt?.toISOString(),
                last_message_at: lastMessageAt?.toISOString(),
                extracted_at: new Date().toISOString(),
            };
            fs.writeFileSync(rawPath, JSON.stringify(rawData, null, 2), 'utf8');

            // Guardar conversación + mensajes (sin media paths todavía)
            const convId = await this.db.saveConversation({
                extraction_run_id: runId,
                chat_id: jid,
                phone: formatPhone(contactNumber),
                whatsapp_name: chatName,
                is_group: false,
                total_messages: processedMessages.length,
                total_audios: audioCount,
                total_images: imageCount,
                total_documents: docCount,
                first_message_at: firstMessageAt?.toISOString(),
                last_message_at: lastMessageAt?.toISOString(),
                raw_data_path: rawPath,
            });

            // Guardar mensajes con diagnóstico
            logger.info(`  💾 Insertando ${processedMessages.length} mensajes en BD...`);
            const saveStats = await this.db.saveMessages(convId, processedMessages);
            logger.info(
                `     INSERT: ${saveStats.inserted} nuevos, ` +
                `${saveStats.skipped} duplicados/existentes, ` +
                `${saveStats.errors.length} errores`
            );
            if (saveStats.inserted === 0 && processedMessages.length > 0) {
                logger.warn(
                    `  ⚠️  ATENCIÓN: 0 mensajes insertados de ${processedMessages.length} procesados. ` +
                    `Revisar errores arriba.`
                );
            }

            // ── FASE 2: descargar media en paralelo ──
            if (this.skipMedia) {
                logger.info(`  ⏭️  Saltando descarga de ${mediaQueue.length} media (--skip-media)`);
            } else if (mediaQueue.length > 0) {
                const { ok, failed, expired } = await this._downloadMediaBatch(mediaQueue, convId, jid);
                // Resumen UNA línea con conteo de expirados (lo más típico
                // al resincronizar historial antiguo de WhatsApp).
                const expiredPart = expired > 0
                    ? ` (${expired} expirados)`
                    : failed > 0 ? ` (${failed} fallidos)` : '';
                logger.info(
                    `  ✅ ${chatName}: ${processedMessages.length} msgs, ` +
                    `media ${ok}/${mediaQueue.length}${expiredPart}`
                );
                // Si el grueso de la media está expirada, explicarlo en UNA
                // línea. Ayuda a entender que no es un bug, es historial viejo.
                const expiredPct = mediaQueue.length > 0
                    ? (expired / mediaQueue.length) * 100
                    : 0;
                if (expiredPct >= 80) {
                    logger.info(
                        `  ℹ️  ${Math.round(expiredPct)}% de media expirada — historial antiguo`
                    );
                } else if (expiredPct >= 30) {
                    logger.info(
                        `  ℹ️  ${Math.round(expiredPct)}% de media expirada`
                    );
                }
            } else {
                logger.info(`  ✅ ${chatName}: ${processedMessages.length} msgs (sin media)`);
            }

        } catch (error) {
            logger.error(`  ❌ Error en ${chatName}: ${error.message}`);
            throw error;
        }
    }

    // ─── FASE 2: DESCARGA PARALELA DE MEDIA ────────────────
    async _downloadMediaBatch(queue, convId, jid) {
        const total = queue.length;
        logger.info(`  ⬇️  Descargando ${total} media en paralelo (${MEDIA_CONCURRENCY} concurrentes)...`);
        let cursor = 0;
        let ok = 0;
        let failed = 0;
        let expired = 0;  // 403 / URL vencida — típico de historial antiguo

        const worker = async () => {
            while (cursor < queue.length) {
                const idx = cursor++;
                const item = queue[idx];
                const itemNum = idx + 1;
                const started = Date.now();

                const result = await this._safeDownloadMedia(item.rawMsg, jid, item.type);
                const ms = Date.now() - started;
                const dur = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

                if (result && result.mediaInfo) {
                    try {
                        await this.db.updateMessageMedia(convId, item.messageId, result.mediaInfo);
                        ok++;
                        const size = result.mediaInfo.size || 0;
                        const sizeLabel = size > 0 ? formatBytes(size) : '—';
                        logger.info(
                            `     [${itemNum}/${total}] ✓ ${item.type} · ${sizeLabel} · ${dur}`
                        );
                    } catch (dbErr) {
                        failed++;
                        logger.warn(
                            `     [${itemNum}/${total}] ✗ ${item.type} · error DB: ${dbErr.message}`
                        );
                    }
                } else {
                    failed++;
                    const wasExpired = !!(result && result.expired);
                    const wasTimeout = !!(result && result.timeout);
                    if (wasExpired) expired++;
                    const label = wasTimeout
                        ? `timeout (${Math.round(MEDIA_DOWNLOAD_TIMEOUT_MS / 1000)}s)`
                        : wasExpired
                        ? 'expirado (403/no disponible)'
                        : 'falló';
                    logger.info(
                        `     [${itemNum}/${total}] ✗ ${item.type} · ${label} · ${dur}`
                    );
                }
            }
        };

        await Promise.all(
            Array.from({ length: MEDIA_CONCURRENCY }, () => worker())
        );

        return { ok, failed, expired };
    }

    // Descarga un media sin lanzar excepción. Retorna
    // {mediaInfo, expired}. mediaInfo es null en fallo; expired=true
    // si el fallo es por URL vencida (historial antiguo, 403 típico).
    // Timeout duro de MEDIA_DOWNLOAD_TIMEOUT_MS — Baileys a veces se
    // cuelga en un download y bloquea todo el worker.
    async _safeDownloadMedia(msg, jid, mediaType) {
        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(
                () => reject(new Error(`download timeout (${MEDIA_DOWNLOAD_TIMEOUT_MS}ms)`)),
                MEDIA_DOWNLOAD_TIMEOUT_MS
            );
        });
        try {
            const mediaInfo = await Promise.race([
                this.downloadMedia(msg, jid, mediaType),
                timeoutPromise,
            ]);
            clearTimeout(timeoutHandle);
            return { mediaInfo, expired: false };
        } catch (error) {
            clearTimeout(timeoutHandle);
            const message = String(error?.message || '').toLowerCase();
            const isRateLimit =
                message.includes('429') ||
                message.includes('rate') ||
                message.includes('too many');
            if (isRateLimit) {
                // Rate limit SÍ se loguea — es operacionalmente importante
                // (riesgo real de ban).
                logger.error(
                    `  🚨 Posible rate-limit detectado. Pausando 60s para evitar ban.`
                );
                await sleep(60000);
                return { mediaInfo: null, expired: false };
            }
            const isTimeout = message.includes('timeout');
            // 403 / URL expirada / reupload fallido: silencio, cuenta como expirado.
            const isExpired =
                message.includes('403') ||
                message.includes('forbidden') ||
                message.includes('expired') ||
                message.includes('updatemediamessage') ||
                message.includes('reupload');
            return { mediaInfo: null, expired: isExpired, timeout: isTimeout };
        }
    }

    // ─── DESCARGAR UNA MEDIA ───────────────────────────────
    // UN solo intento. downloadMediaMessage ya hace reuploadRequest
    // internamente cuando detecta 403. Si ese intento falla, es porque
    // el media realmente no está accesible (expirado o reupload fallido).
    // Reintentar perdería tiempo sin ganancia real.
    async downloadMedia(msg, jid, mediaType) {
        const reuploadRequest = this.sock.updateMediaMessage.bind(this.sock);
        const pinoSilent = P({ level: 'silent' });

        const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
                logger: pinoSilent,
                reuploadRequest,
            }
        );

        if (!buffer || buffer.length === 0) {
            throw new Error('Buffer vacío');
        }

        const unwrapped = this._unwrapMessage(msg.message);
        const mediaContent = unwrapped?.audioMessage
            || unwrapped?.imageMessage
            || unwrapped?.videoMessage
            || unwrapped?.documentMessage
            || unwrapped?.stickerMessage;

        const mimetype = mediaContent?.mimetype || '';
        const duration = mediaContent?.seconds || null;

        const subDir = mediaType === 'audio' ? 'audios'
            : mediaType === 'image' ? 'images' : 'documents';
        const ext = this.getExtension(mimetype, mediaType);
        const filename = `${sanitizeFilename(jid)}_${msg.key?.id || uuidv4()}${ext}`;
        const filePath = path.join(this.dataDir, subDir, filename);

        fs.writeFileSync(filePath, buffer);

        return {
            path: filePath,
            size: buffer.length,
            mimetype: mimetype,
            duration: duration,
        };
    }

    // ─── PROCESAR METADATA DE MENSAJE (sin descargar media) ──
    processMessageMetadata(msg, jid, contactNumber, filtered = {}) {
        const content = msg.message;
        if (!content) { filtered.noContent = (filtered.noContent || 0) + 1; return null; }

        const unwrapped = this._unwrapMessage(content);
        if (!unwrapped) { filtered.noUnwrap = (filtered.noUnwrap || 0) + 1; return null; }

        const timestamp = msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date();

        const isFromMe = msg.key?.fromMe || false;
        const sender = isFromMe ? 'asesor' : 'lead';
        // sender_phone es VARCHAR(20) para números de teléfono. Cuando es el
        // asesor dejamos NULL en vez de la literal 'asesor' (el flag `sender`
        // ya comunica de quién viene el mensaje).
        const senderPhone = isFromMe ? null : formatPhone(contactNumber);
        // sender_name es VARCHAR(255) en el schema — truncar para evitar rollback
        let senderName = msg.pushName || (isFromMe ? 'Asesor' : contactNumber);
        if (senderName && senderName.length > 255) senderName = senderName.substring(0, 255);

        const type = this.getMessageType(unwrapped);
        const body = this.getMessageBody(unwrapped);

        if (type === 'text' && !body) {
            filtered.textEmpty = (filtered.textEmpty || 0) + 1;
            return null;
        }
        if (type === 'other') {
            filtered.typeOther = (filtered.typeOther || 0) + 1;
            return null;
        }

        const ctxInfo = this._getContextInfo(unwrapped);

        return {
            message_id: msg.key?.id || uuidv4(),
            timestamp: timestamp.toISOString(),
            sender,
            sender_phone: senderPhone,
            sender_name: senderName,
            message_type: type,
            body: body || null,
            media_path: null,
            media_size_bytes: null,
            media_duration_sec: null,
            media_mimetype: null,
            is_forwarded: ctxInfo?.isForwarded || false,
            is_reply: !!ctxInfo?.stanzaId,
            reply_to_id: ctxInfo?.stanzaId || null,
        };
    }

    // ─── UTILIDADES ─────────────────────────────────────────

    _unwrapMessage(content) {
        if (!content) return null;
        return content.viewOnceMessage?.message
            || content.viewOnceMessageV2?.message
            || content.ephemeralMessage?.message
            || content.documentWithCaptionMessage?.message
            || content;
    }

    _getContextInfo(content) {
        return content?.extendedTextMessage?.contextInfo
            || content?.imageMessage?.contextInfo
            || content?.videoMessage?.contextInfo
            || content?.audioMessage?.contextInfo
            || content?.documentMessage?.contextInfo
            || null;
    }

    _deduplicateMessages(messages) {
        const seen = new Set();
        return messages.filter(m => {
            const id = m.key?.id;
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    getMessageType(content) {
        if (!content) return 'other';
        if (content.conversation || content.extendedTextMessage) return 'text';
        if (content.imageMessage) return 'image';
        if (content.videoMessage) return 'video';
        if (content.audioMessage) return 'audio';
        if (content.documentMessage) return 'document';
        if (content.documentWithCaptionMessage) return 'document';
        if (content.stickerMessage) return 'sticker';
        if (content.locationMessage || content.liveLocationMessage) return 'location';
        if (content.contactMessage || content.contactsArrayMessage) return 'contact';
        if (content.viewOnceMessage || content.viewOnceMessageV2) {
            return this.getMessageType(
                content.viewOnceMessage?.message || content.viewOnceMessageV2?.message
            );
        }
        if (content.ephemeralMessage) {
            return this.getMessageType(content.ephemeralMessage.message);
        }
        return 'other';
    }

    getMessageBody(content) {
        if (!content) return null;
        return content.conversation
            || content.extendedTextMessage?.text
            || content.imageMessage?.caption
            || content.videoMessage?.caption
            || content.documentMessage?.caption
            || content.documentWithCaptionMessage?.message?.documentMessage?.caption
            || null;
    }

    getExtension(mimetype, fallbackType) {
        const mimeMap = {
            'audio/ogg': '.ogg',
            'audio/ogg; codecs=opus': '.ogg',
            'audio/mpeg': '.mp3',
            'audio/mp4': '.m4a',
            'audio/aac': '.aac',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp',
            'video/mp4': '.mp4',
            'application/pdf': '.pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        };

        if (mimetype && mimeMap[mimetype]) return mimeMap[mimetype];

        const fallbackMap = {
            'audio': '.ogg',
            'image': '.jpg',
            'video': '.mp4',
            'document': '.bin',
        };

        return fallbackMap[fallbackType] || '.bin';
    }
}

module.exports = { Extractor };
