# Auditorías

Histórico de auditorías de código, seguridad y documentación del
sistema `whatsapp-audit`. Cada auditoría queda archivada con su fecha,
alcance y plan de remediación.

## Convención

- Nombre: `YYYY-MM-DD-descripcion-corta.md`
- No se editan auditorías cerradas; si hay correcciones, se crea una
  nueva auditoría que las consolida.
- El plan de remediación se marca con `✅` cuando se cierra cada fase
  y se anota el commit que la materializa.

## Índice

| Fecha | Auditoría | Estado |
|-------|-----------|--------|
| [2026-04-16](2026-04-16-auditoria-inicial.md) | Auditoría inicial — 11 fases de correcciones | Mayormente ejecutada (commits `3e668e3` … `208eaf1`) |
| [2026-05-06](2026-05-06-auditoria-completa.md) | Auditoría completa de código y documentación | Hallazgos pendientes de aplicar |

## Próximos pasos sugeridos

- Programar una auditoría trimestral (próxima: 2026-08-06).
- Después de cada migración SQL importante, una mini-auditoría de
  paridad `schema.sql ↔ migraciones`.
- Antes de cada aumento del volumen de extracción (>2000 chats nuevos
  por día), revisar rate limits del extractor.
