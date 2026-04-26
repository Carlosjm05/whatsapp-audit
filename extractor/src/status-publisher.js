// ══════════════════════════════════════════════════════════════
// STATUS PUBLISHER — publica QR y estado del extractor a Redis
// para que el dashboard pueda mostrarlos en /conexion sin tener
// que mirar logs de terminal.
//
// Claves usadas en Redis (todas con TTL para que se auto-limpien):
//   wa:qr        → data URL PNG del QR vigente (TTL 60s, refrescado por Baileys)
//   wa:qr_ts     → timestamp ISO del último QR emitido (TTL 60s)
//   wa:status    → 'connecting' | 'qr_ready' | 'connected' | 'disconnected' | 'reconnecting'
//                  (TTL 5min, se refresca con cada heartbeat)
//   wa:status_ts → ISO del último cambio de status (sin TTL — persiste)
//   wa:last_activity → ISO de la última operación visible (sync/extract/media) (TTL 1h)
//   wa:stats     → JSON {chats_synced, msgs_synced, current_chat, percent} (TTL 5min)
// ══════════════════════════════════════════════════════════════

const Redis = require('ioredis');
const QRCode = require('qrcode');

let client = null;

function getClient() {
    if (client) return client;
    const host = process.env.REDIS_HOST || 'redis';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    client = new Redis({
        host,
        port,
        password,
        // En boot del extractor, redis puede no estar listo. Reintenta sin
        // bloquear el flujo principal.
        retryStrategy: (times) => Math.min(times * 200, 2000),
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
    });
    client.on('error', (err) => {
        // No spammear logs si redis está caído. Solo el primer error.
        if (!client._loggedError) {
            console.warn(`[status-publisher] redis error (silenciando posteriores): ${err.message}`);
            client._loggedError = true;
        }
    });
    return client;
}

// Wrap silencioso: si redis falla, NO rompe el extractor.
async function safeSet(key, value, ttlSec) {
    try {
        const c = getClient();
        if (ttlSec) await c.set(key, value, 'EX', ttlSec);
        else await c.set(key, value);
    } catch (_) { /* silent */ }
}

async function safeDel(...keys) {
    try {
        const c = getClient();
        await c.del(...keys);
    } catch (_) { /* silent */ }
}

// ─── PUBLICAR QR ────────────────────────────────────────────
// Convierte el string del QR de Baileys a PNG data URL y lo guarda.
// Marcamos status='qr_ready' para que el dashboard ofrezca escanear.
async function publishQR(qrString) {
    try {
        const dataUrl = await QRCode.toDataURL(qrString, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 8,           // ~ 296px, suficiente para escanear desde pantalla
            color: { dark: '#000', light: '#fff' },
        });
        const now = new Date().toISOString();
        await Promise.all([
            safeSet('wa:qr', dataUrl, 60),
            safeSet('wa:qr_ts', now, 60),
            setStatus('qr_ready'),
        ]);
    } catch (err) {
        console.warn('[status-publisher] no se pudo generar PNG del QR:', err.message);
    }
}

// ─── PUBLICAR STATUS ────────────────────────────────────────
async function setStatus(status) {
    const now = new Date().toISOString();
    await Promise.all([
        safeSet('wa:status', status, 300),       // 5 min, refrescado por heartbeat
        safeSet('wa:status_ts', now),             // sin TTL: queda como "última vez visto"
    ]);
    if (status === 'connected') {
        // Borramos el QR — ya no aplica.
        await safeDel('wa:qr', 'wa:qr_ts');
    }
}

// ─── HEARTBEAT (llamar periódicamente cuando estamos conectados) ───
async function heartbeat() {
    await safeSet('wa:status', 'connected', 300);
    await safeSet('wa:last_activity', new Date().toISOString(), 3600);
}

// ─── ACTUALIZAR ESTADÍSTICAS DE EXTRACCIÓN ─────────────────
// Llamar cada vez que se procesa un chat para que el dashboard muestre
// progreso en tiempo real. Stats es un dict simple (lo serializamos).
async function publishStats(stats) {
    try {
        await safeSet('wa:stats', JSON.stringify(stats), 300);
        await safeSet('wa:last_activity', new Date().toISOString(), 3600);
    } catch (_) { /* silent */ }
}

