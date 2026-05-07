# ADR-0005 — Workflow de indexado + extracción por lotes

- Estado: **Aceptado**
- Fecha: 2026-04-26
- Autor: Carlos Manuel Jiménez Méndez
- Commit que materializa: `f5c2893 feat(extracción): workflow de indexado + lotes con daemon Redis y panel /extraccion`

## Contexto y problema

El primer flujo del extractor era *all-or-nothing*: ejecutar
`npm run extract` corría sobre **todos los chats** de una sola vez.
Con 12,000 chats:

- Si crasheaba a la mitad, perdía progreso parcial (los chats
  procesados quedaban marcados, pero el orden era no determinístico
  y nadie sabía qué faltaba).
- No se podía pausar y reanudar.
- No se podía priorizar qué chats procesar primero (los más recientes
  vs los más antiguos).
- Imposible monitorear progreso real desde el dashboard sin re-
  conectarse al teléfono.

## Decisión

Partir el extractor en **dos modos**:

### 1. `index` — descubrimiento + priorización

Recorre todos los chats, los inserta en `raw_conversations` con
`extraction_status='indexado'` y asigna un `extract_priority`
determinístico:

```sql
ROW_NUMBER() OVER (ORDER BY last_message_at DESC)
```

Soporta cutoff por fecha (`EXTRACTION_CUTOFF_DATE`) para limitar el
universo (ej. solo chats inactivos hace meses).

### 2. `extract --batch=N` — extracción por lotes

Procesa los N chats con mayor `extract_priority` que estén en estado
`'indexado'`. Marca cada uno con `'extracting'` → `'extracted'` o
`'failed'`. Es seguro reanudar: tomar los siguientes N chats sin
duplicar trabajo.

### 3. Daemon Redis (`wa:jobs`) + panel `/extraccion`

El extractor en modo daemon escucha jobs publicados por la API. El
operador desde el dashboard puede:

- Disparar un `index` nuevo.
- Disparar un `extract --batch=N` con N elegido.
- Cancelar el job actual.
- Ver progreso en vivo (histograma de chats por estado).

## Alternativas consideradas

| Opción | Por qué se descartó |
|--------|---------------------|
| All-or-nothing con resume por checkpoint | Frágil; el orden no determinístico hacía difícil saber el progreso real. |
| Cron job que dispara extract diario | No permite control manual sobre lotes. |
| Cola de mensajes con prioridad explícita por chat | Sobre-ingeniería; `extract_priority` en la tabla cumple lo mismo. |
| **Index → extract por lotes vía daemon Redis** | Elegida. Determinístico, observable, controlable desde dashboard. |

## Consecuencias

### Positivas

- Extracción reanudable y observable.
- El operador controla el ritmo (lotes de 100, 500, 1000) según cómo
  se comporta WhatsApp ese día.
- Si WhatsApp empieza a rate-limitear, se pausa el siguiente batch
  sin perder progreso.
- Determinismo: dos `index` consecutivos sobre el mismo dataset
  producen el mismo orden.

### Negativas / costos

- **Migración 009** (`009_index_workflow.sql`) introdujo la columna
  `extract_priority` y el estado `'indexado'`. No retro-compatible con
  installs viejas sin aplicar la migración.
- Doble cola de información (Redis para jobs + Postgres para estado)
  exige sincronización. Si el daemon crashea con un job en
  `'extracting'`, hay que limpiarlo manualmente o reiniciar
  (`clearOrphanCurrentJob`).
- Los CLIs `npm run index/preview/extract` y el daemon coexisten —
  es importante apagar el daemon antes de correr los CLIs (documentado).

## Notas de implementación

- Tabla: `raw_conversations.extract_priority INTEGER` con índice parcial
  `WHERE extraction_status = 'indexado'`.
- Estado nuevo: `'indexado'` agregado al CHECK de `extraction_status`.
- Cola: `wa:jobs` en Redis con TTL.
- Panel: `dashboard/app/extraccion/page.tsx`.
- API: `api/src/routers/extraction.py`.

## Referencias

- Migración: `db/migrations/009_index_workflow.sql`.
- Código del daemon: `extractor/src/index.js`.
- `docs/RUNBOOK.md` — comandos operativos exactos.
