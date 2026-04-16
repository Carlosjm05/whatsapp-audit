# Plan de correcciones — whatsapp-audit

Basado en la auditoría del 2026-04-16. 11 fases, cada una es un commit (o pocos).
Orden diseñado para que cada fase sea independiente y testeable.

---

## Decisiones de diseño (antes de empezar)

| Tema | Decisión | Razón |
|---|---|---|
| `projects_catalog` / `advisors_catalog` | **DROP** | Vacíos, nadie los consulta. Si se quiere la feature de reconciliar aliases, se re-agrega después con datos reales. |
| `system_logs` / `processing_stats` | **DROP** | Ningún componente escribe en ellas. |
| Columnas `extraction_runs.total_audios`, `total_media`, `disk_usage_mb`, `metadata` | **DROP** | Nunca se pueblan. |
| `lead_analysis_history` | **Integrar a `schema.sql`** y conectar con `/reanalyze` end-to-end |
| Contrato de enums (`offers_trade_in`, etc.) | **Prompt pide strings** `'si'/'no'/'desconocido'` (alinea con DB y validator) |
| `metrics` y `response_times` computed | **Quitar del validator** lo que el prompt explícitamente NO pide; la app los calcula |
| Nombres de columnas en inglés (`offers_trade_in`, `has_bank_preapproval`, etc.) | **Mantener** | Renombrarlos implica wipe de DB + cambios en 4 subsistemas. Out of scope de esta auditoría. |
| Script `setup.sh` chromium | **Eliminar** los paquetes de Puppeteer/Chromium |

---

## FASE 1 — Bugs visibles del dashboard y export

**Objetivo:** arreglar cosas que el usuario ve rotas HOY, sin tocar DB ni arquitectura.

### 1.1 Export CSV/JSON funciona con nombre con guion
- `api/src/routers/export.py`: registrar alias `recoverable-leads`, `knowledge-base`, `advisor-scores` (con guion).
- Alternativa más limpia: aceptar ambas formas, o usar guion como canónico.

### 1.2 Export respeta filtros del dashboard
- `api/src/routers/export.py`: el endpoint `export_resource` debe aceptar `priority`, `probability`, `advisor`, `search` como query params y aplicarlos al SQL igual que `leads/recoverable`.

### 1.3 CSS faltante `btn-secondary`
- `dashboard/app/globals.css`: agregar clase `.btn-secondary` con estilo coherente (gris claro, texto oscuro).

### 1.4 DataTable alineación rota por Tailwind JIT
- `dashboard/components/DataTable.tsx:83-86`: reemplazar `text-${col.align||'left'}` por mapping explícito: `const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' }`.

### 1.5 Intent score mal formateado en Overview
- `dashboard/app/overview/page.tsx:58-164`: usar `formatNumber(data.avgIntentScore, 1)` + sufijo `/10` en lugar de `formatPct`.

### 1.6 `TRANSCRIBER_WORKERS` sin efecto
- `transcriber/src/main.py:39`: cambiar `NUM_WORKERS = int(os.getenv('NUM_WORKERS', '3'))` → `os.getenv('TRANSCRIBER_WORKERS', '3')`. Mantener alias `NUM_WORKERS` para retrocompatibilidad si hace falta.

### 1.7 Modelo de Claude alineado con CLAUDE.md
- `analyzer/src/analyzer.py:31`: `CLAUDE_MODEL` default → `claude-sonnet-4-5` (modelo más reciente de la familia 4.5/4.6 según preferencia). Confirmar qué modelo quiere Oscar antes de fijar el literal. **Por ahora uso `claude-sonnet-4-5` que es el más capaz reciente.**

### 1.8 Eliminar imports muertos en conversación
- `dashboard/app/leads/[id]/conversation/page.tsx:6,10,47`: quitar `API_URL`, `getToken`, variable `hasMedia`.

### 1.9 `sender_phone = 'asesor'` → NULL
- `extractor/src/extractor.js:326-327`: si `isFromMe`, `sender_phone = null` (no la literal `'asesor'`).

**Commit:** `fix: bugs visibles del dashboard, export y extractor`

---

## FASE 2 — Contrato de 45+ campos (analyzer)

