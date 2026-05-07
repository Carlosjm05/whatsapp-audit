# Auditoría 2026-05-06 — Código + Documentación

> Auditoría completa de los 6 módulos de código (extractor,
> transcriber+analyzer, API, dashboard, DB, infra) más una pasada
> profunda sobre toda la documentación. Total: ~75 hallazgos de código
> + ~28 hallazgos de documentación.

- **Alcance**: todo el repositorio en el commit `0410864`.
- **Auditor**: Carlos Manuel Jiménez Méndez (con Claude Code como
  herramienta de apoyo).
- **Estado**: hallazgos pendientes de aplicar. La parte de
  documentación se ejecuta en esta misma sesión; la parte de código
  queda para una sesión posterior.

---

## Diagnóstico de 30 segundos

El proyecto es **funcional pero NO production-grade** todavía. La
arquitectura es sólida (containers, profiles, healthchecks, schema
cuidado, cerebro v3 bien diseñado), pero hay **3 bombas listas para
explotar** que pueden quemar el proyecto entero:

1. **No hay backups.** Cero. Un `docker compose down -v` accidental,
   un disco corrupto, o un ransomware = se perdió todo.
2. **El bloque HTTPS de nginx está comentado.** Producción está
   sirviendo login + JWT por HTTP plano.
3. **`STRICT_CONFIG=false` por default + `.env.example` con secretos
   placeholder.** Un despliegue descuidado corre con
   `JWT_SECRET=CAMBIAR_POR_STRING_ALEATORIO_LARGO_MIN_32_CHARS`
   (público en el repo) → cualquiera firma JWT admin.

Adicional: **1 bug que rompe el transcriber al primer intento**
(`import re` faltante) y **1 que rompe el analyzer entero** (lambda
mal usado en `field_validator` Pydantic v2).

---

## Resumen por módulo (código)

| Módulo | Crítico | Alto | Medio | Bajo | Estado |
|---|---|---|---|---|---|
| Extractor (Baileys) | 4 | 8 | 8 | 5 | No listo — riesgo real de ban |
| Transcriber + Analyzer | 4 | 8 | 11 | 6 | Casi listo, bugs bloqueantes |
| API (FastAPI) | 3 | 9 | 9 | 4 | OK base, faltan guards y caching |
| Dashboard | 5 | 9 | 11 | 8 | Funcional, mobile a pulir |
| DB schema | 3 | 5 | 7 | 4 | Bien hecha, schema/migraciones desincronizables |
| Infra + seguridad | 3 | 5 | 7 | 5 | No listo — sin backups ni HTTPS |
| **TOTAL** | **22** | **44** | **53** | **32** | **151 hallazgos** |

## Resumen documentación

| Categoría | Cantidad |
|-----------|----------|
| Inconsistencias críticas (info errónea) | 6 |
| Documentos faltantes con impacto | 6 |
| Mejoras estructurales | 9 |
| Nitpicks | 7 |
| Cosas bien hechas | 7 |

---

## Hallazgos de código — los 22 críticos

### Bloque 1 — Bombas de producción (infra)

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 1 | (no existe) | Sin backups de Postgres. `setup.sh:199` crea `backups/` pero nada escribe ahí. | `pg_dump` en cron + S3/Spaces |
| 2 | `nginx/conf.d/default.conf:79-145` | Bloque `listen 443 ssl` comentado. Sitio sirve login y JWT por HTTP. | Descomentar + `return 301 https` en bloque :80 |
| 3 | `.env.example:38`, `api/src/config.py:48-71` | `STRICT_CONFIG=false` por default. Permite arrancar con secretos placeholder. | Default `true` + validar `JWT_SECRET` ≠ placeholder y ≥32 chars siempre |

