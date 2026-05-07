# whatsapp-audit

**Sistema de inteligencia comercial sobre WhatsApp para Ortiz Finca
Raíz** (inmobiliaria colombiana). Extrae ~12,000 conversaciones,
transcribe audios y produce 45+ campos estructurados por chat con
Claude. El resultado se consume desde un dashboard web y se exporta
como base de conocimiento al agente IA de Dapta.

> **Software propietario.** Autor y titular: Carlos Manuel Jiménez
> Méndez. Cesión de uso, no de propiedad, a Ortiz Finca Raíz, bajo
> licencia revocable por el Autor. Ver [`LICENSE`](LICENSE).

## Pipeline

```
WhatsApp ──► extractor (Node 20 + Baileys)        ──► Postgres (raw)
         ──► transcriber (Python 3.11 + Whisper)   ──► Postgres (enriched)
         ──► analyzer (Python 3.11 + Claude Sonnet) ──► Postgres (final)
         ──► api (FastAPI) ──► dashboard (Next.js 14) ──► nginx + certbot
```

8 servicios orquestados con Docker Compose. Cola Redis entre
servicios, persistencia en Postgres 16, datos crudos en bind mount
`./data`.

## Quickstart (local, dev)

Requisitos: Docker 24+, Docker Compose v2, ~4 GB de RAM libres.

```bash
# 1. Configurar variables
cp .env.example .env
nano .env   # llenar TODOS los placeholders, especialmente JWT_SECRET y *_PASSWORD

# 2. Levantar dependencias y servicios "siempre arriba"
docker compose up -d postgres redis api dashboard nginx

# 3. Crear usuario admin del dashboard
docker compose exec api python -m src.cli_users create <usuario> <password>

# 4. Abrir el dashboard
#    http://localhost (con nginx) o http://localhost:3000 (directo)
```

El **extractor** y el **analyzer** NO auto-arrancan (son caros e
irreversibles, ver [ADR-0004](docs/adr/0004-profiles-extraction-analysis.md)).
Para activarlos:

```bash
docker compose --profile extraction up -d extractor   # extracción WhatsApp
docker compose --profile analysis up -d analyzer      # análisis IA
```

