// ══════════════════════════════════════════════════════════════
// EXTRACTOR — Lógica de extracción de cada chat
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./logger');
const { sleep, sanitizeFilename, formatPhone } = require('./utils');

const logger = createLogger('extractor');

class Extractor {
    constructor(client, db, config) {
        this.client = client;
        this.db = db;
        this.config = config;
        this.dataDir = config.dataDir;
        
        // Crear directorios si no existen
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
    async extractChat(chat, runId) {
        const chatId = chat.id._serialized;
        const chatName = chat.name || chatId;
        
        try {
            // 1. Obtener todos los mensajes
            logger.info(`  📥 Cargando mensajes de ${chatName}...`);
            const messages = await this.fetchAllMessages(chat);
            
            if (!messages || messages.length === 0) {
                logger.info(`  ⏭️  ${chatName}: sin mensajes, saltando`);
                return;
            }

            logger.info(`  📝 ${chatName}: ${messages.length} mensajes encontrados`);

            // 2. Determinar quién es lead y quién es asesor
            const contactNumber = chatId.replace('@c.us', '');
            
            // 3. Procesar cada mensaje
            const processedMessages = [];
            let audioCount = 0;
            let imageCount = 0;
            let docCount = 0;
            let firstMessageAt = null;
            let lastMessageAt = null;

            for (const msg of messages) {
                try {
                    const processed = await this.processMessage(msg, chatId, contactNumber);
                    if (processed) {
                        processedMessages.push(processed);
                        
                        // Contar tipos
                        if (processed.message_type === 'audio') audioCount++;
                        if (processed.message_type === 'image') imageCount++;
                        if (processed.message_type === 'document') docCount++;
                        
                        // Timestamps
                        const ts = new Date(processed.timestamp);
                        if (!firstMessageAt || ts < firstMessageAt) firstMessageAt = ts;
                        if (!lastMessageAt || ts > lastMessageAt) lastMessageAt = ts;
                    }
                } catch (msgError) {
                    logger.warn(`  ⚠️  Error procesando mensaje ${msg.id?.id}: ${msgError.message}`);
                    // Continuar con el siguiente mensaje, no fallar todo el chat
                }
            }

            // 4. Guardar JSON crudo en disco
            const rawPath = path.join(this.dataDir, 'raw', `${sanitizeFilename(chatId)}.json`);
            const rawData = {
                chat_id: chatId,
                contact_name: chatName,
                phone: formatPhone(contactNumber),
                is_group: chat.isGroup || false,
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

            // 5. Guardar en base de datos
            const convId = await this.db.saveConversation({
                extraction_run_id: runId,
                chat_id: chatId,
                phone: formatPhone(contactNumber),
                whatsapp_name: chatName,
                is_group: chat.isGroup || false,
                total_messages: processedMessages.length,
                total_audios: audioCount,
                total_images: imageCount,
                total_documents: docCount,
                first_message_at: firstMessageAt?.toISOString(),
                last_message_at: lastMessageAt?.toISOString(),
                raw_data_path: rawPath,
            });

            // 6. Guardar mensajes individuales en BD
            await this.db.saveMessages(convId, processedMessages);

            logger.info(`  ✅ ${chatName}: ${processedMessages.length} msgs, ${audioCount} audios, ${imageCount} imgs`);

        } catch (error) {
            logger.error(`  ❌ Error en ${chatName}: ${error.message}`);
            throw error;
        }
    }

    // ─── OBTENER TODOS LOS MENSAJES DE UN CHAT ─────────────
    // whatsapp-web.js internamente llama loadEarlierMsgs() hasta alcanzar
    // el `limit` o agotar el historial. `Infinity` a veces hace timeout del
    // protocolo; usamos un entero muy grande y reintentamos con backoff.
    // Además, paginamos hasta que dos iteraciones seguidas devuelvan la
    // misma cantidad (WA puede seguir sincronizando en background).
    async fetchAllMessages(chat) {
        const HARD_LIMIT = 999999;
        const MAX_ROUNDS = 6;
        const ROUND_WAIT_MS = 4000;

        // Darle a WhatsApp Web un momento para sincronizar ESTE chat
        // antes de empezar a pedir historial.
        await sleep(2000);

        let lastCount = -1;
        let messages = [];

        for (let round = 1; round <= MAX_ROUNDS; round++) {
            let attempt = 0;
            while (attempt < 3) {
                try {
                    messages = await chat.fetchMessages({ limit: HARD_LIMIT });
                    break;
                } catch (error) {
                    attempt++;
                    logger.warn(`  ⚠️  fetchMessages falló (ronda ${round}, intento ${attempt}/3): ${error.message}`);
                    if (attempt >= 3) {
                        if (messages.length > 0) {
                            logger.warn(`  ⚠️  Devolviendo ${messages.length} mensajes cargados antes del fallo`);
                            return this._sortChronological(messages);
                        }
                        return [];
                    }
                    await sleep(3000 * attempt);
                }
            }

            logger.info(`  📜 Ronda ${round}: ${messages.length} mensajes cargados`);

            // Si no crecimos desde la ronda anterior, asumimos historial completo.
            if (messages.length === lastCount) {
                break;
            }
            lastCount = messages.length;

            // Esperar a que WhatsApp cargue más historial en background.
            await sleep(ROUND_WAIT_MS);
        }

        return this._sortChronological(messages);
    }

    _sortChronological(messages) {
        return [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }

    // ─── PROCESAR UN MENSAJE INDIVIDUAL ─────────────────────
    async processMessage(msg, chatId, contactNumber) {
        const timestamp = msg.timestamp ? new Date(msg.timestamp * 1000) : new Date();
        
        // Determinar si es del lead o del asesor
        const isFromMe = msg.fromMe;
        const sender = isFromMe ? 'asesor' : 'lead';
        const senderPhone = isFromMe ? 'asesor' : formatPhone(contactNumber);
        const senderName = msg._data?.notifyName || (isFromMe ? 'Asesor' : contactNumber);

        const processed = {
            message_id: msg.id?.id || uuidv4(),
            timestamp: timestamp.toISOString(),
            sender,
            sender_phone: senderPhone,
            sender_name: senderName,
            message_type: this.getMessageType(msg),
            body: msg.body || null,
            media_path: null,
            media_size_bytes: null,
            media_duration_sec: null,
            media_mimetype: null,
            is_forwarded: msg.isForwarded || false,
            is_reply: msg.hasQuotedMsg || false,
            reply_to_id: null,
        };

        // Descargar media si aplica
        if (msg.hasMedia && ['audio', 'image', 'video', 'document'].includes(processed.message_type)) {
            try {
                const mediaInfo = await this.downloadMedia(msg, chatId, processed.message_type);
                if (mediaInfo) {
                    processed.media_path = mediaInfo.path;
                    processed.media_size_bytes = mediaInfo.size;
                    processed.media_duration_sec = mediaInfo.duration;
                    processed.media_mimetype = mediaInfo.mimetype;
                }
            } catch (mediaError) {
                logger.warn(`  ⚠️  No se pudo descargar media: ${mediaError.message}`);
                // No fallar el mensaje, solo registrar que no se pudo descargar
            }
        }

        return processed;
    }

    // ─── DESCARGAR MEDIA ────────────────────────────────────
    async downloadMedia(msg, chatId, mediaType) {
        const maxRetries = this.config.maxRetries;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const media = await msg.downloadMedia();
                
                if (!media || !media.data) {
                    logger.warn(`  ⚠️  Media vacío para ${msg.id?.id}`);
                    return null;
                }

                // Determinar carpeta y extensión
                const subDir = mediaType === 'audio' ? 'audios' : 
                               mediaType === 'image' ? 'images' : 'documents';
                
                const ext = this.getExtension(media.mimetype, mediaType);
                const filename = `${sanitizeFilename(chatId)}_${msg.id?.id || uuidv4()}${ext}`;
                const filePath = path.join(this.dataDir, subDir, filename);

                // Guardar archivo
                const buffer = Buffer.from(media.data, 'base64');
                fs.writeFileSync(filePath, buffer);

                // Delay anti rate-limit
                const delay = this.randomBetween(
                    this.config.mediaDelayMin,
                    this.config.mediaDelayMax
                );
                await sleep(delay);

                return {
                    path: filePath,
                    size: buffer.length,
                    mimetype: media.mimetype,
                    duration: msg._data?.duration || null,
                };

            } catch (error) {
                if (attempt < maxRetries) {
                    logger.warn(`  ⚠️  Reintento ${attempt}/${maxRetries} descarga media: ${error.message}`);
                    await sleep(5000 * attempt); // Backoff exponencial
                } else {
                    throw error;
                }
            }
        }
        
        return null;
    }

    // ─── UTILIDADES ─────────────────────────────────────────
    getMessageType(msg) {
        if (msg.type === 'ptt' || msg.type === 'audio') return 'audio';
        if (msg.type === 'image') return 'image';
        if (msg.type === 'video') return 'video';
        if (msg.type === 'document') return 'document';
        if (msg.type === 'sticker') return 'sticker';
        if (msg.type === 'location') return 'location';
        if (msg.type === 'vcard' || msg.type === 'multi_vcard') return 'contact';
        if (msg.type === 'chat' || msg.body) return 'text';
        return 'other';
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
