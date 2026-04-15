// ══════════════════════════════════════════════════════════════
// WHATSAPP EXTRACTOR — PUNTO DE ENTRADA
// ══════════════════════════════════════════════════════════════

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createLogger } = require('./logger');
const { Database } = require('./database');
const { Extractor } = require('./extractor');
const { sleep, parseArgs } = require('./utils');

const logger = createLogger('main');

// ─── CONFIGURACIÓN ──────────────────────────────────────────
const CONFIG = {
    extractionDelayMin: parseInt(process.env.EXTRACTION_DELAY_MIN || '2000'),
    extractionDelayMax: parseInt(process.env.EXTRACTION_DELAY_MAX || '4000'),
    mediaDelayMin: parseInt(process.env.MEDIA_DELAY_MIN || '3000'),
    mediaDelayMax: parseInt(process.env.MEDIA_DELAY_MAX || '6000'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    dataDir: process.env.DATA_DIR || './data',
    logLevel: process.env.LOG_LEVEL || 'info',
};

// ─── ESTADO GLOBAL ──────────────────────────────────────────
let client = null;
let db = null;
let isShuttingDown = false;

// ─── INICIALIZAR CLIENTE DE WHATSAPP ────────────────────────
function createWhatsAppClient() {
    const client = new Client({
        authStrategy: new LocalAuth({
            dataPath: '/app/.wwebjs_auth'
        }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            protocolTimeout: 600000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--single-process',
                '--disable-extensions',
            ],
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/nicollaseng/nicollaseng/master/nicollaseng_web_v2.2414.7.json',
        },
    });

    // ─── EVENTOS DEL CLIENTE ────────────────────────────────
    client.on('qr', (qr) => {
        logger.info('═══════════════════════════════════════════');
        logger.info('ESCANEA ESTE CÓDIGO QR CON TU WHATSAPP:');
        logger.info('═══════════════════════════════════════════');
        qrcode.generate(qr, { small: true });
        logger.info('Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo');
        logger.info('═══════════════════════════════════════════');
    });

    client.on('authenticated', () => {
        logger.info('✅ Autenticación exitosa — sesión guardada');
    });

    client.on('auth_failure', (msg) => {
        logger.error(`❌ Error de autenticación: ${msg}`);
        logger.info('Eliminando sesión guardada para reintentar...');
    });

    client.on('ready', () => {
        logger.info('═══════════════════════════════════════════');
        logger.info('✅ WHATSAPP CONECTADO Y LISTO');
        logger.info('═══════════════════════════════════════════');
    });

    client.on('disconnected', (reason) => {
        logger.warn(`⚠️  WhatsApp desconectado: ${reason}`);
        logger.info('El sistema guardó checkpoint. Reconecta escaneando QR nuevamente.');
    });

    client.on('change_state', (state) => {
        logger.info(`Estado de conexión: ${state}`);
    });

    return client;
}

// ─── OBTENER CHATS CON REINTENTOS ───────────────────────────
// WhatsApp Web necesita tiempo para sincronizar después de `ready`;
// getChats() puede fallar con "Execution context was destroyed" o
// "Runtime.callFunctionOn timed out" si se llama demasiado pronto.
async function getChatsWithRetry(client, { attempts = 5, initialDelayMs = 5000 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            logger.info(`Obteniendo chats (intento ${attempt}/${attempts})...`);
            const chats = await client.getChats();
            logger.info(`✅ getChats() exitoso: ${chats.length} chats`);
            return chats;
        } catch (error) {
            lastError = error;
            logger.warn(`⚠️  getChats() falló (intento ${attempt}/${attempts}): ${error.message}`);
            if (attempt < attempts) {
                const backoff = initialDelayMs * Math.pow(2, attempt - 1);
                logger.info(`   Reintentando en ${Math.round(backoff / 1000)}s...`);
                await sleep(backoff);
            }
        }
    }
    throw new Error(`getChats() falló tras ${attempts} intentos: ${lastError?.message}`);
}

// Espera a que WhatsApp Web termine de sincronizar tras el evento `ready`.
async function waitForSync(client, syncMs = 30000) {
    logger.info(`Esperando ${Math.round(syncMs / 1000)}s para que WhatsApp Web termine de sincronizar...`);
    await sleep(syncMs);
}