**Objetivo:** que prompt ↔ validator ↔ DB ↔ API ↔ dashboard ↔ knowledge_base hablen el mismo idioma.

### 2.1 Módulo común de enums
- Crear `analyzer/src/enums.py` con todos los sets (`BUDGET_RANGES`, `PAYMENT_METHODS`, `URGENCY`, `FINAL_STATUS`, etc.).
- `analyzer/src/validator.py:8-46`: importar de `enums.py`, quitar duplicados.
- `analyzer/src/db.py:14-52`: importar de `enums.py`, quitar duplicados.

### 2.2 Prompt pide `'si'/'no'/'desconocido'` (no bool)
- `analyzer/src/prompt.py`: para `offers_trade_in` y `depends_on_selling`, documentar como enum `"si" | "no" | "desconocido"` (no `bool`).
- `validator.py`: quitar la coerción de bool → string; validar directamente el enum.

### 2.3 Validator no incluye metrics/response_times computados
- `analyzer/src/validator.py:167-171`: quitar `total_messages`, `advisor_messages`, `lead_messages`, `advisor_audios`, `lead_audios` del schema del validator. Se calculan en `analyzer.py` y se persisten directamente (no vienen de Claude).
- `analyzer/src/validator.py:186-195`: quitar `first_response_minutes`, `avg_response_minutes`, `longest_gap_hours`, `advisor_active_hours`, `response_time_category` del schema del validator. Mismo criterio.
- El prompt ya dice explícitamente "NO los incluyas" → alineamos al validator para que no los espere.

### 2.4 Separar errores retriables de no-retriables en Claude client
- `analyzer/src/analyzer.py:283`: cambiar `except (RetryError, Exception)` por dos ramas:
  - `APIError` / `RateLimitError` → retriable, incrementa contador.
  - `ValidationError` / `JSONDecodeError` / `KeyError` → no retriable, marcar `failed` inmediatamente (no quemar 3 llamadas).

### 2.5 Truncar transcripts excesivamente largos
- `analyzer/src/analyzer.py`: si `full_transcript` > 60k tokens aprox (usar `len(text) // 4` como heurística), truncar en medio preservando inicio y fin. Evita errores 400 de Claude por contexto.

**Commit:** `fix(analyzer): contrato 45+ campos alineado prompt/validator/DB + retry filter`

---

## FASE 3 — Schema SQL: integrar migraciones + limpiar muerto

**Objetivo:** que un `docker compose down -v && up` produzca un sistema funcional sin migraciones manuales.

⚠️ **Requiere wipe de volumen.** Se documenta en el commit.

### 3.1 Integrar `lead_analysis_history` a `schema.sql`
- Añadir el `CREATE TABLE lead_analysis_history` y sus índices al final de `db/schema.sql`.
- Marcar `db/migrations/003_*.sql` como "ya integrada a schema.sql — solo aplicar en despliegues previos al 2026-04-16".

### 3.2 Agregar UNIQUE(lead_id) a tablas del analyzer (evita duplicados en reanalyze)
- `conversation_metrics`, `response_times`, `advisor_scores`, `conversation_outcomes`, `lead_intent`, `lead_financials`: `UNIQUE(lead_id)`.
- Nota: `lead_interests`, `lead_objections`, `competitor_intel` permanecen sin UNIQUE (son listas → N por lead).

### 3.3 DROP tablas huérfanas
- `system_logs`, `processing_stats`, `projects_catalog`, `advisors_catalog`.

### 3.4 DROP columnas huérfanas en `extraction_runs`
- `total_audios`, `total_media`, `disk_usage_mb`, `metadata`.

### 3.5 Índices faltantes en `db/indexes.sql`
- `CREATE INDEX idx_leads_last_contact_at ON leads(last_contact_at);`
- `CREATE INDEX idx_leads_analyzed_at ON leads(analyzed_at);`
- `CREATE INDEX idx_summaries_conversation ON conversation_summaries(conversation_id);`
- `CREATE INDEX idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;`
- `CREATE INDEX idx_extraction_runs_status_started ON extraction_runs(status, started_at DESC);`

### 3.6 Limpiar migración 002 (ya absorbida) y 001
- Mover `db/migrations/001_*.sql` y `002_*.sql` a `db/migrations/archive/`. La 003 se elimina (ya vive en schema.sql).

