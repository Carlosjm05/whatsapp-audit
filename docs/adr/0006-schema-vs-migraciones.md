# ADR-0006 — `schema.sql` como fuente de verdad + migraciones idempotentes

- Estado: **Aceptado**
- Fecha: 2026-04-16
- Autor: Carlos Manuel Jiménez Méndez
- Commit que materializa: `6fa1459 feat(db): integrar migraciones, limpiar tablas muertas, indices (Fase 3)`

## Contexto y problema

El proyecto NO usa una herramienta de migraciones formal (Alembic,
Flyway, Liquibase). Las opciones son:

1. **`schema.sql` reflejando el estado final** + scripts manuales para
   instalaciones existentes que no pueden wipear el volumen.
2. **Migraciones numeradas** que se aplican secuencialmente desde un
   estado base.

Postgres con Docker carga automáticamente cualquier `.sql` en
`/docker-entrypoint-initdb.d/` al crear el volumen. Eso favorece la
opción 1 para instalaciones nuevas.

## Decisión

**Combinar ambos enfoques**:

- `db/schema.sql` es la **fuente de verdad** del estado actual.
  Cualquier instalación nueva (`docker compose down -v && up`) queda
  equivalente a una con todas las migraciones aplicadas.
- `db/migrations/NNN_*.sql` son **scripts idempotentes** que sirven
  para llevar instalaciones viejas al estado actual sin wipear datos.
- `db/migrations/archive/` contiene migraciones cuya integración a
  `schema.sql` ya se hizo (legacy, solo para installs anteriores a
  cierta fecha).

Toda migración nueva debe aplicar este flujo:

1. Crear `db/migrations/NNN_descripcion.sql` con `IF NOT EXISTS` /
   `IF EXISTS` para idempotencia.
2. Aplicarla al servidor de producción (`docker compose exec ...`).
3. **Copiar el mismo cambio al `db/schema.sql`** para que installs
   limpios ya lo tengan.

## Alternativas consideradas

| Opción | Por qué se descartó |
|--------|---------------------|
| Solo `schema.sql`, ninguna migración | No retro-compatible. Una install vieja exige wipe → pérdida de datos. |
| Solo migraciones (Alembic / Flyway) | Sobre-ingeniería para 1 desarrollador + 1 cliente. Agrega dependencia y curva de aprendizaje. |
| **`schema.sql` + migraciones idempotentes manuales** | Elegida. Cubre los dos casos sin agregar herramientas. |

## Consecuencias

### Positivas

- Install nuevo es **un comando**: `docker compose up -d postgres` y
  todo el schema queda listo.
- Migraciones existen para upgrades en caliente sin perder datos.
- No hay dependencia adicional ni curva de aprendizaje.

### Negativas / costos

- **Riesgo de drift**: si una migración no se copia a `schema.sql`,
  installs nuevos pierden el cambio. La auditoría 2026-05-06 detectó
  este caso con `final_status` y `cliente_existente` (mig 005 vs 008
  desincronizadas con schema).
- **Riesgo de orden**: re-aplicar migraciones fuera de secuencia puede
  romper estados. La 005 + 008 son un ejemplo: aplicar 008 y luego
  re-aplicar 005 deja la DB en estado viejo.
- Sin script automatizado que verifique paridad — la garantía depende
  de la disciplina del desarrollador.

## Mitigaciones recomendadas (no implementadas todavía)

1. **Test de paridad en CI**: levantar dos Postgres (uno con
   `schema.sql` solo, otro con `archive/*.sql + migraciones/*.sql`
   secuenciales sobre un dump base). Comparar
   `pg_dump --schema-only`. Falla si difieren.
2. **Convención**: cada migración nueva debe venir con una entrada en
   `CHANGELOG.md` y un comentario `-- ya integrada a schema.sql YYYY-MM-DD`
   al pie de la migración cuando se completa la integración.

## Referencias

- `db/migrations/README.md` — instrucciones operativas.
- `db/schema.sql` — estado actual.
- Auditoría 2026-05-06 sección DB hallazgos #1, #2, #3.
