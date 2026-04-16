// ══════════════════════════════════════════════════════════════
// WHATSAPP EXTRACTOR — Baileys (sin Chromium)
// ══════════════════════════════════════════════════════════════

const P = require('pino');
const qrcode = require('qrcode-terminal');
const { createLogger } = require('./logger');
const { Database } = require('./database');
const { Extractor } = require('./extractor');
const { sleep, parseArgs } = require('./utils');

// Baileys — manejar ambos estilos de export (default vs named)
const baileys = require('@whiskeysockets/baileys');
const makeWASocket = baileys.default || baileys.makeWASocket;
const {
    useMultiFileAuthState,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    DisconnectReason,
} = baileys;

const logger = createLogger('main');

// ─── CONFIGURACIÓN ──────────────────────────────────────────
const SESSION_PATH = process.env.SESSION_PATH || '/app/auth_state';
const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '180000');

const CONFIG = {
    extractionDelayMin: parseInt(process.env.EXTRACTION_DELAY_MIN || '2000'),
    extractionDelayMax: parseInt(process.env.EXTRACTION_DELAY_MAX || '4000'),
    mediaDelayMin: parseInt(process.env.MEDIA_DELAY_MIN || '3000'),
    mediaDelayMax: parseInt(process.env.MEDIA_DELAY_MAX || '6000'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    dataDir: process.env.DATA_DIR || './data',
};

// ─── ESTADO GLOBAL ──────────────────────────────────────────
let sock = null;
let db = null;
let isShuttingDown = false;

// Acumulador de mensajes del history sync
const syncedMessages = new Map(); // jid -> WAMessage[]
const syncedContacts = new Map(); // jid -> pushName
let syncComplete = false;
let totalSyncedMsgs = 0;

// ─── CREAR SOCKET DE BAILEYS ────────────────────────────────
// Puede llamarse múltiples veces (en reconexiones). Los creds se
// reutilizan desde disco automáticamente vía useMultiFileAuthState.
async function createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    logger.info(`🔧 Baileys: WA Web v${version.join('.')} ${isLatest ? '(última)' : '(no es la última pero compatible)'}`);

    const pinoLogger = P({ level: 'silent' });

    const socket = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger),
        },
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: true,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        logger: pinoLogger,
        generateHighQualityLinkPreview: false,
        getMessage: async (key) => {
            const msgs = syncedMessages.get(key.remoteJid) || [];
            return msgs.find(m => m.key?.id === key.id)?.message || undefined;
        },
    });

    socket.ev.on('creds.update', saveCreds);

    return socket;
}

// Nombre legible para los códigos de DisconnectReason
function describeDisconnect(statusCode) {
    const map = {
        [DisconnectReason.badSession]: 'badSession (400)',
        [DisconnectReason.connectionClosed]: 'connectionClosed (428)',
        [DisconnectReason.connectionLost]: 'connectionLost (408)',
        [DisconnectReason.connectionReplaced]: 'connectionReplaced (440)',
        [DisconnectReason.loggedOut]: 'loggedOut (401)',
        [DisconnectReason.restartRequired]: 'restartRequired (515)',
        [DisconnectReason.timedOut]: 'timedOut (408)',
        [DisconnectReason.multideviceMismatch]: 'multideviceMismatch (411)',
    };
    return map[statusCode] || `código ${statusCode}`;
}

