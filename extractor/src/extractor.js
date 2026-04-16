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
    // Estrategia: acceder al Store interno de WhatsApp Web vía
    // pupPage.evaluate(), bypasseando chat.fetchMessages() que
    // depende de módulos internos que a veces no cargan
    // (waitForChatLoading). Si Store falla, intenta fetchMessages
    // como fallback.
    async fetchAllMessages(chat) {
        const chatId = chat.id._serialized;

        // ── Intento 1: Store directo ──
        try {
            const msgs = await this._fetchViaStore(chatId);
            if (msgs && msgs.length > 0) {
                logger.info(`  📦 ${msgs.length} mensajes obtenidos vía Store`);
                return msgs;
            }
            logger.warn('  ⚠️  Store devolvió 0 mensajes');
        } catch (err) {
            logger.warn(`  ⚠️  Store falló: ${err.message}`);
        }

        // ── Intento 2: esperar + Store de nuevo ──
        logger.info('  ⏳ Esperando 15s y reintentando vía Store...');
        await sleep(15000);
        try {
            const msgs = await this._fetchViaStore(chatId);
            if (msgs && msgs.length > 0) {
                logger.info(`  📦 ${msgs.length} mensajes obtenidos vía Store (2do intento)`);
                return msgs;
            }
        } catch (err) {
            logger.warn(`  ⚠️  Store 2do intento falló: ${err.message}`);
        }

        // ── Intento 3: fetchMessages clásico (por si Store no aplica) ──
        logger.info('  🔄 Intentando chat.fetchMessages() como fallback...');
        try {
            const msgs = await chat.fetchMessages({ limit: 999999 });
            if (msgs && msgs.length > 0) {
                msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                logger.info(`  📦 ${msgs.length} mensajes obtenidos vía fetchMessages`);
                return msgs;
            }
        } catch (err) {
            logger.warn(`  ⚠️  fetchMessages falló: ${err.message}`);
        }

        return [];
    }

    // Acceso directo al Store interno de WhatsApp Web.
    // Carga historial con loadEarlierMsgs() y extrae datos de
    // chat.msgs._models sin depender de fetchMessages.
    async _fetchViaStore(chatId) {
        const page = this.client.pupPage;
        if (!page) throw new Error('pupPage no disponible');

        const rawMessages = await page.evaluate(async (chatId) => {
            // Verificar que Store existe
            if (!window.Store || !window.Store.Chat) {
                throw new Error('Store.Chat no disponible');
            }

            const chat = window.Store.Chat.get(chatId);
            if (!chat) throw new Error(`Chat ${chatId} no encontrado en Store`);

            // Forzar que WA Web "abra" el chat: esto dispara la
            // sincronización de mensajes para este chat específico.
            try {
                if (typeof chat.sendSeen === 'function') await chat.sendSeen();
            } catch (_) {}
            try {
                if (window.Store.Cmd && typeof window.Store.Cmd.openChatAt === 'function') {
                    await window.Store.Cmd.openChatAt(chat);
                }
            } catch (_) {}
            // Pequeña espera para que WA empiece a sincronizar el chat
            await new Promise(r => setTimeout(r, 3000));

            // Cargar historial más antiguo. loadEarlierMsgs trae
            // ~20-30 mensajes por llamada. Repetimos hasta que deje
            // de devolver o lleguemos a un tope razonable.
            if (window.Store.ConversationMsgs) {
                const MAX_LOADS = 80;
                let emptyRounds = 0;
                for (let i = 0; i < MAX_LOADS; i++) {
                    try {
                        const loaded = await window.Store.ConversationMsgs.loadEarlierMsgs(chat);
                        if (!loaded || loaded.length === 0) {
                            emptyRounds++;
                            if (emptyRounds >= 3) break;
                        } else {
                            emptyRounds = 0;
                        }
                    } catch (e) {
                        break;
                    }
                }
            }

            // Extraer modelos de mensajes
            let models = [];
            if (chat.msgs && chat.msgs._models) {
                models = chat.msgs._models;
            } else if (chat.msgs && typeof chat.msgs.getModelsArray === 'function') {
                models = chat.msgs.getModelsArray();
            } else if (chat.msgs && typeof chat.msgs.toArray === 'function') {
                models = chat.msgs.toArray();
            }

            return models.map(m => {
                const type = m.type || 'chat';
                const hasMedia = !!(
                    m.isMedia || m.mediaData ||
                    type === 'image' || type === 'video' ||
                    type === 'audio' || type === 'ptt' ||
                    type === 'document' || type === 'sticker'
                );

                return {
                    id: {
                        id: (m.id && m.id.id) || '',
                        _serialized: (m.id && m.id._serialized) || '',
                        fromMe: !!(m.id && m.id.fromMe),
                    },
                    body: m.body || '',
                    type: type,
                    timestamp: m.t || 0,
                    fromMe: !!(m.id && m.id.fromMe),
                    hasMedia: hasMedia,
                    isForwarded: m.isForwarded || false,
                    hasQuotedMsg: !!m.quotedStanzaID,
                    _data: {
                        notifyName: m.notifyName || null,
                        duration: m.duration || null,
                    },
                    _isStoreMsg: true,
                };
            });
        }, chatId);

        if (!rawMessages || rawMessages.length === 0) return [];

        // Filtrar mensajes de sistema (e2e_notification, etc.)
        const filtered = rawMessages.filter(m =>
            m.type !== 'e2e_notification' &&
            m.type !== 'notification_template' &&
            m.type !== 'gp2' &&
            m.type !== 'notification' &&
            m.type !== 'ciphertext'
        );

        filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        return filtered;
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
                let media;
                if (msg._isStoreMsg) {
                    // Mensajes del Store no tienen downloadMedia(); obtener
                    // el Message real de whatsapp-web.js vía su ID serializado.
                    const serializedId = msg.id?._serialized;
                    if (!serializedId) {
                        logger.warn(`  ⚠️  Sin ID serializado para media`);
                        return null;
                    }
                    const realMsg = await this.client.getMessageById(serializedId);
                    if (!realMsg) {
                        logger.warn(`  ⚠️  getMessageById devolvió null: ${serializedId}`);
                        return null;
                    }
                    media = await realMsg.downloadMedia();
                } else {
                    media = await msg.downloadMedia();
                }

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
