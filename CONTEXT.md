# CONTEXT.md

> **Este archivo cambió de propósito.** Antes era un documento largo
> que mezclaba motivación, restricciones, schema técnico y plan de
> trabajo. Esa información se partió en documentos especializados
> siguiendo el framework Diátaxis.

## Si querés saber...

| Pregunta | Documento |
|----------|-----------|
| ¿Qué problema resuelve este sistema? ¿Quién paga? ¿Qué restricciones tiene? | [`docs/CONTEXTO_NEGOCIO.md`](docs/CONTEXTO_NEGOCIO.md) |
| ¿Cuál es el contrato de los 45+ campos del analyzer? | [`docs/SCHEMA_45_CAMPOS.md`](docs/SCHEMA_45_CAMPOS.md) |
| ¿Cómo arranco el sistema, escaneo el QR, hago una extracción, restauro un backup? | [`docs/RUNBOOK.md`](docs/RUNBOOK.md) |
| ¿Por qué se tomó la decisión X? | [`docs/adr/`](docs/adr/) |
| ¿Cómo se manejan los datos personales? | [`docs/PRIVACIDAD.md`](docs/PRIVACIDAD.md) |
| ¿Qué cambió en cada release? | [`CHANGELOG.md`](CHANGELOG.md) |
| ¿Cómo se reporta una vulnerabilidad? | [`SECURITY.md`](SECURITY.md) |
| Quickstart técnico | [`README.md`](README.md) |
| Guía para Claude Code | [`CLAUDE.md`](CLAUDE.md) |

## Por qué se mantiene este archivo

Algunas memorias del agente Claude (`MEMORY.md` del usuario) y
auditorías históricas referencian `CONTEXT.md` por ruta. Mantenerlo
como índice evita romper esos enlaces y deja claro el camino al lector
nuevo.

Cuando todas las referencias externas se actualicen, este archivo se
puede eliminar.