// ─── MODO: TEST DE CONEXIÓN ─────────────────────────────────
async function runTestMode(client) {
    logger.info('🔍 MODO TEST — Verificando conexión...');

    const chats = await getChatsWithRetry(client);
    const contacts = await client.getContacts();
    
    const individualChats = chats.filter(c => !c.isGroup);
    const groupChats = chats.filter(c => c.isGroup);
    
    logger.info('═══════════════════════════════════════════');
    logger.info('📊 RESUMEN DE TU WHATSAPP:');
    logger.info(`   Chats individuales: ${individualChats.length}`);
    logger.info(`   Grupos: ${groupChats.length}`);
    logger.info(`   Contactos: ${contacts.length}`);
    logger.info('═══════════════════════════════════════════');
    
    // Mostrar los primeros 5 chats como muestra
    logger.info('📋 Primeros 5 chats (muestra):');
    for (const chat of individualChats.slice(0, 5)) {
        const lastMsg = chat.lastMessage;
        logger.info(`   📱 ${chat.name || 'Sin nombre'} | Mensajes: ~${chat.unreadCount || '?'} sin leer | Último: ${lastMsg?.timestamp ? new Date(lastMsg.timestamp * 1000).toLocaleDateString() : 'N/A'}`);
    }
    
    logger.info('');
    logger.info('✅ Conexión verificada. Todo funciona correctamente.');
    logger.info('   Para extraer, ejecuta: npm run extract');
}

// ─── MODO: ESTADÍSTICAS ─────────────────────────────────────
async function runStatsMode(db) {
    logger.info('📊 MODO STATS — Consultando base de datos...');
    
    const stats = await db.getExtractionStats();
    
    logger.info('═══════════════════════════════════════════');
    logger.info('📊 ESTADÍSTICAS DE EXTRACCIÓN:');
    logger.info(`   Total conversaciones: ${stats.total}`);
    logger.info(`   Extraídas: ${stats.extracted}`);
    logger.info(`   Pendientes: ${stats.pending}`);
    logger.info(`   Fallidas: ${stats.failed}`);
    logger.info(`   Total mensajes: ${stats.totalMessages}`);
    logger.info(`   Total audios: ${stats.totalAudios}`);
    logger.info('═══════════════════════════════════════════');
}

