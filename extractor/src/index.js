// ══════════════════════════════════════════════════════════════
// WHATSAPP EXTRACTOR — Baileys (sin Chromium)
// ══════════════════════════════════════════════════════════════

const P = require('pino');
const qrcode = require('qrcode-terminal');
const { createLogger } = require('./logger');
const { Database } = require('./database');
const { Extractor } = require('./extractor');
const { sleep, parseArgs, randomBetween } = require('./utils');
const statusPub = require('./status-publisher');

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
// Tiempo que esperamos a que WhatsApp termine de mandar messaging-history.set.
// Default 1 hora. Con 6000+ chats y syncFullHistory=true el teléfono tarda
// MUCHO en subir todo el historial, especialmente si hay muchos audios.
// El proceso igual termina antes si llega 'isLatest' en un batch.
const SYNC_TIMEOUT_MS = parseInt(process.env.SYNC_TIMEOUT_MS || '3600000');

// Cutoff de fecha: solo se indexan chats cuyo ÚLTIMO mensaje es ≤ esta
// fecha. Decisión de Carlos (2026-04-26): el snapshot del proyecto se
// congela el 2026-03-20 — chats con actividad posterior (leads vivos)
// no entran al pipeline de auditoría. Configurable por env var.
const EXTRACTION_CUTOFF_DATE = process.env.EXTRACTION_CUTOFF_DATE || '2026-03-20';

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
// `syncedChats` = lista COMPLETA de chats que WhatsApp reporta vía
// chats.set/chats.upsert (lo que la app web usa para la lista lateral).
// Es la fuente de verdad real de "qué chats existen", independiente de
// si messaging-history.set trajo mensajes para ellos. Permite indexar
// los 12k chats reales aunque WhatsApp solo entregue mensajes para 471.
const syncedChats = new Map(); // jid -> { name, conversationTimestamp, unreadCount, archived }
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
        // Browser hint: cambiamos de macOS a Ubuntu/Chrome porque WhatsApp
        // ha venido limitando agresivamente el sync histórico para clientes
        // marcados como "Desktop Mac". Ubuntu/Chrome tiende a recibir más
        // batches de history (reportes 2026 de la comunidad Baileys).
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true,
        // Aceptar TODO mensaje histórico que WhatsApp envíe (Baileys 6.7+).
        // Sin esto, default puede filtrar mensajes "antiguos" del sync.
        shouldSyncHistoryMessage: () => true,
        // Cuántos chats máximo cachear en memoria de mensajes recientes
        // (Baileys defaultea a 1000; subimos para no perder por LRU).
        markOnlineOnConnect: false,
        printQRInTerminal: false,
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
        const timeout = setTimeout(() => resolve('timeout'), SYNC_TIMEOUT_MS);
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
                logger.info('💡 También disponible en el dashboard: /conexion');
                logger.info('═══════════════════════════════════════════');
                // Publicar a Redis para que el dashboard lo muestre.
                statusPub.publishQR(qr).catch(() => {});
            }

            if (connection === 'connecting') {
                logger.info('🔌 connection: connecting...');
                statusPub.setStatus('connecting').catch(() => {});
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
                statusPub.setStatus('connected').catch(() => {});
                statusPub.notifyConnected().catch(() => {});
                done('open');
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const label = describeDisconnect(statusCode);
                logger.warn(`❌ connection: close — ${label}`);
                if (lastDisconnect?.error?.message) {
                    logger.warn(`   mensaje: ${lastDisconnect.error.message}`);
                }

                statusPub.setStatus(
                    statusCode === DisconnectReason.loggedOut ? 'disconnected' : 'reconnecting'
                ).catch(() => {});

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
// `lastBatchAt` rastrea cuándo llegó el último batch. Usado por
// waitForHistorySync para saber si WhatsApp dejó de mandar batches.
let lastBatchAt = 0;
let totalBatches = 0;
let isLatestSeen = false;

function setupHistorySync(socket) {
    // Reset defensivo de variables globales del sync. Si setupHistorySync
    // se llama varias veces (reconexiones, reintentos), evitamos arrastrar
    // contadores de la sesión anterior. waitForHistorySync también las
    // resetea pero mejor doblar el seguro.
    lastBatchAt = 0;
    totalBatches = 0;
    isLatestSeen = false;

    // ─── DESCUBRIR TODOS LOS CHATS (no solo los con mensajes) ──
    // chats.set/chats.upsert traen la lista COMPLETA de conversaciones
    // que el cliente tiene en WhatsApp, con metadata mínima
    // (last_message_at, unreadCount, name). NO depende de si
    // messaging-history.set trajo mensajes para ese chat.
    function _registerChat(c) {
        const jid = c.id;
        if (!jid || jid === 'status@broadcast') return;
        if (jid.endsWith('@g.us')) return;          // grupos fuera
        if (jid.endsWith('@broadcast')) return;
        if (jid.endsWith('@newsletter')) return;
        if (jid.endsWith('@lid')) return;           // LIDs no son teléfonos
        if (jid.endsWith('@status')) return;        // status updates
        if (jid.endsWith('@call')) return;          // call rooms (futuro)

        const existing = syncedChats.get(jid) || {};
        // conversationTimestamp viene en segundos UNIX (number o BigInt).
        const ts = c.conversationTimestamp != null
            ? Number(c.conversationTimestamp)
            : existing.conversationTimestamp;
        const name = c.name || c.notify || existing.name || null;
        syncedChats.set(jid, {
            name,
            conversationTimestamp: ts,
            unreadCount: c.unreadCount ?? existing.unreadCount,
            archived: c.archived ?? existing.archived,
        });
    }

    socket.ev.on('messaging-history.set', (data) => {
        // Defensivo: data.messages puede ser undefined en algunas builds.
        const messages = data?.messages || [];
        const contacts = data?.contacts || [];
        const chats = data?.chats || [];   // Baileys 6.7+ a veces incluye chats acá
        const isLatest = !!data?.isLatest;

        let batchIndividual = 0;
        totalBatches++;
        lastBatchAt = Date.now();

        for (const msg of messages) {
            const jid = msg.key?.remoteJid;
            if (!jid || jid === 'status@broadcast') continue;
            if (jid.endsWith('@g.us')) continue;

            if (!syncedMessages.has(jid)) syncedMessages.set(jid, []);
            syncedMessages.get(jid).push(msg);
            batchIndividual++;
            totalSyncedMsgs++;
        }

        // Si messaging-history.set incluye chats[], también los registramos
        // — Baileys consolidó en este evento cosas que antes iban en chats.set.
        if (chats.length > 0) {
            for (const c of chats) _registerChat(c);
        }

        // Guardar nombres de contactos
        for (const c of contacts) {
            if (c.id && c.notify) syncedContacts.set(c.id, c.notify);
        }

        logger.info(
            `📥 Sync batch #${totalBatches}: ${batchIndividual} msgs ` +
            `(${syncedMessages.size} chats c/msgs, ${totalSyncedMsgs} msgs total · ` +
            `${syncedChats.size} chats descubiertos)` +
            `${isLatest ? ' — flag isLatest=true' : ''}`
        );

        // NO marcamos syncComplete inmediatamente — WhatsApp suele mandar
        // batches adicionales DESPUÉS del isLatest=true (con minutos de
        // delay). Solo marcamos que vimos el flag; waitForHistorySync
        // decidirá cuándo cortar basado en inactividad.
        if (isLatest) {
            isLatestSeen = true;
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

    // Capturar pushNames de contacts.update + agregar al store de chats
    // si todavía no estaba (algunos chats solo aparecen vía contacts).
    socket.ev.on('contacts.update', (data) => {
        const updates = Array.isArray(data) ? data : [];
        for (const u of updates) {
            if (u?.id && u.notify) syncedContacts.set(u.id, u.notify);
        }
    });
    socket.ev.on('contacts.upsert', (data) => {
        const contacts = Array.isArray(data) ? data : [];
        for (const c of contacts) {
            if (c?.id && c.notify) syncedContacts.set(c.id, c.notify);
        }
    });

    // chats.set: lista COMPLETA de chats. Defensivo contra firma variable
    // (algunos builds de Baileys pasan array directo, otros { chats, isLatest }).
    socket.ev.on('chats.set', (data) => {
        const chats = Array.isArray(data) ? data : (data?.chats || []);
        const isLatest = !!data?.isLatest;
        if (!chats.length) return;
        for (const c of chats) _registerChat(c);
        logger.info(
            `📇 chats.set: ${chats.length} chats (total descubiertos: ${syncedChats.size})` +
            `${isLatest ? ' — flag isLatest=true' : ''}`
        );
        lastBatchAt = Date.now();
        totalBatches++;
        // CRÍTICO: marcar isLatestSeen también acá. Si messaging-history.set
        // nunca emite isLatest pero chats.set sí, waitForHistorySync nunca
        // cortaría por silencio (esperaría el timeout completo de 2h).
        if (isLatest) isLatestSeen = true;
    });

    socket.ev.on('chats.upsert', (data) => {
        const chats = Array.isArray(data) ? data : (data?.chats || []);
        if (!chats.length) return;
        for (const c of chats) _registerChat(c);
        logger.info(
            `📇 chats.upsert: +${chats.length} (total descubiertos: ${syncedChats.size})`
        );
        lastBatchAt = Date.now();
    });

    socket.ev.on('chats.update', (data) => {
        const updates = Array.isArray(data) ? data : (data?.chats || []);
        for (const c of updates) {
            if (!c?.id) continue;
            // updates pueden actualizar conversationTimestamp/unreadCount
            // de chats ya descubiertos. Mantenemos el merge.
            _registerChat(c);
        }
    });
}

// ─── ESPERAR A QUE TERMINE EL SYNC ─────────────────────────
// Estrategia (2026-04-26): WhatsApp Multi-device tiende a mandar batches
// de history en oleadas SEPARADAS. El flag `isLatest=true` del primer
// batch NO significa "no vienen más" — significa "este batch es el más
// reciente del lote actual". Se han observado batches adicionales con
// chats más viejos hasta 5-10 min después.
//
// Nueva lógica: esperamos hasta que:
//   (a) se alcance SYNC_TIMEOUT_MS total, O
//   (b) hayan pasado SYNC_QUIET_MS sin recibir NINGÚN batch nuevo
//       (indicador robusto de que WhatsApp ya no manda nada más).
const SYNC_QUIET_MS = parseInt(process.env.SYNC_QUIET_MS || '120000', 10); // 2 min de silencio = sync terminado

async function waitForHistorySync() {
    logger.info(
        `⏳ Esperando sincronización de historial ` +
        `(máx ${Math.round(SYNC_TIMEOUT_MS / 1000)}s · corte por silencio: ` +
        `${Math.round(SYNC_QUIET_MS / 1000)}s sin nuevos batches)...`
    );
    const start = Date.now();
    lastBatchAt = 0;
    totalBatches = 0;
    isLatestSeen = false;

    while ((Date.now() - start) < SYNC_TIMEOUT_MS) {
        await sleep(5000);

        // Heartbeat cada 5s
        const elapsed = Math.round((Date.now() - start) / 1000);
        const timeSinceLastBatch = lastBatchAt > 0
            ? Math.round((Date.now() - lastBatchAt) / 1000)
            : null;

        logger.info(
            `   ... ${syncedChats.size} chats descubiertos · ` +
            `${syncedMessages.size} con mensajes (${totalSyncedMsgs} msgs total) · ` +
            `batches: ${totalBatches}, elapsed: ${elapsed}s, ` +
            `last batch: ${timeSinceLastBatch !== null ? timeSinceLastBatch + 's atrás' : 'aún no'}`
        );

        // Condición de corte: ya vimos isLatest Y pasaron SYNC_QUIET_MS
        // sin nuevos batches. Doble validación evita cortar demasiado pronto.
        if (isLatestSeen && lastBatchAt > 0 &&
            (Date.now() - lastBatchAt) >= SYNC_QUIET_MS) {
            syncComplete = true;
            logger.info(
                `   ✓ ${Math.round(SYNC_QUIET_MS / 1000)}s sin nuevos batches después de isLatest. ` +
                `Asumiendo sync terminado.`
            );
            break;
        }
    }

    if (!syncComplete) {
        logger.warn(
            `⚠️  Timeout de sync (${Math.round(SYNC_TIMEOUT_MS / 1000)}s) — ` +
            `continuando con los ${totalSyncedMsgs} mensajes disponibles`
        );
    }

    logger.info('═══════════════════════════════════════════');
    logger.info(`✅ SYNC FINALIZADO:`);
    logger.info(`   Chats descubiertos (lista completa): ${syncedChats.size}`);
    logger.info(`   Chats con mensajes: ${syncedMessages.size}`);
    logger.info(`   Mensajes totales: ${totalSyncedMsgs}`);
    logger.info(`   Contactos con nombre: ${syncedContacts.size}`);
    logger.info(`   Total batches recibidos: ${totalBatches}`);
    logger.info('═══════════════════════════════════════════');
}

// ─── Formato ETA humano ─────────────────────────────────────
function formatETA(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
}

// ─── PEDIR MÁS HISTORIAL (fetchMessageHistory) ─────────────
// Solo se llama para chats con POCO contenido del sync inicial.
// Con 6000 chats + 15 batches × 5s cada uno = 125 horas. Inaceptable.
// Solución: si el chat ya trae >= MIN_MSGS_FOR_SKIP_FETCH mensajes del
// sync, confiamos en eso y NO hacemos fetch adicional. Para chats con
// menos historial, hacemos hasta MAX_BATCHES paginas hacia atrás.
const MIN_MSGS_FOR_SKIP_FETCH = parseInt(process.env.MIN_MSGS_FOR_SKIP_FETCH || '30', 10);
const FETCH_HISTORY_MAX_BATCHES = parseInt(process.env.FETCH_HISTORY_MAX_BATCHES || '5', 10);
const FETCH_HISTORY_SLEEP_MS = parseInt(process.env.FETCH_HISTORY_SLEEP_MS || '3000', 10);

async function requestMoreHistory(socket, jid, existingMessages) {
    if (typeof socket.fetchMessageHistory !== 'function') {
        return;
    }
    // Skip si el sync ya trajo suficiente historial para este chat.
    if ((existingMessages || []).length >= MIN_MSGS_FOR_SKIP_FETCH) {
        return;
    }

    existingMessages.sort((a, b) =>
        Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0)
    );
    const oldest = existingMessages[0];
    if (!oldest) return;

    for (let batch = 1; batch <= FETCH_HISTORY_MAX_BATCHES; batch++) {
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
            // fetchMessageHistory puede fallar silenciosamente — no es bloqueante.
            break;
        }

        await sleep(FETCH_HISTORY_SLEEP_MS);

        const countAfter = (syncedMessages.get(jid) || []).length;
        const newMsgs = countAfter - countBefore;

        if (newMsgs === 0) {
            break;  // sin nuevos mensajes → historial agotado o callback no disparó
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

// ─── MODO: DAEMON (escucha cola Redis) ──────────────────────
// El dashboard publica jobs vía API → Redis. Este loop los procesa
// uno a uno. Mismo patrón que el analyzer.
// Action posibles:
//   - "preview": no abre WhatsApp, solo lee DB y publica resultado.
//   - "index":   abre WhatsApp (QR si hace falta), guarda metadatos,
//                cierra al terminar.
//   - "extract": abre WhatsApp + procesa próximos N chats indexados.
async function runDaemonMode() {
    logger.info('🤖 MODO DAEMON — Escuchando cola Redis `wa:jobs`...');
    logger.info('   Para encolar un job desde dashboard: POST /api/extraction/jobs');
    logger.info('═══════════════════════════════════════════');

    // Limpia cualquier job huérfano que haya quedado por crash anterior —
    // sin esto, POST /jobs devolvería 409 hasta el TTL (2h) bloqueando
    // a Carlos.
    const orphan = await statusPub.clearOrphanCurrentJob();
    if (orphan) {
        logger.warn(`🧹 Job huérfano del crash anterior limpiado: ${orphan.action} (id=${orphan.id || '?'})`);
    }

    // Heartbeat inicial: el dashboard ve el daemon vivo desde el arranque.
    await statusPub.daemonHeartbeat();

    while (!isShuttingDown) {
        // Heartbeat ANTES de bloquear en BRPOP: si no hay jobs durante
        // mucho tiempo, el TTL de wa:status (5min) no expira porque acá
        // refrescamos cada ~5s.
        await statusPub.daemonHeartbeat();

        const job = await statusPub.popJob(5);
        if (!job) continue;  // timeout, vuelve a esperar

        logger.info('═══════════════════════════════════════════');
        logger.info(`🛎️  JOB recibido: ${job.action} (id=${job.id || '?'})`);
        const startedAt = new Date().toISOString();

        await statusPub.setCurrentJob({
            ...job,
            status: 'running',
            started_at: startedAt,
        });

        let result = { id: job.id, action: job.action, status: 'completed' };

        try {
            if (job.action === 'preview') {
                await runPreviewMode();
            } else if (job.action === 'index') {
                sock = await connectWithRetry();
                await waitForHistorySync();
                await runIndexMode();
                if (sock) { try { sock.end(undefined); } catch(_){} sock = null; }
            } else if (job.action === 'extract') {
                const batch = parseInt(job.batch, 10);
                if (!batch || batch <= 0) {
                    throw new Error('extract job requires `batch` > 0');
                }
                const before = job.before && /^\d{4}-\d{2}-\d{2}$/.test(job.before)
                    ? job.before
                    : null;
                sock = await connectWithRetry();
                await waitForHistorySync();
                await runExtractMode({ batch, before });
                if (sock) { try { sock.end(undefined); } catch(_){} sock = null; }
            } else {
                throw new Error(`Acción desconocida: ${job.action}`);
            }
        } catch (err) {
            logger.error(`❌ Job ${job.action} falló: ${err.message}`);
            result.status = 'failed';
            result.error = err.message;
            if (sock) { try { sock.end(undefined); } catch(_){} sock = null; }
        }

        result.started_at = startedAt;
        result.finished_at = new Date().toISOString();
        await statusPub.pushJobHistory(result);
        await statusPub.setCurrentJob(null);

        // Reset estado global del sync para el próximo job.
        syncedMessages.clear();
        syncedContacts.clear();
        syncedChats.clear();
        syncComplete = false;
        totalSyncedMsgs = 0;
        lastBatchAt = 0;
        totalBatches = 0;
        isLatestSeen = false;

        logger.info(`✅ Job ${job.action} ${result.status}.`);
        logger.info('   Esperando próximo job...');
    }

    logger.info('🛑 Daemon detenido (shutdown).');
}

// ─── MODO: ESTADÍSTICAS ─────────────────────────────────────
async function runStatsMode() {
    logger.info('📊 MODO STATS — Consultando base de datos...');
    const stats = await db.getExtractionStats();

    logger.info('═══════════════════════════════════════════');
    logger.info('📊 ESTADÍSTICAS DE EXTRACCIÓN:');
    logger.info(`   Total conversaciones: ${stats.total}`);
    logger.info(`   Indexadas (sin extraer): ${stats.indexado || 0}`);
    logger.info(`   Extraídas: ${stats.extracted}`);
    logger.info(`   Pendientes: ${stats.pending}`);
    logger.info(`   Fallidas: ${stats.failed}`);
    logger.info(`   Total mensajes: ${stats.total_messages}`);
    logger.info(`   Total audios: ${stats.total_audios}`);
    logger.info('═══════════════════════════════════════════');
}

// ─── MODO: PREVIEW (sin Baileys, solo lee DB) ────────────────
async function runPreviewMode() {
    logger.info('👁️  MODO PREVIEW — Estado del snapshot indexado:');
    logger.info('═══════════════════════════════════════════');

    const stats = await db.getExtractionStats();
    const frontier = await db.getExtractionFrontier();
    const histogram = await db.getIndexHistogram();

    logger.info(`📊 RESUMEN:`);
    logger.info(`   Total chats en DB:   ${stats.total}`);
    logger.info(`   Indexados pendientes: ${frontier.indexado_pendientes}`);
    logger.info(`   Ya extraídos:         ${frontier.extracted_total}`);
    logger.info(`   Fallidos:             ${stats.failed}`);
    logger.info('');
    logger.info(`🎯 SIGUIENTE LOTE:`);
    if (frontier.next_priority) {
        logger.info(`   Próxima prioridad a procesar: #${frontier.next_priority}`);
    } else {
        logger.info(`   No hay chats indexados pendientes.`);
        logger.info(`   Si nunca corriste \`npm run index\`, ejecutalo ahora.`);
    }

    if (histogram.length > 0) {
        logger.info('');
        logger.info('📅 HISTOGRAMA POR MES (last_message_at):');
        for (const row of histogram) {
            const bar = '█'.repeat(Math.min(50, Math.round(row.total / 50)));
            logger.info(
                `   ${row.mes}: ${String(row.total).padStart(5)} chats ` +
                `(idx:${row.indexado} ext:${row.extracted} fail:${row.failed}) ${bar}`
            );
        }
    }
    logger.info('═══════════════════════════════════════════');
}

// ─── MODO: INDEX (primer escaneo, solo metadatos) ────────────
async function runIndexMode() {
    logger.info('📇 MODO INDEX — Guardando solo metadatos de chats...');
    logger.info(`   Cutoff de fecha: chats con last_message_at ≤ ${EXTRACTION_CUTOFF_DATE} solamente`);
    logger.info(`   (chats con actividad posterior se IGNORAN)`);
    logger.info('═══════════════════════════════════════════');

    const extractor = new Extractor(sock, db, CONFIG);
    const runId = await db.createExtractionRun();

    // FUENTE UNIFICADA: chats.set (lista oficial de WhatsApp) UNION
    // syncedMessages (chats con mensajes, aunque WhatsApp no los listó
    // explícitamente). Algunos chats antiguos solo aparecen vía mensajes
    // sueltos en messaging-history.set sin estar en chats.set — los
    // recuperamos acá para no perderlos.
    const allJids = new Set([
        ...syncedChats.keys(),
        ...syncedMessages.keys(),
    ]);

    const chats = [...allJids].map(jid => {
        const meta = syncedChats.get(jid) || null;
        const msgs = syncedMessages.get(jid) || [];
        return {
            jid,
            name: (meta && meta.name) || syncedContacts.get(jid) || jid.replace('@s.whatsapp.net', ''),
            messages: msgs,
            chatMeta: meta,  // puede ser null si solo apareció vía mensajes
        };
    });

    // Conteos para reportar al usuario.
    const onlyChatsSet = [...syncedChats.keys()].filter(j => !syncedMessages.has(j)).length;
    const onlyMessages = [...syncedMessages.keys()].filter(j => !syncedChats.has(j)).length;
    const both = chats.length - onlyChatsSet - onlyMessages;
    logger.info(
        `Total chats únicos a procesar: ${chats.length}`
    );
    logger.info(
        `   Desglose: ${both} en ambas fuentes · ` +
        `${onlyChatsSet} solo chats.set · ${onlyMessages} solo en mensajes`
    );
    await db.updateExtractionRun(runId, { total_chats: chats.length, status: 'running' });

    let indexed = 0;
    let skippedCutoff = 0;
    let skippedExisting = 0;
    let empty = 0;

    for (let i = 0; i < chats.length; i++) {
        if (isShuttingDown) break;
        const chat = chats[i];
        try {
            const result = await extractor.indexChatMetadata(
                chat.jid, chat.name, chat.messages, runId,
                { cutoffIso: EXTRACTION_CUTOFF_DATE, chatMeta: chat.chatMeta }
            );
            if (!result) {
                empty++;
            } else if (result.skipped && result.reason === 'cutoff') {
                skippedCutoff++;
            } else if (result.inserted === false) {
                skippedExisting++;  // ya estaba en DB (de otro estado)
            } else {
                indexed++;
            }
        } catch (err) {
            logger.warn(`   ⚠️  ${chat.name}: ${err.message}`);
        } finally {
            // Liberar memoria — el modo index NO necesita los mensajes después.
            syncedMessages.delete(chat.jid);
            chat.messages = null;
        }

        if ((i + 1) % 200 === 0) {
            logger.info(
                `   📊 ${i + 1}/${chats.length} procesados · ` +
                `indexados=${indexed} skipCutoff=${skippedCutoff} ` +
                `skipExist=${skippedExisting} vacíos=${empty}`
            );
        }
    }

    syncedMessages.clear();

    // Asignar prioridades de extracción a los chats recién indexados.
    logger.info('🎯 Asignando extract_priority...');
    const assigned = await db.assignExtractPriorities();
    logger.info(`   ${assigned} chats con prioridad asignada.`);

    await db.updateExtractionRun(runId, {
        status: 'completed',
        extracted_chats: indexed,
        failed_chats: 0,
        finished_at: new Date().toISOString(),
    });

    logger.info('═══════════════════════════════════════════');
    logger.info(`✅ INDEX COMPLETADO:`);
    logger.info(`   Indexados nuevos:       ${indexed}`);
    logger.info(`   Saltados por cutoff:    ${skippedCutoff} (post ${EXTRACTION_CUTOFF_DATE})`);
    logger.info(`   Ya existían en DB:      ${skippedExisting}`);
    logger.info(`   Vacíos/sin timestamp:   ${empty}`);
    logger.info('');
    logger.info(`👉 Para ver el estado: docker compose run --rm extractor npm run preview`);
    logger.info(`👉 Para procesar lote: docker compose run --rm extractor npm run extract -- --batch=1000`);
    logger.info('═══════════════════════════════════════════');
}

// ─── MODO: EXTRACCIÓN ───────────────────────────────────────
async function runExtractMode(options = {}) {
    logger.info('🚀 MODO EXTRACCIÓN — Iniciando proceso...');

    const extractor = new Extractor(sock, db, CONFIG);
    const runId = await db.createExtractionRun();

    try {
        // Map del sync para acceso rápido por jid. Combinamos ambas
        // fuentes: chats descubiertos (chats.set) + mensajes recibidos
        // (messaging-history.set). Un chat puede estar en una pero no
        // en la otra — para EXTRACT necesitamos el chat conocido aunque
        // no haya mensajes en sync (vamos a pedirlos con fetchMessageHistory).
        const knownJids = new Set([
            ...syncedChats.keys(),
            ...syncedMessages.keys(),
        ]);
        const syncedByJid = new Map();
        for (const jid of knownJids) {
            const meta = syncedChats.get(jid);
            syncedByJid.set(jid, {
                jid,
                name: (meta && meta.name) || syncedContacts.get(jid) || jid.replace('@s.whatsapp.net', ''),
                messages: syncedMessages.get(jid) || [],
            });
        }

        let targetChats = [];

        // ─── MODO BATCH: usar el snapshot indexado de DB ──────
        // Toma los próximos N chats con extract_priority menor (más
        // recientes). NO depende del orden del sync — es determinístico
        // entre reescaneos del QR.
        if (options.batch && options.batch > 0) {
            // Filtro de fecha opcional: --before=YYYY-MM-DD limita el lote
            // a chats con last_message_at <= ese día (hora Bogotá inclusive).
            // Internamente convertimos a 21-DD 05:00 UTC = fin del día Bogotá.
            let beforeIso = null;
            if (options.before) {
                const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.before.trim());
                if (!m) {
                    throw new Error(`--before inválido: '${options.before}' (esperado YYYY-MM-DD)`);
                }
                const [, y, mo, d] = m;
                // Día siguiente 00:00 -05:00 = fin inclusivo del día Bogotá.
                const next = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + 1, 5, 0, 0));
                beforeIso = next.toISOString();
                logger.info(
                    `⚙️  --before=${options.before}: solo chats con last_message_at ` +
                    `<= ${options.before} 23:59:59 hora Bogotá`
                );
            }

            const queue = await db.getNextExtractBatch(options.batch, beforeIso);
            if (queue.length === 0) {
                if (beforeIso) {
                    const totalBefore = await db.countIndexadoBefore(beforeIso);
                    logger.warn(
                        `⚠️  No hay chats indexados con last_message_at <= ${options.before}. ` +
                        `Total indexados que cumplen el filtro: ${totalBefore}.`
                    );
                } else {
                    logger.warn('⚠️  No hay chats indexados pendientes. Corré `npm run index` primero.');
                }
                await db.updateExtractionRun(runId, {
                    status: 'completed', total_chats: 0, finished_at: new Date().toISOString(),
                });
                return;
            }
            logger.info(`⚙️  --batch=${options.batch}: tomando próximos ${queue.length} chats indexados`);
            logger.info(
                `   Rango de prioridad: #${queue[0].extract_priority} → ` +
                `#${queue[queue.length-1].extract_priority}`
            );
            // Mostrar rango de fechas para feedback al operador.
            const fechas = queue
                .map(r => r.last_message_at)
                .filter(Boolean)
                .sort();
            if (fechas.length > 0) {
                logger.info(
                    `   Rango de fechas: ${fechas[0]} → ${fechas[fechas.length-1]}`
                );
            }
            let skippedNoSync = 0;
            let skippedNoMsgs = 0;
            for (const row of queue) {
                const fromSync = syncedByJid.get(row.chat_id);
                if (!fromSync) {
                    // El chat está indexado en DB pero WhatsApp NO lo
                    // mencionó en este sync (ni siquiera en chats.set).
                    // Imposible procesar — queda pendiente para próximo
                    // reescaneo donde WhatsApp tal vez lo incluya.
                    skippedNoSync++;
                    continue;
                }
                if (!fromSync.messages || fromSync.messages.length === 0) {
                    // El chat aparece en chats.set pero WhatsApp no entregó
                    // mensajes. fetchMessageHistory requiere un mensaje
                    // ancla para paginar hacia atrás, así que sin mensajes
                    // iniciales no hay manera de descargarlos. Queda pendiente.
                    skippedNoMsgs++;
                    continue;
                }
                targetChats.push(fromSync);
            }
            if (skippedNoSync > 0 || skippedNoMsgs > 0) {
                logger.warn(
                    `   ⚠️  Saltados ${skippedNoSync + skippedNoMsgs} chats: ` +
                    `${skippedNoSync} no en sync actual · ${skippedNoMsgs} sin mensajes en sync. ` +
                    `Quedan 'indexado' para próximos reescaneos.`
                );
            }
        }
        // ─── MODO LEGACY: usar el sync directo + filtros viejos ──
        else if (options.phone) {
            const phone = String(options.phone).replace(/[^0-9]/g, '');
            const match = [...syncedByJid.values()].find(c =>
                c.jid.replace('@s.whatsapp.net', '') === phone
            );
            if (!match) {
                throw new Error(`No se encontró chat para el número ${phone}.`);
            }
            logger.info(`⚙️  --phone=${phone}: extrayendo solo ${match.name}`);
            targetChats = [match];
        } else {
            // Fallback legacy: todos los chats del sync (desordenados).
            // Mejor usar --batch para flujo nuevo.
            logger.warn('⚠️  Sin --batch ni --phone: procesando TODOS los chats del sync (modo legacy).');
            logger.warn('   Recomendado: usar `npm run index` + `npm run extract -- --batch=N`');
            targetChats = [...syncedByJid.values()];
            if (options.limit && options.limit > 0 && options.limit < targetChats.length) {
                logger.info(`⚙️  --limit=${options.limit}: solo los primeros ${options.limit} chats`);
                targetChats = targetChats.slice(0, options.limit);
            }
        }

        // Liberar memoria de chats que NO van a procesarse en este lote.
        const targetJids = new Set(targetChats.map(c => c.jid));
        for (const jid of [...syncedMessages.keys()]) {
            if (!targetJids.has(jid)) {
                syncedMessages.delete(jid);
            }
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
        const runStartedAt = Date.now();
        // Contador de chats EFECTIVAMENTE procesados (excluye los que
        // se saltaron por checkpoint) para calcular ETA correcto.
        let processed = 0;

        for (let i = 0; i < targetChats.length; i++) {
            if (isShuttingDown) {
                logger.warn('⚠️  Shutdown solicitado. Guardando progreso...');
                break;
            }

            const chat = targetChats[i];
            const progress = `[${i + 1}/${targetChats.length}]`;

            if (alreadyExtracted.has(chat.jid)) {
                // Log silencioso cuando hay muchos skipped. Solo cada 100.
                if (i % 100 === 0) {
                    logger.info(`${progress} ⏭️  Saltando chats ya extraídos (checkpoint)...`);
                }
                continue;
            }

            try {
                logger.info(`${progress} Extrayendo: ${chat.name} (${chat.messages.length} msgs sincronizados)`);

                await requestMoreHistory(sock, chat.jid, chat.messages);

                const allMessages = syncedMessages.get(chat.jid) || chat.messages;

                await extractor.extractChat(chat.jid, chat.name, allMessages, runId);
                successCount++;
                processed++;

                // Progreso con ETA cada 25 chats. Útil cuando la corrida dura horas.
                if (processed % 25 === 0) {
                    const elapsedSec = (Date.now() - runStartedAt) / 1000;
                    const avgSecPerChat = elapsedSec / processed;
                    const remaining = targetChats.length - (i + 1);
                    const etaSec = remaining * avgSecPerChat;
                    const pct = ((i + 1) / targetChats.length) * 100;
                    logger.info(
                        `📊 Progreso: ${successCount} ok · ${failCount} fallidos · ` +
                        `${pct.toFixed(1)}% · ETA ${formatETA(etaSec)}`
                    );
                }

                // Publicar stats al dashboard (cada chat — el costo es trivial).
                statusPub.publishStats({
                    ok: successCount,
                    fallidos: failCount,
                    procesados: processed,
                    total: targetChats.length,
                    actual: chat.name,
                    porcentaje: ((i + 1) / targetChats.length) * 100,
                    eta_seg: processed > 0
                        ? Math.round(((targetChats.length - (i + 1)) * (Date.now() - runStartedAt) / 1000) / processed)
                        : null,
                }).catch(() => {});
                statusPub.heartbeat().catch(() => {});

                // Persistir progreso en DB cada 100 chats procesados para
                // que Óscar pueda consultar % desde otra terminal sin
                // interrumpir la corrida.
                if (processed % 100 === 0) {
                    try {
                        await db.updateExtractionRun(runId, {
                            extracted_chats: successCount,
                            failed_chats: failCount,
                        });
                    } catch (_) { /* no bloquear por errores de write */ }
                }

                // Rate limit entre chats (NO bajar — protege el número de ban).
                const delay = randomBetween(CONFIG.extractionDelayMin, CONFIG.extractionDelayMax);
                await sleep(delay);

            } catch (error) {
                failCount++;
                processed++;
                logger.error(`${progress} ❌ Error: ${chat.name}: ${error.message}`);
                await db.markConversationFailed(chat.jid, error.message);

                if (failCount > 10 && failCount / (successCount + failCount) > 0.5) {
                    logger.error('⚠️  Demasiados errores. Pausando 60s...');
                    await sleep(60000);
                }
            } finally {
                // Liberar memoria: con 6000 chats y miles de msgs cada uno,
                // mantener syncedMessages completo es GB. Cada chat ya se
                // persistió a DB; no necesitamos sus mensajes.
                syncedMessages.delete(chat.jid);
                chat.messages = null;
            }
        }

        // Al terminar el loop, liberar lo que quedó de estructuras auxiliares.
        syncedMessages.clear();

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
    };

    const runShutdown = async (signal, exitCode = 0) => {
        await shutdown(signal);
        process.exit(exitCode);
    };

    process.on('SIGINT', () => runShutdown('SIGINT', 0));
    process.on('SIGTERM', () => runShutdown('SIGTERM', 0));
    process.on('uncaughtException', async (error) => {
        logger.error(`Excepción no capturada: ${error.message}`);
        logger.error(error.stack);
        // Exit code 1 — los supervisores (systemd/docker) deben detectar
        // el fallo. Antes salía con 0 y ocultaba errores reales.
        await runShutdown('uncaughtException', 1);
    });
    process.on('unhandledRejection', async (reason) => {
        const msg = reason instanceof Error
            ? `${reason.message}\n${reason.stack}`
            : String(reason);
        logger.error(`Promise rechazada sin manejar: ${msg}`);
        await runShutdown('unhandledRejection', 1);
    });
}

// ─── MAIN ───────────────────────────────────────────────────
async function main() {
    setupGracefulShutdown();

    const args = parseArgs();
    const mode = args.mode || 'extract';
    const limit = args.limit ? parseInt(args.limit, 10) : null;
    const batch = args.batch ? parseInt(args.batch, 10) : null;
    const before = args.before ? String(args.before).trim() : null;
    const phone = args.phone ? String(args.phone).replace(/[^0-9]/g, '') : null;
    const skipMedia = !!args['skip-media'] || !!args.skipMedia;
    const force = !!args.force;

    if (before && !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
        logger.error(`Valor inválido para --before: ${before} (esperado YYYY-MM-DD)`);
        process.exit(1);
    }

    if (args.limit && (!Number.isFinite(limit) || limit <= 0)) {
        logger.error(`Valor inválido para --limit: ${args.limit}`);
        process.exit(1);
    }
    if (args.batch && (!Number.isFinite(batch) || batch <= 0)) {
        logger.error(`Valor inválido para --batch: ${args.batch}`);
        process.exit(1);
    }

    // Propagar skipMedia al CONFIG para que Extractor lo lea
    CONFIG.skipMedia = skipMedia;

    logger.info('══════════════════════════════════════════════');
    logger.info('  WHATSAPP AUDIT SYSTEM — EXTRACTOR (Baileys)');
    logger.info(`  Modo: ${mode.toUpperCase()}`);
    if (mode === 'index') logger.info(`  Cutoff: ${EXTRACTION_CUTOFF_DATE} (chats con last_message_at posterior se IGNORAN)`);
    if (batch) logger.info(`  Batch: próximos ${batch} chats indexados (por extract_priority ASC)`);
    if (limit) logger.info(`  Límite: ${limit} chats`);
    if (phone) logger.info(`  Teléfono: ${phone}`);
    if (skipMedia) logger.info(`  --skip-media activo: solo textos, sin descargar audios/imágenes`);
    if (force) logger.info(`  --force activo: ignora checkpoint y borra registros previos del chat`);
    logger.info('══════════════════════════════════════════════');

    // Conectar a BD
    db = new Database();
    await db.connect();
    logger.info('✅ Conectado a PostgreSQL');

    // Modos que NO necesitan WhatsApp (solo leen DB):
    if (mode === 'stats') {
        await runStatsMode();
        await db.close();
        return;
    }
    if (mode === 'preview') {
        await runPreviewMode();
        await db.close();
        return;
    }
    if (mode === 'daemon') {
        // El daemon levanta su propio socket por job — NO conecta acá.
        await db.close();
        return mainDaemon();
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
        case 'index':
            await runIndexMode();
            break;
        case 'extract':
            await runExtractMode({ limit, batch, before, phone, force });
            break;
        default:
            logger.error(`Modo desconocido: ${mode}`);
    }
}

// ─── MAIN para el caso DAEMON (no necesita socket previo) ────
async function mainDaemon() {
    setupGracefulShutdown();
    logger.info('══════════════════════════════════════════════');
    logger.info('  WHATSAPP AUDIT SYSTEM — EXTRACTOR DAEMON (Baileys)');
    logger.info('══════════════════════════════════════════════');
    db = new Database();
    await db.connect();
    logger.info('✅ Conectado a PostgreSQL');
    await runDaemonMode();
    await db.close();

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