**Commit:** `feat(db): integrar migraciones pendientes al schema, limpiar tablas muertas, indices faltantes`

---

## FASE 4 — `/reanalyze` funcional end-to-end

**Objetivo:** que el botón "Reanalizar" realmente reanalice.

### 4.1 API: `/reanalyze` marca lead como pending + crea history row
- `api/src/routers/leads.py:117-143`: al marcar `analysis_status='pending'` e insertar en `lead_analysis_history` con `status='pending'`, todo OK. (Ya se hace.)
- Validar UUID antes del query para devolver 400 (no 500) ante ID inválido.

### 4.2 Analyzer: al tomar un lead pending, actualizar history row
- `analyzer/src/db.py`: cuando `fetch_pending_leads` saque un lead y el analyzer lo procese, si existe una fila `lead_analysis_history (status='pending', lead_id=X)`, pasarla a `'processing'` al empezar, a `'completed'`/`'failed'` al terminar, con `model_used`, `cost_usd`, `completed_at`.
- Borrar resultados previos del lead (summaries, outcomes, metrics, etc.) para que el nuevo análisis no cohabite con el viejo — `persist_analysis` ya hace delete-insert en summaries/outcomes; extender a metrics/response_times/advisor_scores/intent/financials/interests/objections/competitor_intel.

### 4.3 API: `/analysis-history` retorna algo útil o se elimina
- Dejar el endpoint pero expandir response con `diff_summary` (si existe) y ordenar DESC por `started_at`. Ya está correcto en el router — solo verificar que el dashboard lo consuma si queremos feature visible.
- Como el dashboard no consume el endpoint, por ahora **lo dejamos funcional pero no agregamos UI**. Evita dead code sin perder la capacidad futura.

### 4.4 Validar UUID en todos los endpoints que reciben `lead_id: str`
- `api/src/routers/leads.py:122,149,291,347`: helper `_parse_lead_id(lead_id)` que valida `uuid.UUID(lead_id)` y lanza `HTTPException(400, "ID inválido")`.

**Commit:** `feat(reanalyze): flujo end-to-end funcional + validacion UUID en API`

---

## FASE 5 — Seguridad

**Objetivo:** cerrar las puertas abiertas antes de producción real.

### 5.1 CORS cerrado
- `api/src/main.py:60-66`: usar `settings.cors_origins` (ya definido en `config.py:40`). Default razonable: `["https://audit.ortizfincaraiz.com"]` o el que corresponda.

### 5.2 JWT_SECRET fail-fast
- `api/src/config.py:26`: si `JWT_SECRET == "change-me-in-prod"` o `len(JWT_SECRET) < 32`, lanzar `RuntimeError` al cargar settings.

### 5.3 Rate limit en `/auth/login`
- Agregar `slowapi` a `requirements.txt`.
- `api/src/main.py`: `Limiter` global, `@limiter.limit("5/minute")` en `/auth/login`.

### 5.4 nginx: descomentar HTTPS + arreglar cert path
- `nginx/conf.d/default.conf`: descomentar bloque HTTPS. Cambiar `ssl_trusted_certificate chain.pem` → `ssl_trusted_certificate fullchain.pem` (cert moderno de certbot).
- Agregar cabeceras de seguridad: `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- Redirigir `http://` → `https://` en server block 80.
- ⚠️ **Precaución:** si el dominio aún no tiene cert emitido, el HTTPS no arrancará. Documentar que `certbot certonly` debe correr una vez antes del primer `nginx up`.

### 5.5 JWT expiry más razonable
- `api/src/config.py:28`: `JWT_EXPIRY_HOURS` default → 8 (admin único, 8h es razonable; 24h es mucho).

**Commit:** `feat(sec): CORS cerrado, JWT fail-fast, rate-limit login, HTTPS headers`

---

## FASE 6 — Extractor: fuga de memoria + control de rate

**Objetivo:** que la extracción de 12k chats no reviente el contenedor.

### 6.1 Purgar `syncedMessages` por chat ya persistido
- `extractor/src/index.js`: cuando un chat se escriba exitosamente a DB (al final del loop `messaging-history.set`), `syncedMessages.delete(jid)`. Con 12k chats y miles de mensajes cada uno, esto baja de GB a MB.