// ─── INVALIDAR TOKEN PÚBLICO TRAS ESCANEO ───────────────────
// La API expone /api/qr/public/<token> y al detectar conexión exitosa
// le pegamos un flag para que el endpoint público devuelva "ya escaneado".
async function notifyConnected() {
    const now = new Date().toISOString();
    await safeSet('wa:connected_at', now, 86400);  // 24h
}

// ─── DAEMON: COLA DE JOBS ───────────────────────────────────
// El dashboard publica jobs en la lista `wa:jobs` (LPUSH).
// El extractor en modo daemon hace BRPOP de esa lista.
//
// Formato del job (JSON string):
//   { id: "uuid", action: "index"|"extract"|"preview", batch?: int, requested_by: string, requested_at: ISO }
//
// Estado del job actualmente en proceso (para que el dashboard lo lea):
//   wa:job:current → JSON {id, action, status, started_at, progress?, last_log?}
//   wa:job:history → lista de últimos 20 jobs ejecutados (LPUSH + LTRIM)
const JOBS_QUEUE_KEY = 'wa:jobs';
const CURRENT_JOB_KEY = 'wa:job:current';
const JOB_HISTORY_KEY = 'wa:job:history';

async function popJob(timeoutSec = 5) {
    try {
        const c = getClient();
        // BRPOP devuelve [key, value] o null si timeout.
        const result = await c.brpop(JOBS_QUEUE_KEY, timeoutSec);
        if (!result || !result[1]) return null;
        try { return JSON.parse(result[1]); }
        catch (_) { return null; }
    } catch (_) {
        // Si Redis está caído, dormimos para no quemar CPU en busy-loop.
        // Sleep equivalente al timeout normal de BRPOP (~5s).
        await new Promise(r => setTimeout(r, Math.max(2000, timeoutSec * 1000)));
        return null;
    }
}

// Publica un heartbeat de daemon idle: el dashboard lee `wa:status` y si
// no se refresca dentro del TTL (5min) pinta "extractor caído". El daemon
// debe llamar esto en cada iteración del loop, esté procesando o esperando.
async function daemonHeartbeat() {
    await safeSet('wa:status', 'daemon_idle', 300);
    await safeSet('wa:last_activity', new Date().toISOString(), 3600);
}

// Limpia un job huérfano (estaba 'running' cuando el daemon murió).
// Se llama al arrancar el daemon para no bloquear el endpoint POST /jobs.
async function clearOrphanCurrentJob() {
    try {
        const c = getClient();
        const raw = await c.get(CURRENT_JOB_KEY);
        if (!raw) return null;
        try {
            const job = JSON.parse(raw);
            if (job && job.status === 'running') {
                await c.del(CURRENT_JOB_KEY);
                // Lo movemos al historial como huérfano para que quede traza.
                const orphan = { ...job, status: 'failed', error: 'daemon reiniciado (job huérfano)', finished_at: new Date().toISOString() };
                await c.lpush(JOB_HISTORY_KEY, JSON.stringify(orphan));
                await c.ltrim(JOB_HISTORY_KEY, 0, 19);
                return orphan;
            }
        } catch (_) {
            // raw no parseable → borrar a secas.
            await c.del(CURRENT_JOB_KEY);
        }
        return null;
    } catch (_) {
        return null;
    }
}

async function setCurrentJob(job) {
    if (!job) {
        await safeDel(CURRENT_JOB_KEY);
        return;
    }
    await safeSet(CURRENT_JOB_KEY, JSON.stringify(job), 7200); // 2h
}

async function pushJobHistory(jobResult) {
    try {
        const c = getClient();
        await c.lpush(JOB_HISTORY_KEY, JSON.stringify(jobResult));
        await c.ltrim(JOB_HISTORY_KEY, 0, 19);  // mantener últimos 20
    } catch (_) { /* silent */ }
}

// ─── CLEANUP ────────────────────────────────────────────────
async function disconnect() {
    if (client) {
        try { await client.quit(); } catch (_) {}
        client = null;
    }
}

module.exports = {
    publishQR,
    setStatus,
    heartbeat,
    publishStats,
    notifyConnected,
    popJob,
    setCurrentJob,
    pushJobHistory,
    daemonHeartbeat,
    clearOrphanCurrentJob,
    disconnect,
};
