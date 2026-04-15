// ══════════════════════════════════════════════════════════════
// LOGGER — Logging estructurado con timestamps
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] || LOG_LEVELS.INFO;

function createLogger(moduleName) {
    const logDir = path.join(process.env.DATA_DIR || './data', '..', 'logs');
    if (!fs.existsSync(logDir)) {
        try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
    }

    const logFile = path.join(logDir, `${moduleName}.log`);

    function formatMessage(level, message) {
        const now = new Date().toISOString();
        return `[${now}] [${level.padEnd(5)}] [${moduleName}] ${message}`;
    }

    function writeLog(level, message) {
        if (LOG_LEVELS[level] < currentLevel) return;

        const formatted = formatMessage(level, message);
        
        // Console
        const colorMap = {
            DEBUG: '\x1b[90m',
            INFO:  '\x1b[36m',
            WARN:  '\x1b[33m',
            ERROR: '\x1b[31m',
        };
        const reset = '\x1b[0m';
        console.log(`${colorMap[level] || ''}${formatted}${reset}`);

        // File
        try {
            fs.appendFileSync(logFile, formatted + '\n');
        } catch {}
    }

    return {
        debug: (msg) => writeLog('DEBUG', msg),
        info:  (msg) => writeLog('INFO', msg),
        warn:  (msg) => writeLog('WARN', msg),
        error: (msg) => writeLog('ERROR', msg),
    };
}

module.exports = { createLogger };