### 6.2 `MEDIA_CONCURRENCY` como env var
- `extractor/src/extractor.js:19`: leer `process.env.MEDIA_CONCURRENCY` con default 5.

### 6.3 Detectar 429/rate-limit en `_safeDownloadMedia`
- `extractor/src/extractor.js:243-245`: si el error sugiere rate-limit (código Baileys específico o patrón en mensaje), pausar 60s antes de seguir con el siguiente media.

### 6.4 Shutdown handlers esperan async
- `extractor/src/index.js:530-540`: `process.on('uncaughtException', async (err) => { try { await shutdown(...) } finally { process.exit(1) } })`. Exit code `1` (no `0`) ante excepción no capturada.

### 6.5 `waitForConnectionOutcome` respeta env
- `extractor/src/index.js:102`: timeout = `parseInt(process.env.SYNC_TIMEOUT_MS, 10) || 180000`.

### 6.6 Eliminar código muerto
- `extractor/src/database.js:258-265`: eliminar `createPendingTranscription`.
- `extractor/src/database.js:283-294`: eliminar `logSystem`.
- `extractor/src/utils.js:35-51`: eliminar `formatBytes`, `formatDuration`.
- `extractor/package.json`: eliminar script `start` duplicado.

**Commit:** `fix(extractor): fuga memoria en sync, MEDIA_CONCURRENCY env, shutdown async, dead code`

---

## FASE 7 — Transcriber: costos Whisper

**Objetivo:** no quemar API de OpenAI en retries absurdos.

### 7.1 Retry filter correcto
- `transcriber/src/main.py:56-63`: `retry_if_exception_type((openai.APIConnectionError, openai.RateLimitError, openai.APITimeoutError))`. NO `Exception`. NO reintentar FileNotFoundError, ValueError, etc.

### 7.2 Timeout en llamada Whisper
- `transcriber/src/main.py:80`: `client.audio.transcriptions.create(..., timeout=120.0)`.

### 7.3 Rechazar archivos >25MB sin llamar API
- `transcriber/src/main.py:76-77`: si `size > 25 * 1024 * 1024`, marcar `status='skipped'` con `error_message='audio_demasiado_grande'` y retornar sin gastar cuota.

### 7.4 Limpiar dependencias
- `transcriber/requirements.txt`: eliminar `redis`, `pydub`, `structlog` (no importados).

### 7.5 Eliminar imports muertos
- `transcriber/src/main.py:8,10,11,15`: eliminar `sys`, `time`, `uuid`, `datetime` no usados.
- Si `uuid` aún se usa en L377, mantenerlo.

### 7.6 Pool de conexiones Postgres
- `transcriber/src/main.py`: usar `psycopg2.pool.ThreadedConnectionPool(min=2, max=NUM_WORKERS+2)` en vez de abrir conexión nueva por job.

### 7.7 Argparse en español
- `transcriber/src/main.py`: choices `'transcribe', 'unify', 'stats', 'full'` → `'transcribir', 'unificar', 'stats', 'completo'`.

**Commit:** `fix(transcriber): retry filter, timeout Whisper, rechaza audios grandes, pool DB`

---

## FASE 8 — Analyzer: robustez + i18n

**Objetivo:** rematar el analyzer después de la fase 2.

### 8.1 Logs en español
- `analyzer/src/analyzer.py:46,322-337` y demás: traducir "received signal", "registered new pending leads", "lead analyzed OK", "worker crashed", "done: ok=%d failed=%d" → español.

### 8.2 ANTHROPIC_API_KEY fail-fast amigable
- `analyzer/src/analyzer.py:185`: `if not os.environ.get('ANTHROPIC_API_KEY'): raise RuntimeError('Falta ANTHROPIC_API_KEY en el entorno')`.

### 8.3 Umbrales de categoría de respuesta
- `analyzer/src/analyzer.py:130-141`: revisar umbrales (el rango `malo` cubre 2h–24h, demasiado ancho). Sugerencia:
  - `excelente`: <5 min
  - `bueno`: 5–30 min
  - `regular`: 30–120 min
  - `malo`: 2h–8h
  - `critico`: >8h o sin respuesta

