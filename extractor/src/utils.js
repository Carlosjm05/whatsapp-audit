// ══════════════════════════════════════════════════════════════
// Utilidades
// ══════════════════════════════════════════════════════════════

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFilename(str) {
    return str.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 200);
}

function formatPhone(phone) {
    if (!phone) return null;
    let clean = phone.replace(/[^0-9+]/g, '');
    if (!clean.startsWith('+') && clean.length > 10) {
        clean = '+' + clean;
    }
    return clean;
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