// ─── ESPERAR RESULTADO DE UNA CONEXIÓN ─────────────────────
// Resuelve con: 'open', 'restart' (515), 'loggedout', 'retry' u 'timeout'
function waitForConnectionOutcome(socket) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve('timeout'), 180000);
        let resolved = false;
        const done = (outcome) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timeout);
            resolve(outcome);
        };

        socket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;

            if (qr) {
                logger.info('═══════════════════════════════════════════');
                logger.info('ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP:');
                logger.info('═══════════════════════════════════════════');
                qrcode.generate(qr, { small: true });
                logger.info('Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo');
                logger.info('═══════════════════════════════════════════');
            }

            if (connection === 'connecting') {
                logger.info('🔌 connection: connecting...');
            }

            if (isNewLogin) {
                logger.info('🆕 Nuevo login detectado (emparejamiento exitoso)');
            }

            if (receivedPendingNotifications !== undefined) {
                logger.info(`📨 receivedPendingNotifications: ${receivedPendingNotifications}`);
            }

            if (connection === 'open') {
                logger.info('═══════════════════════════════════════════');
                logger.info('✅ WHATSAPP CONECTADO — Baileys');
                logger.info('═══════════════════════════════════════════');
                done('open');
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const label = describeDisconnect(statusCode);
                logger.warn(`❌ connection: close — ${label}`);
                if (lastDisconnect?.error?.message) {
                    logger.warn(`   mensaje: ${lastDisconnect.error.message}`);
                }

                if (statusCode === DisconnectReason.loggedOut) done('loggedout');
                else if (statusCode === DisconnectReason.restartRequired) done('restart');
                else done('retry');
            }
        });
    });
}

// ─── CONECTAR CON AUTO-RECONEXIÓN ──────────────────────────
// Maneja el flow completo: QR → pairing → restart(515) → connected.
// El código 515 NO es un error: es la señal estándar de Baileys de
// que el emparejamiento terminó y hay que recrear el socket.
async function connectWithRetry() {
    const MAX_RETRIES = 6;
    let lastReason = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        logger.info(`🔌 Intento de conexión ${attempt}/${MAX_RETRIES}...`);

        const socket = await createSocket();
        setupHistorySync(socket);

        const outcome = await waitForConnectionOutcome(socket);

        if (outcome === 'open') {
            return socket;
        }

        // Cerrar el socket actual antes de crear uno nuevo
        try { socket.end(undefined); } catch (_) {}
        await sleep(1500);

        if (outcome === 'loggedout') {
            throw new Error('Sesión cerrada por WhatsApp (401). Borra el volumen auth_state y re-escanea QR.');
        }

        if (outcome === 'restart') {
            logger.info('🔄 restartRequired (515): pairing exitoso, creando socket nuevo con los creds guardados...');
            lastReason = 'restart';
            continue;
        }

        if (outcome === 'timeout') {
            logger.warn('⚠️  Timeout de 3 min esperando connection.update — reintentando...');
            lastReason = 'timeout';
            continue;
        }

        // 'retry' — cualquier otro close. Backoff leve.
        logger.info('   Reintentando en 3s...');
        lastReason = 'retry';
        await sleep(3000);
    }

    throw new Error(`No se pudo establecer conexión estable tras ${MAX_RETRIES} intentos (último: ${lastReason})`);
}

// ─── RECOLECTAR HISTORIAL SINCRONIZADO ──────────────────────
function setupHistorySync(socket) {
    socket.ev.on('messaging-history.set', ({ messages, contacts, isLatest }) => {
        let batchIndividual = 0;

        for (const msg of messages) {
            const jid = msg.key?.remoteJid;
            if (!jid || jid === 'status@broadcast') continue;
            if (jid.endsWith('@g.us')) continue;

            if (!syncedMessages.has(jid)) syncedMessages.set(jid, []);
            syncedMessages.get(jid).push(msg);
            batchIndividual++;
            totalSyncedMsgs++;
        }

        // Guardar nombres de contactos
        if (contacts) {
            for (const c of contacts) {
                if (c.id && c.notify) syncedContacts.set(c.id, c.notify);
            }
        }

        logger.info(
            `📥 Sync batch: ${batchIndividual} msgs individuales ` +
            `(${syncedMessages.size} chats, ${totalSyncedMsgs} msgs total)` +
            `${isLatest ? ' — ÚLTIMO BATCH' : ''}`
        );

        if (isLatest) {
            syncComplete = true;
        }
    });

    // También capturar mensajes nuevos que llegan durante la extracción
    socket.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            const jid = msg.key?.remoteJid;
            if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;
            if (!syncedMessages.has(jid)) syncedMessages.set(jid, []);
            syncedMessages.get(jid).push(msg);
        }
    });

    // Capturar pushNames de contacts.update
    socket.ev.on('contacts.update', (updates) => {
        for (const u of updates) {
            if (u.id && u.notify) syncedContacts.set(u.id, u.notify);
        }
    });
}

