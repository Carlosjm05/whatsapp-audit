# Migraciones

`db/schema.sql` se ejecuta automáticamente al crear el volumen de
Postgres. **Instalaciones nuevas NO necesitan aplicar ninguna
migración manualmente.**

Ver [ADR-0006](../../docs/adr/0006-schema-vs-migraciones.md) para
el modelo: `schema.sql` es la fuente de verdad y las migraciones
existen para llevar instalaciones viejas al estado actual sin perder
datos.

## Estructura del directorio

```
db/migrations/
├── README.md                          (este archivo)
├── 004_prompt_v2_fields.sql           Aplican a despliegues anteriores
├── 005_qr_users_override.sql          al 2026-04-23 que tienen datos
├── 006_business_hours.sql             y no pueden hacer wipe del volumen.
├── 007_indexes_perf.sql               Ya están integradas a schema.sql.
├── 008_cliente_existente.sql
├── 009_index_workflow.sql
└── archive/
    ├── 001_widen_varchar_enums.sql    Migraciones legacy.
    └── 002_reassert_enum_checks.sql   Solo aplican a installs muy viejos.
```

La migración 003 (`lead_analysis_history`) ya fue absorbida
totalmente al `schema.sql`. No existe como archivo.

## Cuándo aplicar las migraciones 004-009

Solo si tu instalación de Postgres tiene **datos reales** que no podés
perder y fue creada **antes** de la fecha de la migración correspondiente.
Para una instalación fresca, `schema.sql` ya las incluye.

```bash
# Aplicar una migración específica
docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
  < db/migrations/004_prompt_v2_fields.sql
```

## Cuándo aplicar las del archive

`archive/001` y `archive/002` solo aplican a despliegues **previos al
2026-04-16**. Son legacy. Una install nueva nunca necesita correrlas.

```bash
docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
  < db/migrations/archive/001_widen_varchar_enums.sql
```

## Idempotencia

Todas las migraciones del directorio raíz son **idempotentes**
(`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`DROP CONSTRAINT IF EXISTS`, etc.). Aplicarlas dos veces no rompe.

> **Cuidado con el orden**: la auditoría 2026-05-06 detectó que
> aplicar `005` después de `008` puede dejar la DB en un estado
> inconsistente con `cliente_existente` en `manual_status`. Aplicar
> SIEMPRE en orden numérico ascendente. Si dudás, hacé un dump antes:
>
> ```bash
> docker compose exec postgres pg_dump -U wa_admin whatsapp_audit \
>   | gzip > /tmp/wa_$(date +%Y%m%d_%H%M).sql.gz
> ```

## Crear una migración nueva

Cuando agregás funcionalidad nueva que toca el schema:

1. Crear `db/migrations/NNN_descripcion.sql` con `NNN` = siguiente
   número (010, 011…).
2. Hacerla **idempotente**:
   - `CREATE TABLE IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - `DROP CONSTRAINT IF EXISTS` antes de re-emitir un CHECK
3. Aplicarla en producción (con backup previo):
   ```bash
   docker compose exec -T postgres psql -U wa_admin -d whatsapp_audit \
     < db/migrations/NNN_descripcion.sql
   ```
4. **Copiar el mismo cambio a `db/schema.sql`** para que installs
   limpios ya lo tengan integrado.
5. Agregar entrada al `CHANGELOG.md`.

## Test de paridad (recomendado, no implementado todavía)

Para evitar drift entre `schema.sql` y la cadena de migraciones,
sería ideal tener un test en CI que:

1. Levante un Postgres limpio con solo `schema.sql`.
2. Levante otro con un dump pre-004 + `archive/*.sql + 004..009`
   secuenciales.
3. Compare `pg_dump --schema-only` de ambos. Falla si difieren.

Sin este test, la disciplina humana es la única garantía. Ver
ADR-0006 sección "Negativas / costos".