### 8.4 Eliminar `fetch_signal_source_leads` muerta
- `analyzer/src/db.py:662-683`: quitar.

### 8.5 `knowledge_base.py`: mejoras mínimas
- `analyzer/src/knowledge_base.py`: generar `entry_type='respuesta_ideal'` desde `lead_objections.advisor_response` donde `response_quality >= 8`.
- Wrap en transacción: `BEGIN; TRUNCATE; INSERT ...; COMMIT;` para que un fallo a mitad no deje la KB vacía.

**Commit:** `fix(analyzer): i18n, umbrales respuesta, dead code, KB con respuesta_ideal`

---

## FASE 9 — API: limpieza + i18n

### 9.1 Mensajes de error en español
- `api/src/auth.py:52,64,74,77`: "Missing authorization token" → "Token de autorización faltante", etc.
- `api/src/routers/leads.py:124,150,296,349`: "Lead not found" → "Lead no encontrado".
- `api/src/routers/advisors.py:109`: "Advisor not found" → "Asesor no encontrado".
- `api/src/routers/export.py:152`: "Unknown resource '%s'" → "Recurso desconocido '%s'".

### 9.2 Overview consistente en snake_case
- `api/src/routers/overview.py`: renombrar `totalConversations` → `total_conversations`, `avgIntentScore` → `avg_intent_score`, etc.
- `dashboard/types/api.ts` y `app/overview/page.tsx`: actualizar accesos.

### 9.3 Eliminar schemas no usados
- `api/src/schemas.py:34,81,113`: quitar `RecoverableLeadRow`, `AdvisorSummary`, `KnowledgeBaseRow` si no se tipan los endpoints; o **usarlos** como `response_model` en las rutas correspondientes (mejor). Escogemos la segunda: mejor tipado.

### 9.4 Health endpoint no expone detalles
- `api/src/main.py:98`: no retornar estado individual de `db`/`redis` en público; solo `{"status":"ok"}` si todo va bien, 503 si algo falla. Evita reconocimiento.

### 9.5 Log de DB sin filtrar params
- `api/src/db.py:34`: confirmar que no se loguean SQL params. Si se llegara a subir a DEBUG, filtrar explícitamente.

**Commit:** `fix(api): i18n errores, snake_case consistente, response_model tipados, health privado`

---

## FASE 10 — Dashboard: UX + limpieza

### 10.1 Modal/toast reemplaza alert/prompt nativos
- Crear `dashboard/components/Toast.tsx` (simple, con contexto React). O usar librería ligera como `react-hot-toast`.
- `dashboard/app/leads/page.tsx:131`, `app/knowledge-base/page.tsx:61,73`: reemplazar `alert()` por `toast.error(...)`.
- `dashboard/app/search/page.tsx:141`: reemplazar `prompt()` por un modal simple con input controlado.

### 10.2 Hook `useFetch` unificado
- Crear `dashboard/lib/useFetch.ts` con el patrón `active` flag, manejo de 401, loading/error states.
- Migrar las ~10 páginas a usarlo. Elimina ~80 líneas duplicadas.

### 10.3 Debounce en filtros de `/leads`
- `dashboard/app/leads/page.tsx:50`: envolver el fetch de filtros en debounce 400ms (consistente con `/search`).

### 10.4 Accesibilidad: labels con htmlFor
- `dashboard/app/login/page.tsx:67-85`: `<label htmlFor="email">` + `<input id="email">`. Ídem password.
- `dashboard/app/trends/`: inputs de fecha con label asociada.

### 10.5 Eliminar tipos huérfanos
- `dashboard/types/api.ts:241-253`: dejar `AnalysisHistoryEntry` solo si se va a usar; si no, eliminar. **Decisión: dejar, lo usa el endpoint `/analysis-history` que está funcional.**

### 10.6 Evitar re-renders innecesarios
- `dashboard/app/advisors/page.tsx:39`: `const sorted = useMemo(() => [...rows].sort(...), [rows, sortKey, sortDir])`.

### 10.7 DataTable keys estables
- `dashboard/components/DataTable.tsx:114`: `key={row.id ?? row.lead_id ?? i}` para evitar reorder bugs.

**Commit:** `refactor(dashboard): toast en vez de alert/prompt, useFetch hook, a11y labels, keys estables`

