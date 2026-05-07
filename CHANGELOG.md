# Changelog

Registro de cambios notables del sistema `whatsapp-audit`.

El formato sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es/1.1.0/)
y el versionado [SemVer 2.0.0](https://semver.org/lang/es/). El proyecto
todavía no etiqueta releases formales (cliente único, despliegue
continuo); las "versiones" abajo son hitos lógicos basados en el
historial de commits.

## [No publicado]

### Added

- **Informe público `/reporte` + gestión de enlaces desde el panel
  admin** — Página agregada y anónima de diagnóstico de errores que
  el cliente (Oscar) puede compartir en reuniones sin exponer datos
  por asesor. Sin login, protegida por token en query string
  (`?k=<token>`).

  **Generación de enlaces desde el dashboard:** página nueva
  `/enlaces` (rol `admin`) lista, crea y revoca tokens. Cada token se
  guarda **hasheado** (`sha256`) en la tabla `public_report_tokens`;
  el plaintext solo se devuelve en el response del POST de creación
  (filosofía "shown once"). Tracking de uso (last_used_at, use_count)
  para auditoría. Caducidad opcional configurable. Endpoints admin:
  `GET/POST /api/admin/share-tokens`,
  `POST /api/admin/share-tokens/{id}/revoke`,
  `DELETE /api/admin/share-tokens/{id}`.
  Migración: `db/migrations/010_public_report_tokens.sql`.

  **Endpoint público:** `GET /api/public/report?k=<token>`. Valida
  contra DB primero, con fallback a `PUBLIC_REPORT_TOKEN` del `.env`
  para compatibilidad. Si nada coincide responde 404 (no filtra
  existencia del endpoint).

  **Datos incluidos:** resumen general, KPIs de tiempo de respuesta,
  distribución por categoría, SLA velocidad/seguimiento, % de
  procesos rotos (no-followup, mensajes genéricos, no propuso visita,
  no calificó, etc.), top 30 de errores categorizados, causas de
  pérdida granular, estados finales, objeciones (resueltas/ocultas/
  por tipo), preguntas sin responder, tendencia mensual y lista
  textual completa de hasta 5.000 errores con fecha. Sin advisor_name,
  lead_id, teléfono ni nombres en ninguna respuesta.

  **Helper nuevo:** `require_admin` en `api/src/auth.py` para gating
  por rol en endpoints admin (devuelve 403 a operator/viewer).
  El `role` ahora se persiste también en `localStorage` del dashboard
  para gatear la página `/enlaces` antes del request al backend.

Hallazgos de **código** de la auditoría 2026-05-06 pendientes de
aplicar. Ver
[docs/audits/2026-05-06-auditoria-completa.md](docs/audits/2026-05-06-auditoria-completa.md)
secciones FASE 0 a FASE 4.

## [1.5.0] — 2026-05-06 — Reorganización de documentación + licenciamiento

### Added

- **`LICENSE`** — Licencia de uso revocable a favor de Ortiz Finca
  Raíz. Modelo de cesión, no venta. Detalle del derecho de revocación
  con preaviso de 5 días. Ver
  [ADR-0007](docs/adr/0007-licenciamiento-cesion-revocable.md).
- **`SECURITY.md`** — Política de seguridad: contacto del Autor,
  modelo de amenazas, política de rotación de secretos, lista de
  acciones prohibidas.
- **`CHANGELOG.md`** — Este archivo, reconstruido del git log con
  formato Keep a Changelog 1.1.0.
- **`docs/PRIVACIDAD.md`** — Política de tratamiento de datos
  personales conforme a Ley 1581 de 2012 (Colombia). Borrador
  pendiente de revisión legal antes de producción.
- **`docs/RUNBOOK.md`** — Procedimientos operativos paso a paso
  (primer arranque, conexión QR, extracción por lotes, reanalyze,
  backups, troubleshooting, rotación de secretos, **procedimiento de
  revocación de la licencia**).
- **`docs/CONTEXTO_NEGOCIO.md`** — Motivación, restricciones y
  stakeholders (extraído del antiguo CONTEXT.md).
- **`docs/SCHEMA_45_CAMPOS.md`** — Referencia técnica del contrato
  de salida del analyzer (extraído del antiguo CONTEXT.md).
- **`docs/adr/`** — 7 Architecture Decision Records en formato MADR:
  Baileys, multi-usuario+QR, two-pass Haiku+Sonnet, profiles,
  workflow indexado, schema vs migraciones, licenciamiento.
- **`docs/audits/`** — Carpeta de auditorías históricas.
- **Docstrings de módulo** en archivos Python clave (`analyzer.py`,
  `db.py`, `prompt.py`, `validator.py`, `knowledge_base.py`, `main.py`
  del analyzer; mejorado en transcriber).

### Changed

- **`README.md`** reescrito por completo con quickstart, tabla de
  servicios, links a docs, estado real del proyecto.
- **`CLAUDE.md`** ampliado con sección "Never do", tabla "Before
  changing X, read Y", catálogo de comandos peligrosos, atribución
  del Autor.
- **`CONTEXT.md`** reducido a índice corto que apunta a los nuevos
  documentos. Mantiene la ruta para compatibilidad con referencias
  externas.
- **`.env.example`** placeholders cambiados a formato inerte
  `__SET_ME_*__` para que sean rechazables por validación de runtime
  cuando se implemente. Comentarios condensados y enlaces a docs.
- **`db/migrations/README.md`** actualizado con la realidad del
  directorio (migraciones 004-009 en raíz + archive/).
- `PLAN_CORRECCIONES.md` renombrado a
  `docs/audits/2026-04-16-auditoria-inicial.md` con tabla de fases
  cerradas/parciales y los commits que las materializaron.

### Fixed (información errónea en docs)

- README y CONTEXT decían `whatsapp-web.js` cuando el sistema usa
  Baileys desde 2026-04-15.
- README y CONTEXT listaban como "POR HACER" módulos completados:
  analyzer, API, dashboard, nginx, knowledge_base.
- CONTEXT decía "usuario admin: oscar" cuando el sistema soporta
  multi-usuario desde 2026-04-23.
- Auditoría inicial sin tracking de qué fases se cerraron y cuáles
  parcialmente.

### Security

- Atribución de autoría clarificada: Carlos Manuel Jiménez Méndez es
  autor único y titular de los derechos. Claude Code (Anthropic) se
  reconoce únicamente como herramienta de productividad del Autor.
  Las menciones operativas a la API de Anthropic (Encargado de
  tratamiento) cumplen con Art. 26 de Ley 1581.

## [1.4.0] — 2026-05-04 — UX mobile profesional

### Added
- Bottom navigation y drawer para navegación en iPhone.
- Filtro `--before` en `npm run extract` para procesar lotes hasta una
  fecha específica.

### Changed
- Header del dashboard unificado (un solo header en lugar de dos
  superpuestos en mobile).
- Tiempo de respuesta del asesor ahora se calcula contra el último
  mensaje del lead, no el primero.

### Fixed
- Auto-bot de Ortiz se excluye de las métricas SLA.
- `recompute_metrics` accede al cursor `RealDictCursor` por clave en
  lugar de índice.
- Logs de `recompute_metrics` incluyen traceback completo.
- Errores normalizados en panel `/errors` con asesores `'General'`
  manejados correctamente.

## [1.3.0] — 2026-04-26 — Cerebro v3 + workflow indexado

### Added
- **Cerebro v3** del analizador: SLA de 5 minutos, regla
  `separó/compró`, y mensajes de recovery con estilo Óscar.
- **Workflow de indexado**: comandos `npm run index` / `preview` /
  `extract --batch=N` para procesar el WhatsApp en lotes manejables.
- **Daemon Redis**: el extractor escucha jobs en la cola `wa:jobs`;
  el dashboard panel `/extraccion` los publica.
- Descubrimiento de chats vía `chats.set` además de los que tienen
  mensajes (encontró ~30% más chats que el sync anterior).

### Fixed
- Filtros de `@lid`, `@g.us`, `@broadcast` aplicados consistentemente
  en `_registerChat`, `messaging-history.set` y `messages.upsert`.
- `saveConversation()` retorna el id real tras `ON CONFLICT DO UPDATE`
  para evitar FK colgantes.
- Hardening del sync inicial: 5 bugs detectados en re-audit corregidos.
- Esperar batches adicionales de historial tras `isLatest` para no
  perder mensajes recientes.

## [1.2.0] — 2026-04-23 — Multi-usuario + QR remoto + analyzer protegido

### Added
- **QR remoto**: panel `/conexion` permite escanear el QR de Baileys
  desde un celular (token de un solo uso).
- **Multi-usuario**: tabla `admin_users` reemplaza al admin único env-based
  (env-based queda como fallback).
- **Override manual** de campos del lead desde el dashboard.
- **Costos de Claude/Whisper** visibles en panel.
- Tiempo de respuesta calculado con horario laboral + domingo separado.

### Changed
- Analyzer protegido contra auto-arranque: requiere
  `--profile analysis` explícito.
- Panel con KPIs claros analizados/pendientes y sidebar agrupado.

### Fixed
- `bcrypt` directo en `auth.py` (incompatibilidad con `passlib` y
  `bcrypt 4.x`).
- Fallback `execCommand('copy')` en `/conexion` para HTTP+IP (sin TLS,
  `navigator.clipboard` no funciona).
- Bucket `sunday` solo cuando ambos mensajes son del mismo domingo
  (antes contaba viernes-lunes como domingo).

## [1.1.0] — 2026-04-17 — Cerebro v2 + features post-launch

### Added
- **Analyzer v2**: prompt reescrito, SLA de 10 minutos, detección de
  leads fantasma, demografía expandida.
- **Catálogos editables**: gestión de proyectos y asesores desde el
  panel (resuelve el problema de "Oscar y Daniela son la misma
  persona").
- **Hints enriquecidos** al prompt con catálogos.
- Circuit breaker en extractor: si N media consecutivos dan timeout,
  asume teléfono suspendido y aborta el batch.
- Timeout duro en download de media para evitar cuelgues.

### Fixed
- 11 items de hardening (HIGH/MEDIUM) detectados en auditoría
  exhaustiva del cerebro v3.
- Cast `source_leads` a `uuid[]` en upsert de KB.
- Filtros de ghosts demasiado estrictos (devolvían 0 resultados).
- Escape de llaves `{LEAD, ASESOR}` en el template del prompt.
- DELETE de catálogos sin body (incompatible con HTTP 204).

## [1.0.0] — 2026-04-16 — Plan de correcciones (11 fases)

Ejecución del plan documentado en
[docs/audits/2026-04-16-auditoria-inicial.md](docs/audits/2026-04-16-auditoria-inicial.md):

### Added
- Endpoint `/reanalyze` end-to-end funcional con validación UUID.
- Rate limit en `/auth/login` (5/min).
- Política CORS cerrada al dominio del cliente.
- JWT fail-fast en producción (`STRICT_CONFIG`).
- nginx con headers de seguridad básicos.

### Changed
- Schema integra migraciones 003-009 al `schema.sql` base. Una DB
  fresca queda equivalente a una migrada.
- Validador del analyzer alineado con el contrato 45+ campos del
  prompt.
- Healthchecks de Docker corregidos (API usa Python en lugar de curl,
  extractor verifica `creds.json`).
- Toasts reemplazan `alert()`/`prompt()` nativos en el dashboard.
- Endpoints API en snake_case consistente (`avgIntentScore` →
  `avg_intent_score`).

### Removed
- Tablas muertas: `system_logs`, `processing_stats`,
  `projects_catalog`, `advisors_catalog`.
- Columnas muertas de `extraction_runs`: `total_audios`, `total_media`,
  `disk_usage_mb`, `metadata`.
- Paquetes Chromium/Puppeteer del `setup.sh` (sobrantes de la migración
  a Baileys).

### Fixed
- Fuga de memoria en sync del extractor (`syncedMessages` no se
  purgaba por chat).
- Retry filter en transcriber correcto (no reintenta `FileNotFoundError`).
- Audios >25MB se rechazan sin gastar cuota de Whisper.

## [0.2.0] — 2026-04-15 — Migración a Baileys + features 1-7

### Added
- **Migración del extractor**: `whatsapp-web.js` (basado en Chromium)
  reemplazado por `@whiskeysockets/baileys` (WebSocket directo). Razones
  documentadas en
  [docs/adr/0001-baileys-vs-whatsapp-web-js.md](docs/adr/0001-baileys-vs-whatsapp-web-js.md).
- Features 1-7 del dashboard: vista detallada de lead, visualizador de
  conversación estilo WhatsApp, búsqueda, tendencias, mobile, exportador
  Dapta.

### Changed
- Dockerfile del extractor: `git` + deps de compilación necesarias para
  `libsignal-node` (Baileys).
- VARCHAR(10) → VARCHAR(32) en campos enum con default `'desconocido'`.

### Fixed
- Reconexión automática en `DisconnectReason 515`.
- INSERT robusto por batches en extractor (reduce probabilidad de
  pérdida ante crash).
- Media download en paralelo con skip graceful y `--skip-media`.

## [0.1.0] — 2026-04-15 — Esqueleto inicial

Primer commit con el proyecto completo: extractor (whatsapp-web.js,
luego migrado), transcriber (Whisper), analyzer (Claude), API
(FastAPI), dashboard (Next.js), nginx, docker-compose.

---

## Convenciones

Cada entrada se categoriza en:

- **Added** — funcionalidad nueva
- **Changed** — cambios en funcionalidad existente
- **Deprecated** — marcadas para eliminación
- **Removed** — eliminadas
- **Fixed** — bugs corregidos
- **Security** — parches de seguridad

Las versiones reflejan hitos lógicos del proyecto, no releases con tag
git formal. Si el proyecto entra en un modelo de releases con tags,
adoptar SemVer estricto.
