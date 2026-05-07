# Architecture Decision Records (ADRs)

Decisiones arquitectónicas registradas. Formato:
[MADR](https://adr.github.io/madr/) (Markdown ADR), simplificado.

Cada ADR documenta **una sola decisión**, con su contexto, opciones
consideradas y consecuencias. Las decisiones aceptadas no se editan —
si cambian, se crea un ADR nuevo que **supersede** al anterior.

## Estados posibles

- **Aceptado** — la decisión está vigente y se aplica al sistema.
- **Superseded por ADR-NNNN** — reemplazada; sigue vigente en su época.
- **Deprecated** — ya no se aplica pero no fue formalmente reemplazada.
- **Propuesto** — en discusión.

## Índice

| #    | Título | Estado | Fecha |
|------|--------|--------|-------|
| [0001](0001-baileys-vs-whatsapp-web-js.md) | Migrar de whatsapp-web.js a Baileys | Aceptado | 2026-04-15 |
| [0002](0002-multi-usuario-qr-token.md) | Multi-usuario admin + QR remoto con token de un solo uso | Aceptado | 2026-04-23 |
| [0003](0003-two-pass-haiku-sonnet.md) | Two-pass Haiku (triaje) + Sonnet (análisis) en analyzer | Aceptado | 2026-04-24 |
| [0004](0004-profiles-extraction-analysis.md) | Profiles `extraction` y `analysis` en docker-compose | Aceptado | 2026-04-23 |
| [0005](0005-workflow-indexado-lotes.md) | Workflow de indexado + extracción por lotes | Aceptado | 2026-04-26 |
| [0006](0006-schema-vs-migraciones.md) | `schema.sql` como fuente de verdad + migraciones idempotentes | Aceptado | 2026-04-16 |
| [0007](0007-licenciamiento-cesion-revocable.md) | Licenciamiento como cesión de uso revocable, no venta | Aceptado | 2026-05-06 |

## Cuándo escribir un ADR

Cualquiera de:

- Una decisión que afecta a más de un módulo del sistema.
- Una decisión que requirió descartar alternativas serias.
- Una decisión que costaría tiempo o dinero revertir.
- Una decisión que un futuro mantenedor (o vos mismo en 6 meses) va a
  cuestionar sin recordar el porqué.

## Cuándo NO escribir un ADR

- Cambios de implementación que no alteran la interfaz.
- Bugfixes.
- Refactors internos.
- Decisiones triviales o de gusto personal.

## Plantilla nueva

Copiar [`0000-template.md`](0000-template.md) y renombrarlo, o usar:

```markdown
# ADR-NNNN — Título imperativo

- Estado: Propuesto / Aceptado / Superseded por ADR-MMMM
- Fecha: YYYY-MM-DD
- Autor: Carlos Manuel Jiménez Méndez

## Contexto y problema

## Decisión

## Alternativas consideradas

## Consecuencias

### Positivas

### Negativas / costos
```