---

## FASE 11 — Infraestructura (docker-compose, setup.sh, .env)

### 11.1 docker-compose: quitar `version: '3.9'`
- Compose v2 ignora el campo y emite warning. Eliminar línea.

### 11.2 Healthcheck API sin `curl`
- `api/Dockerfile`: instalar `curl` (o cambiar healthcheck a `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"`).
- Opción preferida: usar Python (más ligero).

### 11.3 Healthcheck del extractor
- `docker-compose.yml`: healthcheck del extractor que verifique `/app/auth_state/creds.json` o un marker file "conectado".

### 11.4 nginx depends_on con condition
- `docker-compose.yml:262-283`: `depends_on: { api: { condition: service_healthy }, dashboard: { condition: service_started } }`.

### 11.5 certbot restart
- `docker-compose.yml:288-296`: `restart: unless-stopped`.

### 11.6 setup.sh: eliminar Chromium
- `setup.sh:69-78`: quitar `chromium-browser`, `libgbm-dev`, `libnss3`, `libatk-bridge2.0-0`, `libxkbcommon0`, `libxcomposite1`, `libxrandr2`, `libgdk-pixbuf2.0-0`, `libgtk-3-0`, `libasound2t64`.

### 11.7 setup.sh: idempotente para swapfile/sysctl
- `setup.sh:212`: agregar check antes de `echo ... >> /etc/fstab`: `grep -q '/swapfile' /etc/fstab || echo ...`.
- Mismo para `limits.conf` y `sysctl.conf`.

### 11.8 setup.sh: UFW no reset en re-run
- `setup.sh:104-110`: agregar flag file `/var/lib/ortiz-setup-ufw-done` para saltarse el reset en re-ejecuciones.

### 11.9 .env.example alineado
- Quitar: `DOMAIN`, `API_URL`, `BACKUP_ENABLED`, `S3_*`, `TELEGRAM_*` si no se implementarán.
- Agregar: `NEXT_PUBLIC_API_URL`, `JWT_EXPIRY_HOURS`, `TRANSCRIBER_WORKERS`, `ANALYZER_WORKERS`, `MEDIA_CONCURRENCY`, `SYNC_TIMEOUT_MS`.
- Cambiar: `ADMIN_USER=oscar` → `ADMIN_USER=CAMBIAR_POR_USUARIO`.

### 11.10 .gitignore: limpiar restos de whatsapp-web.js
- `.gitignore:23-24`: quitar `.wwebjs_auth/` (stack anterior, ya no aplica).

**Commit:** `fix(infra): docker healthchecks, setup.sh idempotente y sin chromium, .env alineado`

---

## Ejecución

Voy a ejecutar las 11 fases **secuencialmente** porque hay dependencias (ej: fase 3 requiere wipe + fase 4 depende de la tabla integrada). Entre cada fase, verifico:

1. `docker compose build <servicio_afectado>` compila sin error.
2. `docker compose up -d <servicio_afectado>` levanta healthy.
3. Si la fase toca DB destructivamente, aviso antes: **"Fase 3 requiere `docker compose down -v` — perderás datos. ¿Confirmo?"**

No voy a correr pytest/jest porque este proyecto no tiene suite de tests (y agregarla es otro proyecto).

Voy a usar commits convencionales como los que ya están en el repo:
- `fix(modulo): descripcion`
- `feat(modulo): descripcion`
- `refactor(modulo): descripcion`

Co-autor en cada commit: `Claude Opus 4 <noreply@anthropic.com>`.

---

## Resumen de riesgo por fase

| Fase | Destructiva | Requiere wipe DB | Requiere rebuild Docker |
|---|---|---|---|
| 1  | No | No | dashboard, api |
| 2  | No | No | analyzer |
| 3  | **SÍ** | **SÍ** | postgres (init) |
| 4  | No | No (ya hecho en 3) | analyzer, api |
| 5  | No | No | api, nginx |
| 6  | No | No | extractor |
| 7  | No | No | transcriber |
| 8  | No | No | analyzer |
| 9  | No | No | api, dashboard |
| 10 | No | No | dashboard |
| 11 | No | No | todos |

Total estimado: 11 commits, ~2-4 horas de ejecución secuencial.