### Bloque 2 — Bugs que rompen la app al primer intento

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 4 | `transcriber/src/main.py:375` | Usa `re.compile(...)` pero **`import re` NO está**. `NameError` inmediato. | Agregar `import re` arriba |
| 5 | `analyzer/src/validator.py:108-111` | `field_validator(...)(lambda cls, v: ...)` — Pydantic v2 necesita `@classmethod`. Puede rechazar **toda** respuesta de Claude. | Refactor a `@field_validator(...) @classmethod def _v(cls, v): ...` |
| 6 | `analyzer/src/db.py:418` | `LIKE 'transitorio:%%'` — el `%%` es escape Python, NO SQL. Cap de 24h **nunca dispara**. | Cambiar a `'transitorio:%'` |

### Bloque 3 — Riesgo de ban WhatsApp (extractor)

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 7 | `extractor/src/extractor.js:497-499` | `MEDIA_DELAY_MIN/MAX` definidos pero **NUNCA se usan**. 5 workers paralelos sin delay = patrón antibot. | `await sleep(randomBetween(mediaDelayMin, mediaDelayMax))` por worker |
| 8 | `extractor/src/index.js:1158-1171` | `uncaughtException`/`unhandledRejection` sin guard `isShuttingDown` → loop durante shutdown | Guard + `setTimeout(()=>process.exit(1), 5000)` |
| 9 | `extractor/src/index.js:1274` | `sock.end(undefined)` sobre `sock` global ya nullificado por daemon → NPE en SIGTERM | `if (sock) sock.end(undefined);` |
| 10 | `extractor/src/extractor.js:350-422` | Race en circuit breaker (`consecutiveTimeouts`, `cursor`) compartidos entre workers | Encapsular en clase con métodos atómicos |

### Bloque 4 — Seguridad API

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 11 | `api/src/auth.py:167` | Comparación `==` no constant-time | `hmac.compare_digest` |
| 12 | `api/src/auth.py:106,129` | `detail=f"Token inválido: {e}"` filtra mensajes de PyJWT | Mensaje genérico |
| 13 | `api/src/main.py:74-80` | CORS con `allow_credentials=True` + JWT en localStorage = posible CSRF | Documentar Bearer-only o protección CSRF |

### Bloque 5 — Dashboard / cliente

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 14 | `dashboard/lib/auth.ts` | JWT en `localStorage` = robo trivial vía XSS | Largo plazo: cookie HttpOnly. Corto: CSP estricta |
| 15 | `dashboard/app/search/page.tsx:289` | Filtros `sticky` ocupan toda la pantalla en iPhone | `showFilters` parte en `false` cuando `<lg` |
| 16 | `Header.tsx:27`, `BottomNav`, `ManualOverridePanel.tsx:155` | Áreas de toque <44px (HIG iOS) | Subir `p-2`/`py-1` a `p-3` mínimo |

### Bloque 6 — Datos y schema

| # | Archivo | Problema | Fix |
|---|---|---|---|
| 17 | `db/schema.sql:332-347` vs `db/migrations/005:81-87` | DB nueva no queda equivalente a una migrada. `cliente_existente` divergente entre 005/008 | Test de paridad en CI: `pg_dump --schema-only` cmp |
| 18 | `analyzer/src/db.py:1015-1019` | `INSERT ... %s::uuid[]` con `list[str]` → psycopg2 lo adapta como `text[]`, no `uuid[]` | Probar con KB no-vacía. Adapter explícito |
| 19 | extractor + transcriber + analyzer + api Dockerfiles | Sin `.dockerignore` → `.env`, `auth_state/`, `data/raw/` pueden entrar a la imagen | Crear `.dockerignore` por servicio |

### Bloque 7 — Otros críticos

| # | Archivo | Problema |
|---|---|---|
| 20 | `extraction.py:225,237`, `leads.py:reanalyze` | Endpoints destructivos sin role-check |
| 21 | `analyzer/src/analyzer.py:36-46` | `CHEAP_MODEL = "claude-haiku-4-5"` — verificar que ese ID exista. Si no, todo escala a Sonnet ~15× más caro |
| 22 | `docker-compose.yml:355` | Certbot renueva pero no recarga nginx. Cert expira a los 90 días |