// ─── ESPERAR A QUE TERMINE EL SYNC ─────────────────────────
async function waitForHistorySync() {
    logger.info(`⏳ Esperando sincronización de historial (máx ${Math.round(SYNC_TIMEOUT_MS / 1000)}s)...`);
    const start = Date.now();

    while (!syncComplete && (Date.now() - start) < SYNC_TIMEOUT_MS) {
        await sleep(3000);
        if (!syncComplete) {
            logger.info(`   ... ${syncedMessages.size} chats, ${totalSyncedMsgs} msgs hasta ahora`);
        }
    }

    if (!syncComplete) {
        logger.warn('⚠️  Timeout de sync — continuando con los mensajes disponibles');
    }

    logger.info('═══════════════════════════════════════════');
    logger.info(`✅ SYNC FINALIZADO:`);
    logger.info(`   Chats individuales: ${syncedMessages.size}`);
    logger.info(`   Mensajes totales: ${totalSyncedMsgs}`);
    logger.info(`   Contactos con nombre: ${syncedContacts.size}`);
    logger.info('═══════════════════════════════════════════');
}

// ─── PEDIR MÁS HISTORIAL (fetchMessageHistory) ─────────────
async function requestMoreHistory(socket, jid, existingMessages) {
    if (typeof socket.fetchMessageHistory !== 'function') {
        logger.info('   fetchMessageHistory no disponible en esta versión de Baileys');
        return;
    }

    existingMessages.sort((a, b) =>
        Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
    );
    const oldest = existingMessages[0];
    if (!oldest) return;

    const MAX_BATCHES = 15;
    for (let batch = 1; batch <= MAX_BATCHES; batch++) {
        const countBefore = (syncedMessages.get(jid) || []).length;

        try {
            const sortedMsgs = (syncedMessages.get(jid) || []).sort((a, b) =>
                Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
            );
            const oldestMsg = sortedMsgs[0];

            await socket.fetchMessageHistory(
                50,
                oldestMsg.key,
                oldestMsg.messageTimestamp
            );
        } catch (err) {
            logger.info(`   fetchMessageHistory terminó (batch ${batch}): ${err.message}`);
            break;
        }

        // Esperar a que lleguen mensajes vía messaging-history.set
        await sleep(5000);

        const countAfter = (syncedMessages.get(jid) || []).length;
        const newMsgs = countAfter - countBefore;

        if (newMsgs > 0) {
            logger.info(`   📜 Batch ${batch}: +${newMsgs} mensajes adicionales (total: ${countAfter})`);
        } else {
            logger.info(`   📜 Batch ${batch}: sin mensajes nuevos — historial completo`);
            break;
        }
    }
}

