# WhatsApp Audit System — Ortiz Finca Raíz

## Estado del Proyecto
Este proyecto fue diseñado y parcialmente implementado en Claude.ai. 
Debe continuarse en **Claude Code** para completar, probar y desplegar.

## Qué está listo ✅
- `docker-compose.yml` — 8 servicios containerizados con health checks
- `.env.example` — Todas las variables de entorno documentadas
- `setup.sh` — Script de configuración del servidor (Ubuntu 24.04)
- `db/schema.sql` — Esquema completo de PostgreSQL (20+ tablas)
- `db/indexes.sql` — Índices de rendimiento
- `extractor/` — Extractor de WhatsApp (Node.js + whatsapp-web.js)
  - `src/index.js` — Punto de entrada con QR, modos test/extract/stats
  - `src/extractor.js` — Lógica de extracción por chat con media download
  - `src/database.js` — Módulo de PostgreSQL con checkpoints
  - `src/logger.js` — Logging estructurado
  - `src/utils.js` — Utilidades
  - `Dockerfile` + `package.json`
- `transcriber/` — Pipeline de transcripción (Python + Whisper API)
  - `src/main.py` — Workers paralelos, transcripción, unificación de transcripts
  - `Dockerfile` + `requirements.txt`
- `analyzer/` — Estructura base (Dockerfile + requirements)

## Qué falta por construir 🔧
1. **analyzer/src/prompt.py** — Prompt de Claude para extraer 45+ datos por conversación
2. **analyzer/src/main.py** — Pipeline de análisis con workers paralelos
3. **analyzer/src/validator.py** — Validación de JSON de salida
4. **api/** — Backend FastAPI completo con JWT auth y endpoints para dashboard
5. **dashboard/** — Frontend Next.js con los 7 paneles
6. **nginx/** — Configuración de reverse proxy + SSL
7. **scripts/backup.sh** — Script de backups automáticos
8. **scripts/monitor.sh** — Script de monitoreo
9. **Exportador de base de conocimiento para Dapta**
10. **Testing y deployment**

## Infraestructura
- **Servidor:** DigitalOcean Droplet (NYC1)
  - Pruebas: Premium AMD 2vCPU / 4GB / 80GB ($24/mo)
  - Producción: General Purpose 4vCPU / 16GB ($63-84/mo)
- **Stack:** Docker, PostgreSQL 16, Redis 7, Node.js 20, Python 3.11, FastAPI, Next.js

## Flujo del Sistema
```
WhatsApp → Extracción (Node.js) → BD cruda
→ Transcripción audios (Whisper API) → BD enriquecida
→ Análisis IA (Claude Sonnet API) → BD final
→ Dashboard (Next.js) + Exportación Dapta
```

## Cómo continuar en Claude Code
1. Abrir Claude Code en el directorio del proyecto
2. Darle el archivo CONTEXT.md como contexto
3. Pedirle que complete los módulos faltantes uno por uno
4. Probar cada módulo localmente antes de desplegar