---

## Top 15 hallazgos ALTO

**Extractor:**
- `extractor.js:265,521` — `fs.writeFileSync` bloqueante en hot-path
- `index.js:215` — Listeners zombie en cada reconnect (hasta 36)
- `database.js:117-128` — `markConversationFailed` degrada un `extracted` exitoso

**Analyzer:**
- `analyzer.py:894` — Filas `processing` zombie en path retry-pending
- `db.py:121-141` — `register_pending_leads` sin `ON CONFLICT`
- `business_hours.py` — No considera festivos colombianos
- `analyzer.py:278-281` — `longest_gap_hours` wall-clock vs `avg_response_minutes` business-hours (inconsistencia visible)

**API:**
- `ratelimit.py:10` — Rate limit por IP del socket (sin `--proxy-headers`)
- Rate limit en memoria, no Redis → con N workers el límite efectivo es ×N
- `leads.py:618` — `SELECT *` expone columnas internas
- `export.py:177-216` — Export CSV no respeta los filtros del dashboard

**Dashboard:**
- Tabla de leads sin virtualización → 4000 nodes DOM en iPhone bajo
- `Header.tsx:50-72` — Dropdown sin outside-click
- `conversation/page.tsx:163` — Doble header sticky en mobile

**Infra:**
- Sin resource limits, sin `unattended-upgrades`
- `extractor/Dockerfile`, `api/Dockerfile` corren como root

---

## Hallazgos de documentación — los 6 críticos

### 1. `README.md:13` — "whatsapp-web.js" es FALSO

Realidad: usa `@whiskeysockets/baileys`. Cambio documentado en
[ADR-0001](../adr/0001-baileys-vs-whatsapp-web-js.md).

### 2. `CONTEXT.md:20` — misma mentira + `usuario: oscar` hardcoded

Doble error: stack incorrecto + multi-usuario ya implementado
(ver [ADR-0002](../adr/0002-multi-usuario-qr-token.md)).

### 3. `README.md:25-35` — sección "Qué falta por construir" es FALSO

Lista como "POR HACER": analyzer/prompt.py, main.py, validator.py,
api/, dashboard/, nginx/, knowledge_base.py — **todos existen y
funcionan**.

### 4. `CONTEXT.md:33-63` — todos los "POR HACER" están HECHOS

Mismo problema que README. Solo `scripts/backup.sh` y
`scripts/monitor.sh` siguen pendientes.

### 5. `PLAN_CORRECCIONES.md` — ejecución parcial sin tracking

Sin marcar qué fases se completaron y cuáles parcialmente. Reorganizado
a `docs/audits/2026-04-16-auditoria-inicial.md` con estado por fase.

### 6. `README.md:38-41` — info de servidor desactualizada

Mezcla "lo planeado" con "lo desplegado". El droplet ya está en
producción (IP 165.22.14.255).

---

## Documentos faltantes con impacto

| # | Falta | Riesgo |
|---|-------|--------|
| 7 | `CHANGELOG.md` (Keep a Changelog) | Reconstruir historial cada vez |
| 8 | `docs/adr/` con 6 ADRs | Decisiones grandes sin justificación documentada |
| 9 | `docs/PRIVACIDAD.md` (Ley 1581) | **Riesgo legal**: hasta ~2,000 SMMLV de multa SIC |
| 10 | `docs/RUNBOOK.md` | Comentarios largos en docker-compose.yml haciendo el trabajo |
| 11 | `SECURITY.md` | Sin protocolo de reporte/rotación de secretos |
| 12 | `.dockerignore` en 4 servicios | Filtrado de credenciales en imágenes Docker |