Para procedimientos operativos completos (conectar QR, extracción por
lotes, reanalyze, backups, troubleshooting) ver [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Servicios

| Servicio | Stack | Puerto interno | Auto-arranca | Healthcheck |
|----------|-------|----------------|--------------|-------------|
| `postgres` | Postgres 16-alpine | 5432 (bind 127.0.0.1) | Sí | `pg_isready` |
| `redis` | Redis 7-alpine | 6379 (bind 127.0.0.1) | Sí | `redis-cli ping` |
| `api` | FastAPI + Python 3.11 | 8000 (bind 127.0.0.1) | Sí | `GET /health` |
| `dashboard` | Next.js 14 | 3000 (bind 127.0.0.1) | Sí | implícito |
| `nginx` | nginx-alpine | 80, 443 | Sí | implícito |
| `certbot` | certbot oficial | — | Sí | — |
| `extractor` | Node 20 + Baileys | — | **No** (profile `extraction`) | `auth_state/creds.json` existe |
| `analyzer` | Python 3.11 + Claude SDK | — | **No** (profile `analysis`) | — |
| `transcriber` | Python 3.11 + OpenAI SDK | — | Sí | — |

## Documentación

```
README.md                           Este archivo
CLAUDE.md                           Guía operativa para Claude Code (inglés)
LICENSE                             Software propietario — uso restringido
SECURITY.md                         Política de seguridad y rotación de secretos
CHANGELOG.md                        Historial de cambios (Keep a Changelog)
.env.example                        Variables de entorno con placeholders documentados

docs/
├── CONTEXTO_NEGOCIO.md             Por qué existe, quién paga, restricciones
├── SCHEMA_45_CAMPOS.md             Contrato de salida del analyzer (referencia técnica)
├── RUNBOOK.md                      Procedimientos operativos paso a paso
├── PRIVACIDAD.md                   Política de tratamiento de datos (Ley 1581 CO)
├── adr/                            Architecture Decision Records (formato MADR)
│   ├── 0001-baileys-vs-whatsapp-web-js.md
│   ├── 0002-multi-usuario-qr-token.md
│   ├── 0003-two-pass-haiku-sonnet.md
│   ├── 0004-profiles-extraction-analysis.md
│   ├── 0005-workflow-indexado-lotes.md
│   └── 0006-schema-vs-migraciones.md
└── audits/
    ├── 2026-04-16-auditoria-inicial.md     11 fases de correcciones (ejecutadas)
    └── 2026-05-06-auditoria-completa.md    Hallazgos pendientes

db/
├── schema.sql                      Fuente de verdad del schema (20+ tablas)
├── indexes.sql                     Índices de performance
├── seed.sql                        Datos iniciales
└── migrations/                     Migraciones idempotentes para installs existentes
    ├── README.md
    └── archive/                    Migraciones ya integradas a schema.sql
```

## Stack técnico

| Capa | Componente | Versión |
|------|------------|---------|
| OS host | Ubuntu | 24.04 LTS |
| Orquestación | Docker Compose | v2 |
| Base de datos | PostgreSQL | 16-alpine |
| Cola / cache | Redis | 7-alpine |
| Extractor | Node + `@whiskeysockets/baileys` | 20-slim, 6.7.x |
| Transcriber / Analyzer / API | Python | 3.11-slim |
| Modelo de transcripción | OpenAI Whisper API | gpt-4o-transcribe / whisper-1 |
| Modelo de análisis | Anthropic Claude Sonnet | 4.5 (con Haiku 4.5 para triaje) |
| Frontend | Next.js (App Router) + Tailwind + Recharts | 14 |
| Reverse proxy | nginx | alpine |
| TLS | Let's Encrypt vía certbot | — |

## Estado del proyecto (a 2026-05-06)

- **Funcional**: extractor, transcriber, analyzer (cerebro v3), API
  (13 routers), dashboard (15+ páginas con UX mobile profesional),
  nginx + certbot, multi-usuario, QR remoto, override manual,
  workflow de extracción por lotes, exportador Dapta.
- **Pendiente**: backups automáticos a off-site, hallazgos de la
  auditoría 2026-05-06 (ver
  [`docs/audits/2026-05-06-auditoria-completa.md`](docs/audits/2026-05-06-auditoria-completa.md)).
- **No production-ready hasta**: completar FASES 0+1 del plan de
  remediación (backups, HTTPS activo, `STRICT_CONFIG=true`, fixes
  bloqueantes en transcriber y analyzer).

## Comandos más usados

```bash
# Estado de los servicios
docker compose ps

# Logs en vivo
docker compose logs -f api

# Reiniciar un servicio
docker compose up -d --force-recreate api

# Aplicar cambios de schema (DESTRUCTIVO — pierde datos)
docker compose down -v && docker compose up -d postgres

# Bootstrap del servidor (una vez, como root)
./setup.sh
```

Ver [`docs/RUNBOOK.md`](docs/RUNBOOK.md) para el catálogo completo.

## Autor y contacto

**Carlos Manuel Jiménez Méndez**
WhatsApp: +57 302 439 6752
Correo: carlitos05203rules@gmail.com

Único autor, titular y administrador del sistema. Para soporte,
incidentes, controversias o autorizaciones especiales, contactar por
los canales indicados.

## Cómo contribuir

Proyecto cerrado — autor único, sin contribuciones externas. Si
encontrás un bug o vulnerabilidad, seguir el procedimiento en
[`SECURITY.md`](SECURITY.md).

## Cumplimiento legal

El sistema procesa datos personales bajo la Ley 1581 de 2012
(Colombia). Antes de producción con datos reales, revisar
[`docs/PRIVACIDAD.md`](docs/PRIVACIDAD.md) con asesor legal.

---

_Algunas tareas de documentación, auditoría y refactor durante el
desarrollo fueron asistidas por herramientas de IA (Claude Code de
Anthropic) usadas por el Autor como parte de su flujo de trabajo. La
autoría intelectual y los derechos sobre el sistema corresponden
íntegramente a Carlos Manuel Jiménez Méndez._
