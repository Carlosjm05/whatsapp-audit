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

class Extractor {
    constructor(sock, db, config) {
        this.sock = sock;
        this.db = db;
        this.config = config;
        this.dataDir = config.dataDir;
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

    // ─── EXTRAER UN CHAT COMPLETO ───────────────────────────
    async extractChat(jid, chatName, messages, runId) {
        const contactNumber = jid.replace('@s.whatsapp.net', '');

        try {
            // Deduplicar por message ID y ordenar cronológicamente
            const deduped = this._deduplicateMessages(messages);
            const sorted = deduped.sort((a, b) =>
                Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
            );

            // Filtrar mensajes de sistema
            const filtered = sorted.filter(m => {
                const type = this.getMessageType(m.message);
                return type !== 'other' || (m.message?.conversation || m.message?.extendedTextMessage);
            });

            if (filtered.length === 0) {
                logger.info(`  ⏭️  ${chatName}: sin mensajes procesables, saltando`);
                return;
            }

            logger.info(`  📝 ${chatName}: ${filtered.length} mensajes a procesar`);

            // Procesar cada mensaje
            const processedMessages = [];
            let audioCount = 0;
            let imageCount = 0;
            let docCount = 0;
            let firstMessageAt = null;
            let lastMessageAt = null;

            for (const msg of filtered) {
                try {
                    const processed = await this.processMessage(msg, jid, contactNumber);
                    if (processed) {
                        processedMessages.push(processed);

                        if (processed.message_type === 'audio') audioCount++;
                        if (processed.message_type === 'image') imageCount++;
                        if (processed.message_type === 'document') docCount++;

                        const ts = new Date(processed.timestamp);
                        if (!firstMessageAt || ts < firstMessageAt) firstMessageAt = ts;
                        if (!lastMessageAt || ts > lastMessageAt) lastMessageAt = ts;
                    }
                } catch (msgError) {
                    logger.warn(`  ⚠️  Error procesando mensaje ${msg.key?.id}: ${msgError.message}`);
                }
            }

            if (processedMessages.length === 0) {
                logger.info(`  ⏭️  ${chatName}: 0 mensajes procesados`);
                return;
            }

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

            // Guardar en base de datos
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

            await this.db.saveMessages(convId, processedMessages);

            logger.info(`  ✅ ${chatName}: ${processedMessages.length} msgs, ${audioCount} audios, ${imageCount} imgs`);

        } catch (error) {
            logger.error(`  ❌ Error en ${chatName}: ${error.message}`);
            throw error;
        }
    }

    // ─── PROCESAR UN MENSAJE INDIVIDUAL ─────────────────────
    async processMessage(msg, jid, contactNumber) {
        const content = msg.message;
        if (!content) return null;

        // Algunos mensajes wrappean el contenido real
        const unwrapped = this._unwrapMessage(content);
        if (!unwrapped) return null;

        const timestamp = msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000)
            : new Date();

        const isFromMe = msg.key?.fromMe || false;
        const sender = isFromMe ? 'asesor' : 'lead';
        const senderPhone = isFromMe ? 'asesor' : formatPhone(contactNumber);
        const senderName = msg.pushName || (isFromMe ? 'Asesor' : contactNumber);

        const type = this.getMessageType(unwrapped);
        const body = this.getMessageBody(unwrapped);

        // Saltar mensajes vacíos de tipo text
        if (type === 'text' && !body) return null;
        // Saltar tipos no interesantes
        if (type === 'other') return null;

        const ctxInfo = this._getContextInfo(unwrapped);

        const processed = {
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

        // Descargar media si aplica
        if (['audio', 'image', 'video', 'document'].includes(type)) {
            try {
                const mediaInfo = await this.downloadMedia(msg, jid, type);
                if (mediaInfo) {
                    processed.media_path = mediaInfo.path;
                    processed.media_size_bytes = mediaInfo.size;
                    processed.media_duration_sec = mediaInfo.duration;
                    processed.media_mimetype = mediaInfo.mimetype;
                }
            } catch (mediaError) {
                logger.warn(`  ⚠️  No se pudo descargar media: ${mediaError.message}`);
            }
        }

        return processed;
    }

    // ─── DESCARGAR MEDIA ────────────────────────────────────
    async downloadMedia(msg, jid, mediaType) {
        const maxRetries = this.config.maxRetries;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const buffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    {
                        logger: P({ level: 'silent' }),
                        reuploadRequest: this.sock.updateMediaMessage,
                    }
                );

                if (!buffer || buffer.length === 0) {
                    logger.warn(`  ⚠️  Media vacío para ${msg.key?.id}`);
                    return null;
                }

                // Obtener metadatos del media
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

                // Rate limit
                const delay = this.randomBetween(
                    this.config.mediaDelayMin,
                    this.config.mediaDelayMax
                );
                await sleep(delay);

                return {
                    path: filePath,
                    size: buffer.length,
                    mimetype: mimetype,
                    duration: duration,
                };

            } catch (error) {
                if (attempt < maxRetries) {
                    logger.warn(`  ⚠️  Reintento ${attempt}/${maxRetries} descarga media: ${error.message}`);
                    await sleep(5000 * attempt);
                } else {
                    throw error;
                }
            }
        }
        return null;
    }

    // ─── UTILIDADES ─────────────────────────────────────────

    // Baileys a veces envuelve el contenido en viewOnceMessage, ephemeralMessage, etc.
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

    randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}

module.exports = { Extractor };
