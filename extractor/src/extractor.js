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
const MEDIA_RETRY_DELAY_MS = parseInt(process.env.MEDIA_RETRY_DELAY_MS || '2000', 10);

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
                const { ok, failed } = await this._downloadMediaBatch(mediaQueue, convId, jid);
                logger.info(
                    `  ✅ ${chatName}: ${processedMessages.length} msgs, ` +
                    `media ${ok}/${mediaQueue.length} descargados (${failed} fallidos)`
                );
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
        logger.info(`  ⬇️  Descargando ${queue.length} media en paralelo (${MEDIA_CONCURRENCY} concurrentes)...`);
        let cursor = 0;
        let ok = 0;
        let failed = 0;

        const worker = async () => {
            while (cursor < queue.length) {
                const idx = cursor++;
                const item = queue[idx];

                const mediaInfo = await this._safeDownloadMedia(item.rawMsg, jid, item.type);
                if (mediaInfo) {
                    try {
                        await this.db.updateMessageMedia(convId, item.messageId, mediaInfo);
                        ok++;
                    } catch (dbErr) {
                        logger.warn(`  ⚠️  Error guardando media en BD: ${dbErr.message}`);
                        failed++;
                    }
                } else {
                    failed++;
                }

                // Log de progreso cada 20 descargas
                if ((ok + failed) % 20 === 0) {
                    logger.info(`     Media progreso: ${ok + failed}/${queue.length} (${ok} ok, ${failed} fallidos)`);
                }
            }
        };

        await Promise.all(
            Array.from({ length: MEDIA_CONCURRENCY }, () => worker())
        );

        return { ok, failed };
    }

    // Descarga un media sin lanzar excepción. Retorna null en fallo.
    // 1 reintento con 2s, llama updateMediaMessage para refrescar URLs.
    // Si detecta rate-limit (429), hace pausa defensiva para bajar la
    // probabilidad de ban — esos defaults no son cosméticos.
    async _safeDownloadMedia(msg, jid, mediaType) {
        try {
            return await this.downloadMedia(msg, jid, mediaType);
        } catch (error) {
            const message = String(error?.message || '');
            const isRateLimit =
                message.includes('429') ||
                message.toLowerCase().includes('rate') ||
                message.toLowerCase().includes('too many');
            if (isRateLimit) {
                logger.error(
                    `  🚨 Posible rate-limit detectado (${message}). Pausando 60s para evitar ban.`
                );
                await sleep(60000);
            } else {
                logger.warn(`  ⚠️  Media ${msg.key?.id} falló: ${error.message}`);
            }
            return null;
        }
    }

    // ─── DESCARGAR UNA MEDIA ───────────────────────────────
    // Los URLs de media de WhatsApp expiran. downloadMediaMessage
    // acepta reuploadRequest que pide URLs frescas cuando hay 403.
    // Importante: hay que hacer .bind(sock) para no perder el this.
    async downloadMedia(msg, jid, mediaType) {
        const reuploadRequest = this.sock.updateMediaMessage.bind(this.sock);
        const pinoSilent = P({ level: 'silent' });

        const attemptDownload = async () => {
            return downloadMediaMessage(
                msg,
                'buffer',
                {},
                {
                    logger: pinoSilent,
                    reuploadRequest,
                }
            );
        };

        let buffer;
        try {
            buffer = await attemptDownload();
        } catch (err) {
            // Un único reintento: intentar refrescar URLs manualmente antes.
            logger.warn(`  ⚠️  Primer intento de descarga falló (${err.message}), refrescando URL...`);
            await sleep(MEDIA_RETRY_DELAY_MS);
            try {
                await this.sock.updateMediaMessage(msg);
            } catch (refreshErr) {
                throw new Error(`updateMediaMessage falló: ${refreshErr.message}`);
            }
            buffer = await attemptDownload();
        }

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