> Los items 7-12 se resuelven en esta misma auditoría (ver "Estado
> documentación" abajo).

---

## Plan de remediación

### FASE 0 — STOP THE BLEEDING (1 día)

Indispensable antes de tocar el WhatsApp del cliente.

1. Backups Postgres → cron + DigitalOcean Spaces
2. Descomentar bloque HTTPS nginx + redirect 301
3. `STRICT_CONFIG=true` por default + rechazar placeholders
4. `import re` en transcriber
5. `field_validator @classmethod` en analyzer
6. `LIKE 'transitorio:%'` en analyzer
7. Aplicar `MEDIA_DELAY_MIN/MAX` realmente en extractor (es UNA línea)
8. `.dockerignore` en los 4 servicios

### FASE 1 — Resiliencia (1-2 días)

9. Certbot reload nginx tras renew
10. Resource limits (`mem_limit`/`cpus`) en docker-compose
11. Healthchecks en transcriber + analyzer
12. Usuario non-root en extractor/Dockerfile y api/Dockerfile
13. Constant-time compare + JWT error genérico
14. `ON CONFLICT` en `register_pending_leads`
15. Verificar `claude-haiku-4-5` existe (sino fallback `haiku-3-5`)

### FASE 2 — Seguridad y datos (2-3 días)

16. Rate limit con storage Redis + `--proxy-headers` uvicorn
17. Role-check en `/reanalyze`, `/jobs DELETE`, `/jobs/current`
18. SELECT explícito (no `*`) en `LeadDetail`
19. Festivos colombianos en `business_hours.py`
20. Test de paridad schema vs migraciones en CI
21. PII: política de retención + cifrado en reposo (Ley 1581 CO)

### FASE 3 — UX iPhone (1-2 días)

22. Hit areas mínimo 44px en Header, BottomNav, override
23. Filtros sticky `/search` colapsados por defecto en mobile
24. Outside-click handler en Header dropdown
25. AbortController en filtros de `/leads` y `/ghosts`
26. Virtualización tabla de leads

### FASE 4 — Costos / observabilidad (1 día)

27. Caching Redis 30-60s en `/overview`, `/product-intel`,
    `/competitors`, `/trends`
28. Persistir filtros en URL search params
29. Refactorizar `leads/[id]/page.tsx` (822 líneas) en sub-componentes

**Tiempo total estimado: 7-9 días de trabajo sostenido.** Las fases
0+1 son las que realmente bloquean el go-live con cliente real.

---

## Estado documentación (resuelto en esta sesión)

| Acción | Estado |
|--------|--------|
| Crear `LICENSE` | Hecho |
| Crear `SECURITY.md` | Hecho |
| Crear `CHANGELOG.md` (reconstruido del git log) | Hecho |
| Crear `docs/PRIVACIDAD.md` (borrador para revisión legal) | Hecho |
| Crear `docs/RUNBOOK.md` | Hecho |
| Crear `docs/CONTEXTO_NEGOCIO.md` (extraído de CONTEXT.md) | Hecho |
| Crear `docs/SCHEMA_45_CAMPOS.md` (extraído de CONTEXT.md) | Hecho |
| Crear `docs/adr/` con 6 ADRs | Hecho |
| Mover `PLAN_CORRECCIONES.md` → `docs/audits/2026-04-16-auditoria-inicial.md` | Hecho |
| Crear `docs/audits/2026-05-06-auditoria-completa.md` (este doc) | Hecho |
| Reescribir `README.md` con quickstart, tabla servicios, links a docs | Hecho |
| Reducir `CONTEXT.md` a índice corto | Hecho |
| Agregar sección "Nunca hacer" a `CLAUDE.md` | Hecho |
| Hardenear `.env.example` con placeholders inertes | Hecho |
| Docstrings de módulo en archivos Python clave | Hecho |

## Pendiente (cambios al sistema, sesión posterior)

- Todas las fases 0-4 del plan de remediación de código.
- `.dockerignore` en los 4 servicios (es config de build, va con los
  cambios de sistema).
- Validador de `.env` que rechace placeholders inertes en runtime
  (`config.py`).
