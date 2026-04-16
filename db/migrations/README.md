# Migraciones

`schema.sql` se ejecuta automáticamente al crear el volumen de Postgres.
**Instalaciones nuevas NO necesitan aplicar ninguna migración manualmente.**

## Cuándo aplicar

Las migraciones en `archive/` solo aplican a despliegues **previos al 2026-04-16**
que ya tienen datos en Postgres y no pueden wipear el volumen.

Se aplican una sola vez, en orden, con:

```bash
docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
  < db/migrations/archive/001_widen_varchar_enums.sql
docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
  < db/migrations/archive/002_reassert_enum_checks.sql
```

Son idempotentes — aplicarlas de nuevo no rompe nada.

## Migración 003 (lead_analysis_history)

**Ya integrada a `schema.sql`** — no existe como archivo separado. Si tienes
una instalación vieja sin esta tabla y NO quieres wipear el volumen:

```bash
docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit -c "
CREATE TABLE IF NOT EXISTS lead_analysis_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    triggered_by VARCHAR(50) DEFAULT 'auto',
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    model_used VARCHAR(100),
    cost_usd DECIMAL(10, 6),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    diff_summary TEXT,
    raw_output JSONB
);
CREATE INDEX IF NOT EXISTS idx_lah_lead_id ON lead_analysis_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_lah_started_at ON lead_analysis_history(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lah_status ON lead_analysis_history(status);
"
```

## Nueva migración

Si necesitas una nueva migración (proyecto en prod, no se puede wipear):

1. Crea `db/migrations/NNN_descripcion.sql` (NNN = siguiente número).
2. Hazla **idempotente** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.).
3. Aplícala: `docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit < db/migrations/NNN_descripcion.sql`.
4. Copia el mismo cambio a `db/schema.sql` para que instalaciones limpias ya la tengan.