// ─── MODO: EXTRACCIÓN COMPLETA ──────────────────────────────
async function runExtractMode(client, db) {
    logger.info('🚀 MODO EXTRACCIÓN — Iniciando proceso completo...');
    
    const extractor = new Extractor(client, db, CONFIG);
    
    // Registrar la corrida en la BD
    const runId = await db.createExtractionRun();
    
    try {
        // Obtener todos los chats individuales (no grupos)
        const allChats = await getChatsWithRetry(client);
        const chats = allChats.filter(c => !c.isGroup);
        
        logger.info(`Total de chats individuales encontrados: ${chats.length}`);
        
        await db.updateExtractionRun(runId, { total_chats: chats.length, status: 'running' });
        
        // Verificar checkpoint — ¿hay chats ya extraídos?
        const alreadyExtracted = await db.getExtractedChatIds();
        const pendingChats = chats.filter(c => !alreadyExtracted.has(c.id._serialized));
        
        if (alreadyExtracted.size > 0) {
            logger.info(`⏩ Checkpoint encontrado: ${alreadyExtracted.size} chats ya extraídos`);
            logger.info(`   Faltan por extraer: ${pendingChats.length}`);
        }
        
        // Extraer cada chat
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < pendingChats.length; i++) {
            if (isShuttingDown) {
                logger.warn('⚠️  Shutdown solicitado. Guardando progreso...');
                break;
            }
            
            const chat = pendingChats[i];
            const progress = `[${i + 1 + alreadyExtracted.size}/${chats.length}]`;
            
            try {
                logger.info(`${progress} Extrayendo: ${chat.name || chat.id._serialized}`);
                
                await extractor.extractChat(chat, runId);
                successCount++;
                
                // Log de progreso cada 50 chats
                if ((successCount + failCount) % 50 === 0) {
                    logger.info(`📊 Progreso: ${successCount} exitosos, ${failCount} fallidos de ${pendingChats.length} pendientes`);
                }
                
                // Delay entre chats (anti rate-limit)
                const delay = randomBetween(CONFIG.extractionDelayMin, CONFIG.extractionDelayMax);
                await sleep(delay);
                
            } catch (error) {
                failCount++;
                logger.error(`${progress} ❌ Error extrayendo ${chat.name || chat.id._serialized}: ${error.message}`);
                
                await db.markConversationFailed(chat.id._serialized, error.message);
                
                // Si hay muchos errores seguidos, pausar
                if (failCount > 10 && failCount / (successCount + failCount) > 0.5) {
                    logger.error('⚠️  Demasiados errores. Pausando 60 segundos...');
                    await sleep(60000);
                }
            }
        }
        
        // Actualizar corrida
        await db.updateExtractionRun(runId, {
            status: isShuttingDown ? 'paused' : 'completed',
            extracted_chats: successCount + alreadyExtracted.size,
            failed_chats: failCount,
            finished_at: new Date().toISOString(),
        });
        
        logger.info('═══════════════════════════════════════════');
        logger.info('✅ EXTRACCIÓN COMPLETADA');
        logger.info(`   Exitosos: ${successCount}`);
        logger.info(`   Fallidos: ${failCount}`);
        logger.info(`   Ya extraídos (checkpoint): ${alreadyExtracted.size}`);
        logger.info(`   Total en BD: ${successCount + alreadyExtracted.size}`);
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

// ─── MANEJO DE SHUTDOWN GRACEFUL ────────────────────────────
function setupGracefulShutdown() {
    const shutdown = async (signal) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        
        logger.info(`\n⏹️  Señal ${signal} recibida. Cerrando limpiamente...`);
        logger.info('Guardando checkpoint de extracción...');
        
        try {
            if (client) {
                logger.info('Cerrando sesión de WhatsApp...');
                await client.destroy();
            }
            if (db) {
                logger.info('Cerrando conexión a base de datos...');
                await db.close();
            }
        } catch (error) {
            logger.error(`Error durante shutdown: ${error.message}`);
        }
        
        logger.info('✅ Shutdown limpio completado. Nada se perdió.');
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
    
    logger.info('══════════════════════════════════════════════');
    logger.info('  WHATSAPP AUDIT SYSTEM — EXTRACTOR');
    logger.info(`  Modo: ${mode.toUpperCase()}`);
    logger.info('══════════════════════════════════════════════');
    
    // Conectar a base de datos
    db = new Database();
    await db.connect();
    logger.info('✅ Conectado a PostgreSQL');
    
    // Solo stats no necesita WhatsApp
    if (mode === 'stats') {
        await runStatsMode(db);
        await db.close();
        return;
    }
    
    // Inicializar cliente WhatsApp
    logger.info('Iniciando cliente de WhatsApp...');
    logger.info('(Esto puede tomar 30-60 segundos la primera vez)');
    
    client = createWhatsAppClient();
    
    // Esperar a que esté listo
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout esperando conexión de WhatsApp (5 minutos)'));
        }, 300000); // 5 minutos de timeout
        
        client.on('ready', () => {
            clearTimeout(timeout);
            resolve();
        });
        
        client.on('auth_failure', (msg) => {
            clearTimeout(timeout);
            reject(new Error(`Auth failure: ${msg}`));
        });
        
        client.initialize().catch(reject);
    });

    // WhatsApp Web sigue sincronizando después de `ready`. Darle tiempo
    // antes de llamar getChats() para evitar "Execution context was destroyed".
    await waitForSync(client, parseInt(process.env.POST_READY_SYNC_MS || '30000'));

    // Ejecutar según el modo
    switch (mode) {
        case 'test':
            await runTestMode(client);
            break;
        case 'extract':
            await runExtractMode(client, db);
            break;
        default:
            logger.error(`Modo desconocido: ${mode}`);
    }
    
    // Cleanup
    logger.info('Cerrando conexiones...');
    await client.destroy();
    await db.close();
    logger.info('✅ Todo cerrado limpiamente.');
}

main().catch((error) => {
    logger.error(`Error fatal: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
});
