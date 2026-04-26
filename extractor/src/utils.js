// ══════════════════════════════════════════════════════════════
// Utilidades
// ══════════════════════════════════════════════════════════════

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFilename(str) {
    return str.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200);
}

// Valida y normaliza un número telefónico de WhatsApp.
// Devuelve null cuando el input no parece un teléfono real:
//   - JIDs con sufijos no-teléfono (@lid, @g.us, @broadcast, @newsletter, etc.)
//     que producirían "teléfonos" basura tipo +239758043279515 (15+ dígitos).
//   - Strings vacíos o solo símbolos.
//   - Longitudes fuera del rango E.164 (mínimo 8, máximo 15 dígitos sin +).
// Para Colombia un número típico es 57 + 10 dígitos = 12. Latinoamérica casi
// siempre cae entre 10 y 13. WhatsApp LIDs son ≥ 18 dígitos.
function formatPhone(phone) {
    if (!phone) return null;
    const raw = String(phone).trim();
    if (!raw) return null;
    // Si llegó un JID con sufijo distinto a s.whatsapp.net, NO es teléfono.
    // Estos identificadores (LID, grupos, broadcasts, comunidades) tienen
    // formato numérico pero no se pueden contactar como teléfonos.
    if (/@(lid|g\.us|broadcast|newsletter)$/i.test(raw)) return null;
    let clean = raw.replace(/[^0-9+]/g, '');
    if (!clean) return null;
    // Quitar todos los '+' menos el primero (pueden venir mezclados).
    const hasPlus = clean.startsWith('+');
    const digits = clean.replace(/\+/g, '');
    if (digits.length < 8 || digits.length > 15) return null;
    return (hasPlus || digits.length > 10) ? '+' + digits : digits;
}

function parseArgs() {
    const args = {};
    process.argv.slice(2).forEach(arg => {
        if (arg.startsWith('--')) {
            const [key, value] = arg.substring(2).split('=');
            args[key] = value || true;
        }
    });
    return args;
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { sleep, sanitizeFilename, formatPhone, parseArgs, randomBetween };
