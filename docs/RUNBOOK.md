# Runbook operativo — whatsapp-audit

Procedimientos paso a paso para operar el sistema en producción y en
desarrollo. Cuando algo se rompe o cuando hay que correr una operación
puntual, este es el primer documento que se lee.

> **Principio rector**: validar siempre con el WhatsApp del
> desarrollador antes de tocar el del cliente.

---

## Tabla de contenidos

- [Primer arranque desde cero](#primer-arranque-desde-cero)
- [Conectar / re-conectar el QR de WhatsApp](#conectar--re-conectar-el-qr-de-whatsapp)
- [Workflow de extracción por lotes](#workflow-de-extracción-por-lotes)
- [CLI manual del extractor (sin daemon)](#cli-manual-del-extractor-sin-daemon)
- [Disparar análisis](#disparar-análisis)
- [Disparar reanalyze masivo](#disparar-reanalyze-masivo)
- [Recomputar métricas SLA](#recomputar-métricas-sla)
- [Backups y restore](#backups-y-restore)
- [Aplicar migraciones de DB](#aplicar-migraciones-de-db)
- [Logs y troubleshooting](#logs-y-troubleshooting)
- [Rotación de secretos](#rotación-de-secretos)

---

## Primer arranque desde cero

```bash
# 1. Clonar el repo en el servidor
git clone <repo-url> /opt/whatsapp-audit
cd /opt/whatsapp-audit

# 2. Bootstrap del servidor (Ubuntu 24.04, una sola vez, como root)
./setup.sh

# 3. Configurar .env
cp .env.example .env
nano .env
# Llenar TODOS los placeholders. STRICT_CONFIG=true en producción.

# 4. Levantar dependencias primero
docker compose up -d postgres redis

# 5. Verificar que postgres ejecutó schema.sql
docker compose logs postgres | grep "database system is ready"

# 6. Levantar API + dashboard + nginx
docker compose up -d

# 7. Crear usuario admin del dashboard
docker compose exec api python -m src.cli_users create <usuario> <password>

# 8. Verificar healthchecks
docker compose ps
# Todos los servicios deben estar (healthy) excepto extractor/analyzer
# que están bajo profiles y no auto-arrancan.
```

A partir de aquí, el extractor y el analyzer se activan según
necesidad (siguientes secciones).

---

## Conectar / re-conectar el QR de WhatsApp

### Caso A: el desarrollador está físicamente con el teléfono

```bash
# 1. Apagar el daemon si estaba corriendo
docker compose stop extractor

# 2. Borrar la sesión vieja si es un cambio de número
docker compose run --rm extractor rm -rf /app/auth_state/*

# 3. Arrancar en modo CLI para ver el QR en consola
docker compose run --rm extractor npm run test-connection

# 4. Escanear con el teléfono
# 5. Ctrl-C cuando vea "conectado"
# 6. Levantar el daemon
docker compose --profile extraction up -d extractor
```

### Caso B: QR remoto (cliente escanea desde su iPhone)

```bash
# 1. Desde el dashboard, ir al panel /conexion
# 2. Click en "Generar link de QR"
# 3. Copiar la URL https://audit.../escanear/<token>
# 4. Enviársela al cliente por WhatsApp / SMS
# 5. Cliente abre el link en su celular y escanea el QR mostrado
# 6. El extractor publica "conectado" al panel
```

> **Cuidado**: el token es de un solo uso. Si el cliente abre el link
> desde una app que pre-fetchea (Slack, vista previa de mensajes), el
> token se quema y hay que generar uno nuevo.

---

## Workflow de extracción por lotes

Diseñado para los 12,000 chats del cliente. Ver
[ADR-0005](adr/0005-workflow-indexado-lotes.md) para el contexto.

### Paso 1 — Index (descubrimiento + priorización)

Recorre todos los chats y los marca como `'indexado'` con un
`extract_priority` determinístico (más recientes primero).

**Desde el dashboard**: panel `/extraccion` → botón "Indexar".

**Desde CLI** (apagar el daemon primero):
```bash
docker compose stop extractor
docker compose run --rm extractor npm run index
```

### Paso 2 — Preview (opcional)

Ver qué se va a extraer sin tocar nada:
```bash
docker compose run --rm extractor npm run preview
```

### Paso 3 — Extract por lotes

```bash
# Desde dashboard: panel /extraccion → "Extraer N chats" con N elegido
# Desde CLI:
docker compose run --rm extractor npm run extract -- --batch=500
```

Lotes recomendados:
- **100-200** la primera vez (validar comportamiento de WhatsApp).
- **500-1000** una vez confirmado que no hay rate-limit anormal.
- **Nunca** correr `--batch=0` (ilimitado) en producción.

### Filtro por fecha

Para procesar solo chats inactivos hace tiempo:
```bash
EXTRACTION_CUTOFF_DATE=2026-03-20 docker compose run --rm extractor npm run index
```

Solo se indexan chats con `last_message_at <= 2026-03-20` (hora Bogotá,
inclusivo).

---

## CLI manual del extractor (sin daemon)

Cuando se necesita ejecutar algo puntual sin levantar el daemon:

```bash
# Apagar el daemon primero (si está corriendo)
docker compose stop extractor

# Operaciones disponibles
docker compose run --rm extractor npm run test-connection   # verificar conexión
docker compose run --rm extractor npm run stats             # estadísticas
docker compose run --rm extractor npm run index             # descubrir chats
docker compose run --rm extractor npm run preview           # vista previa
docker compose run --rm extractor npm run extract           # extraer todo
docker compose run --rm extractor npm run extract -- --batch=N
docker compose run --rm extractor npm run extract -- --before=YYYY-MM-DD

# Cuando termine, volver a levantar el daemon
docker compose --profile extraction up -d extractor
```

---

## Disparar análisis

El analyzer está bajo profile `analysis` y **no auto-arranca**. Ver
[ADR-0004](adr/0004-profiles-extraction-analysis.md).

### Activar el daemon

```bash
docker compose --profile analysis up -d analyzer
docker compose logs -f analyzer
```

El daemon procesa todos los leads `analysis_status='pending'` que
encuentre, en lotes de `ANALYZER_WORKERS` (default 2 paralelos).

### Detener el daemon

```bash
docker compose stop analyzer
```

### Ver costos en vivo

Panel `/extraccion` o `/overview` muestra el costo acumulado por mes
(input tokens + output tokens + cache).

---

## Disparar reanalyze masivo

Cuando se cambia el prompt o se descubre un bug en el analyzer y hay
que re-procesar leads ya analizados.

### Desde el dashboard (un lead a la vez)

Panel `/leads/<id>` → botón "Reanalizar".

### Masivo desde DB (con cuidado)

```sql
-- Marcar todos los leads como pending (cuidado: gasta plata)
UPDATE leads SET analysis_status = 'pending', analysis_error = NULL
WHERE analysis_status IN ('completed', 'failed');

-- Solo los failed
UPDATE leads SET analysis_status = 'pending'
WHERE analysis_status = 'failed';

-- Solo los analizados antes de cierta fecha
UPDATE leads SET analysis_status = 'pending'
WHERE analyzed_at < '2026-04-20';
```

Después arrancar el daemon: `docker compose --profile analysis up -d analyzer`.

> **Costo estimado**: ~$0.05-0.15 USD por lead (Sonnet 4.5 con cache).
> 12,000 leads ≈ $600-1800 USD. **Confirmar con el cliente antes**.

---

## Recomputar métricas SLA

Cuando se ajustan umbrales de tiempo de respuesta o se corrige un bug
en el cálculo:

```bash
docker compose exec api python -m analyzer.src.recompute_metrics
```

Usa `pg_try_advisory_xact_lock` para evitar conflicto con el daemon
del analyzer.

---

## Backups y restore

> **Estado actual**: el script de backup automático **no está
> implementado todavía**. Ver `docs/audits/2026-05-06-auditoria-completa.md`
> hallazgo CRÍTICO #1.

### Backup manual ad-hoc

```bash
# Dump de la DB completa
docker compose exec postgres pg_dump -U wa_admin whatsapp_audit \
  | gzip > /tmp/wa_audit_$(date +%Y%m%d_%H%M).sql.gz

# Copiar fuera del servidor (S3 / Spaces / scp local)
scp /tmp/wa_audit_*.sql.gz user@backup-host:/path/

# Backup del volumen extractor_session (sesión Baileys)
docker run --rm -v whatsapp-audit_extractor_session:/data \
  -v /tmp:/backup alpine tar czf /backup/auth_state.tar.gz /data
```

### Restore desde backup

```bash
# 1. Apagar todo
docker compose down

# 2. Wipe del volumen (DESTRUCTIVO)
docker volume rm whatsapp-audit_postgres_data

# 3. Levantar postgres limpio (carga schema.sql automáticamente)
docker compose up -d postgres
docker compose logs postgres | grep "database system is ready"

# 4. Restaurar el dump
gunzip < /tmp/wa_audit_YYYYMMDD.sql.gz \
  | docker compose exec -T postgres psql -U wa_admin whatsapp_audit

# 5. Levantar el resto
docker compose up -d
```

---

## Aplicar migraciones de DB

Ver `db/migrations/README.md` para el contexto. En instalaciones
existentes que no se pueden wipear:

```bash
docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
  < db/migrations/NNN_descripcion.sql
```

Las migraciones del repo son **idempotentes** (`CREATE ... IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, etc.). Aplicar la misma migración dos veces
no debería romper.

---

## Logs y troubleshooting

```bash
# Logs en vivo
docker compose logs -f api
docker compose logs -f extractor
docker compose logs -f analyzer
docker compose logs -f --tail=100 dashboard

# Ver últimos errores de un servicio
docker compose logs api 2>&1 | grep -i error | tail -20

# Estado de los healthchecks
docker compose ps

# Stats de uso de recursos
docker stats --no-stream
```

### Síntomas comunes

| Síntoma | Probable causa | Qué revisar |
|---------|----------------|-------------|
| Dashboard muestra "Network Error" | API caída | `docker compose logs api`, `docker compose restart api` |
| Login retorna 500 | DB caída o pool agotado | Logs de postgres, `docker compose ps` |
| Extractor queda en "indexando" sin avanzar | Sesión Baileys expiró | Re-escanear QR (sección arriba) |
| Analyzer no procesa pending | Daemon no levantado o rate-limit Anthropic | Logs analyzer, balance de la cuenta Anthropic |
| Dashboard sin datos | DB vacía o credenciales mal | Login en el dashboard, `\dt` en psql |
| QR no aparece | Sesión existente válida | Borrar `auth_state/*` solo si se quiere cambiar de número |

---

## Rotación de secretos

Ver [`SECURITY.md`](../SECURITY.md) sección "Política de rotación".

```bash
# Ejemplo: rotar JWT_SECRET
NEW=$(openssl rand -hex 64)
ssh root@<droplet> "sed -i 's/^JWT_SECRET=.*/JWT_SECRET=$NEW/' /opt/whatsapp-audit/.env"
ssh root@<droplet> "cd /opt/whatsapp-audit && docker compose up -d --force-recreate api"
# Avisar a usuarios que vuelvan a iniciar sesión
```

---

## Apagar el sistema temporalmente

```bash
# Apagar manteniendo datos
docker compose down

# Apagar TODO incluyendo volúmenes (DESTRUCTIVO — pérdida total de datos)
# Solo en dev. Confirmar dos veces antes de correrlo en prod.
docker compose down -v
```

---

## Comandos prohibidos en producción

- `docker compose down -v` → wipe de DB y sesión Baileys.
- `git push --force` a `main` → puede sobrescribir cambios del deploy.
- `rm -rf data/` → borra audios crudos (no hay backup).
- Bajar `EXTRACTION_DELAY_*` o `MEDIA_DELAY_*` → riesgo de ban.
- `docker compose --profile extraction up` mientras el daemon ya corre
  → race conditions en la cola Redis.

---

## Procedimiento de revocación de la licencia

Solo aplica si el Autor decide revocar el acceso del cliente al
Sistema (ver `LICENSE` sección 6 y
[ADR-0007](adr/0007-licenciamiento-cesion-revocable.md)).

### Paso 1 — Notificación formal

Enviar un mensaje al cliente por WhatsApp **y** correo, dejando
constancia escrita:

```
Asunto: Revocación de licencia de uso del sistema whatsapp-audit

Por medio del presente, en mi calidad de autor y titular único de los
derechos de propiedad intelectual sobre el sistema "whatsapp-audit",
informo formalmente la revocación de la licencia de uso descrita en
el documento LICENSE, conforme a su sección 6.

Fecha efectiva de revocación: <hoy + 5 días calendario>.

A partir de esa fecha procederé a:
  - Detener los servicios técnicos.
  - Retirar del servidor el código fuente y componentes propietarios.
  - Revocar las credenciales de despliegue.

Ortiz Finca Raíz conservará la base de datos PostgreSQL con los
registros de su negocio. Perderá el acceso al dashboard y al motor
de análisis.

Quedo a disposición durante el periodo de preaviso para coordinar
la transición ordenada.

Cordialmente,
Carlos Manuel Jiménez Méndez
WhatsApp: +57 302 439 6752
Correo: carlitos05203rules@gmail.com
```

Archivar **comprobante de envío** (captura de WhatsApp + reenvío del
correo a uno mismo).

### Paso 2 — Backup final del estado actual

Antes de retirar nada, hacer backup completo por si surge una
controversia y hay que demostrar el estado entregado:

```bash
ssh root@<droplet-ip>
cd /opt/whatsapp-audit

# Dump completo de la DB
docker compose exec postgres pg_dump -U wa_admin whatsapp_audit \
  | gzip > /tmp/wa_audit_FINAL_$(date +%Y%m%d).sql.gz

# Tarball del repo entero (código que se va a retirar)
tar czf /tmp/whatsapp-audit-CODE_$(date +%Y%m%d).tar.gz \
  --exclude='data' --exclude='node_modules' --exclude='.next' \
  /opt/whatsapp-audit

# Bajar ambos archivos a tu máquina personal
scp root@<droplet-ip>:/tmp/wa_audit_FINAL_*.sql.gz ~/backups-clientes/ortiz/
scp root@<droplet-ip>:/tmp/whatsapp-audit-CODE_*.tar.gz ~/backups-clientes/ortiz/
```

### Paso 3 — Apagar servicios

```bash
ssh root@<droplet-ip>
cd /opt/whatsapp-audit
docker compose down
```

### Paso 4 — Retirar código propietario

Borrar todo el repositorio del servidor, dejando solo lo que es del
cliente (la DB y sus volúmenes).

```bash
# Conservar SOLO los volúmenes Docker que tienen datos del cliente
# Los volúmenes están en /var/lib/docker/volumes/ y NO se borran.

# Borrar el repositorio del Sistema
cd /opt
rm -rf /opt/whatsapp-audit

# Confirmar que los volúmenes con datos siguen ahí
docker volume ls | grep -E 'postgres_data|extractor_session'
# postgres_data       → datos del cliente, se conservan
# extractor_session   → sesión Baileys, se puede borrar también si querés
```

### Paso 5 — Revocar credenciales

```bash
# Revocar tu llave SSH del root del droplet
nano /root/.ssh/authorized_keys
# Borrar la línea con tu llave pública

# Revocar las API keys que vos pagás
# Ir a console.anthropic.com → revocar la key
# Ir a platform.openai.com → revocar la key

# Si la cuenta de DigitalOcean estaba con tu email como colaborador,
# salir como colaborador desde el panel de DigitalOcean
```

### Paso 6 — Documentar

En tu archivo personal de proyectos cerrados, registrar:
- Fecha de revocación
- Motivo (resumen)
- Archivos de backup guardados (paths)
- Estado de las credenciales (revocadas)

### Qué hacer si el cliente pide volver a activar

- **Antes** de la fecha efectiva de revocación: simplemente cancelar
  la notificación enviando otro correo formal "se anula la
  revocación del <fecha>".
- **Después** de la fecha efectiva: nueva conversación comercial,
  posiblemente con nuevos términos. Restaurar desde el backup
  guardado en el Paso 2.

### Riesgos a mitigar antes de revocar

| Riesgo | Mitigación |
|--------|------------|
| El cliente niega haber recibido el preaviso | Comprobante de WhatsApp + correo |
| El cliente bloquea tu acceso SSH antes de Paso 4 | Revocar dentro del periodo de preaviso, no al final |
| El cliente intenta extraer el código tras la revocación | Retiraste todo el código del servidor en Paso 4 |
| Pérdida del código por error operativo | Backup tarball del Paso 2 |
| Disputa por datos personales (Ley 1581) | El cliente conservó su DB → es Responsable, no hay reclamo válido |