// ─── MODO: TEST DE CONEXIÓN ─────────────────────────────────
async function runTestMode() {
    logger.info('🔍 MODO TEST — Resumen de sincronización:');
    logger.info('═══════════════════════════════════════════');
    logger.info(`📊 RESUMEN DE TU WHATSAPP:`);
    logger.info(`   Chats individuales sincronizados: ${syncedMessages.size}`);
    logger.info(`   Mensajes totales: ${totalSyncedMsgs}`);
    logger.info(`   Contactos con nombre: ${syncedContacts.size}`);
    logger.info('═══════════════════════════════════════════');

    // Top 10 chats por cantidad de mensajes
    const sorted = [...syncedMessages.entries()]
        .map(([jid, msgs]) => ({
            jid,
            name: syncedContacts.get(jid) || jid.replace('@s.whatsapp.net', ''),
            count: msgs.length,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    logger.info('📋 Top 10 chats con más mensajes:');
    for (const chat of sorted) {
        logger.info(`   📱 ${chat.name} — ${chat.count} msgs`);
    }

    logger.info('');
    logger.info('✅ Conexión verificada. Para extraer, ejecuta: npm run extract');
}

// ─── MODO: ESTADÍSTICAS ─────────────────────────────────────
async function runStatsMode() {
    logger.info('📊 MODO STATS — Consultando base de datos...');
    const stats = await db.getExtractionStats();

    logger.info('═══════════════════════════════════════════');
    logger.info('📊 ESTADÍSTICAS DE EXTRACCIÓN:');
    logger.info(`   Total conversaciones: ${stats.total}`);
    logger.info(`   Extraídas: ${stats.extracted}`);
    logger.info(`   Pendientes: ${stats.pending}`);
    logger.info(`   Fallidas: ${stats.failed}`);
    logger.info(`   Total mensajes: ${stats.total_messages}`);
    logger.info(`   Total audios: ${stats.total_audios}`);
    logger.info('═══════════════════════════════════════════');
}

// ─── MODO: EXTRACCIÓN ───────────────────────────────────────
async function runExtractMode(options = {}) {
    logger.info('🚀 MODO EXTRACCIÓN — Iniciando proceso...');

    const extractor = new Extractor(sock, db, CONFIG);
    const runId = await db.createExtractionRun();

    try {
        // Filtrar chats según opciones
        let targetChats = [...syncedMessages.entries()]
            .map(([jid, msgs]) => ({
                jid,
                name: syncedContacts.get(jid) || jid.replace('@s.whatsapp.net', ''),
                messages: msgs,
            }));

        if (options.phone) {
            const phone = String(options.phone).replace(/[^0-9]/g, '');
            const match = targetChats.find(c =>
                c.jid.replace('@s.whatsapp.net', '') === phone
            );
            if (!match) {
                throw new Error(`No se encontró chat para el número ${phone}. Chats disponibles: ${targetChats.length}`);
            }
            logger.info(`⚙️  --phone=${phone}: extrayendo solo ${match.name}`);
            targetChats = [match];
        }

        if (options.limit && options.limit > 0 && options.limit < targetChats.length) {
            logger.info(`⚙️  --limit=${options.limit}: solo los primeros ${options.limit} chats`);
            targetChats = targetChats.slice(0, options.limit);
        }

        logger.info(`Total de chats a extraer: ${targetChats.length}`);
        await db.updateExtractionRun(runId, { total_chats: targetChats.length, status: 'running' });

        // Verificar checkpoint (salvo --force)
        const alreadyExtracted = options.force
            ? new Set()
            : await db.getExtractedChatIds();

        if (options.force) {
            logger.info(`⚙️  --force: ignorando checkpoint. Borrando registros previos de los chats objetivo...`);
            for (const chat of targetChats) {
                const deleted = await db.deleteConversation(chat.jid);
                if (deleted > 0) {
                    logger.info(`   🗑️  ${chat.name}: ${deleted} registro(s) previos eliminados`);
                }
            }
        } else {
            logger.info(`📌 Checkpoint: ${alreadyExtracted.size} chats ya extraídos previamente`);
        }

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < targetChats.length; i++) {
            if (isShuttingDown) {
                logger.warn('⚠️  Shutdown solicitado. Guardando progreso...');
                break;
            }

            const chat = targetChats[i];
            const progress = `[${i + 1}/${targetChats.length}]`;

            if (alreadyExtracted.has(chat.jid)) {
                logger.info(`${progress} ⏭️  ${chat.name}: ya extraído (checkpoint). Usa --force para re-extraer.`);
                continue;
            }

            try {
                logger.info(`${progress} Extrayendo: ${chat.name} (${chat.messages.length} msgs sincronizados)`);

                // Pedir más historial si es posible
                await requestMoreHistory(sock, chat.jid, chat.messages);

                // Obtener mensajes actualizados (pueden haber llegado más)
                const allMessages = syncedMessages.get(chat.jid) || chat.messages;

                await extractor.extractChat(chat.jid, chat.name, allMessages, runId);
                successCount++;

                if ((successCount + failCount) % 50 === 0) {
                    logger.info(`📊 Progreso: ${successCount} exitosos, ${failCount} fallidos`);
                }

                // Rate limit entre chats
                const delay = randomBetween(CONFIG.extractionDelayMin, CONFIG.extractionDelayMax);
                await sleep(delay);

            } catch (error) {
                failCount++;
                logger.error(`${progress} ❌ Error: ${chat.name}: ${error.message}`);
                await db.markConversationFailed(chat.jid, error.message);

                if (failCount > 10 && failCount / (successCount + failCount) > 0.5) {
                    logger.error('⚠️  Demasiados errores. Pausando 60s...');
                    await sleep(60000);
                }
            }
        }

        await db.updateExtractionRun(runId, {
            status: isShuttingDown ? 'paused' : 'completed',
            extracted_chats: successCount,
            failed_chats: failCount,
            finished_at: new Date().toISOString(),
        });

        logger.info('═══════════════════════════════════════════');
        logger.info('✅ EXTRACCIÓN COMPLETADA');
        logger.info(`   Exitosos: ${successCount}`);
        logger.info(`   Fallidos: ${failCount}`);
        logger.info(`   Ya extraídos (checkpoint): ${alreadyExtracted.size}`);
        logger.info('═══════════════════════════════════════════');

    } catch (error) {
        logger.error(`Error fatal en extracción: ${error.message}`);
        await db.updateExtractionRun(runId, { status: 'failed', error_log: error.message });
        throw error;
    }
}

// ─── UTILIDADES ─────────────────────────────────────────────
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── SHUTDOWN GRACEFUL ──────────────────────────────────────
function setupGracefulShutdown() {
    const shutdown = async (signal) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        logger.info(`\n⏹️  Señal ${signal} recibida. Cerrando limpiamente...`);

        try {
            if (sock) {
                logger.info('Cerrando socket de WhatsApp...');
                sock.end(undefined);
            }
            if (db) {
                logger.info('Cerrando conexión a base de datos...');
                await db.close();
            }
        } catch (error) {
            logger.error(`Error durante shutdown: ${error.message}`);
        }

        logger.info('✅ Shutdown limpio completado.');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', async (error) => {
        logger.error(`Excepción no capturada: ${error.message}`);
        logger.error(error.stack);
        await shutdown('uncaughtException');
    });
    process.on('unhandledRejection', async (reason) => {
        logger.error(`Promise rechazada: ${reason}`);
        await shutdown('unhandledRejection');
    });
}

// ─── MAIN ───────────────────────────────────────────────────
async function main() {
    setupGracefulShutdown();

    const args = parseArgs();
    const mode = args.mode || 'extract';
    const limit = args.limit ? parseInt(args.limit, 10) : null;
    const phone = args.phone ? String(args.phone).replace(/[^0-9]/g, '') : null;
    const skipMedia = !!args['skip-media'] || !!args.skipMedia;
    const force = !!args.force;

    if (args.limit && (!Number.isFinite(limit) || limit <= 0)) {
        logger.error(`Valor inválido para --limit: ${args.limit}`);
        process.exit(1);
    }

    // Propagar skipMedia al CONFIG para que Extractor lo lea
    CONFIG.skipMedia = skipMedia;

    logger.info('══════════════════════════════════════════════');
    logger.info('  WHATSAPP AUDIT SYSTEM — EXTRACTOR (Baileys)');
    logger.info(`  Modo: ${mode.toUpperCase()}`);
    if (limit) logger.info(`  Límite: ${limit} chats`);
    if (phone) logger.info(`  Teléfono: ${phone}`);
    if (skipMedia) logger.info(`  --skip-media activo: solo textos, sin descargar audios/imágenes`);
    if (force) logger.info(`  --force activo: ignora checkpoint y borra registros previos del chat`);
    logger.info('══════════════════════════════════════════════');

    // Conectar a BD
    db = new Database();
    await db.connect();
    logger.info('✅ Conectado a PostgreSQL');

    if (mode === 'stats') {
        await runStatsMode();
        await db.close();
        return;
    }

    // Crear socket y conectar
    // connectWithRetry maneja internamente: QR, pairing, restart(515), reconexiones
    sock = await connectWithRetry();

    // Esperar sync de historial
    await waitForHistorySync();

    // Ejecutar modo
    switch (mode) {
        case 'test':
            await runTestMode();
            break;
        case 'extract':
            await runExtractMode({ limit, phone, force });
            break;
        default:
            logger.error(`Modo desconocido: ${mode}`);
    }

    // Cleanup
    logger.info('Cerrando conexiones...');
    sock.end(undefined);
    await db.close();
    logger.info('✅ Todo cerrado limpiamente.');
}

main().catch((error) => {
    logger.error(`Error fatal: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
});
