# ADR-0002 — Multi-usuario admin + QR remoto con token de un solo uso

- Estado: **Aceptado**
- Fecha: 2026-04-23
- Autor: Carlos Manuel Jiménez Méndez
- Commit que materializa: `25e522a feat: QR remoto + multi-usuario + override manual + costos + daemon analyzer`

## Contexto y problema

El diseño inicial asumía un único usuario admin (`oscar`) con
contraseña en `.env`. Esto tenía dos limitaciones serias:

1. **Operación**: para escanear el QR de Baileys había que tener el
   teléfono del cliente físicamente cerca del servidor o del
   desarrollador. Imposible si el extractor se reconecta los fines de
   semana.
2. **Trazabilidad**: cualquier acción en el dashboard (override
   manual, reanalyze, borrado de cola) quedaba registrada como
   "admin" sin distinguir quién la hizo.

## Decisión

Implementar dos cambios complementarios:

1. **Tabla `admin_users`** en la base de datos con `username`,
   `password_hash` (bcrypt), `role`, `is_active`. El env `ADMIN_USER`
   / `ADMIN_PASSWORD` queda como **fallback** para no romper
   despliegues existentes.
2. **QR remoto con token de un solo uso**: el operador genera un link
   `https://audit.../escanear/<token>` con TTL corto desde el panel
   `/conexion`; el cliente abre el link en su celular y escanea el QR
   directamente sin que el operador toque su teléfono.

## Alternativas consideradas

| Opción | Por qué se descartó |
|--------|---------------------|
| Mantener single-user `.env` | No soluciona el problema operativo del QR remoto, ni la trazabilidad. |
| OAuth con Google Workspace | Sobre-ingeniería para un equipo de 1 desarrollador + 1 cliente. Costo de implementación > beneficio. |
| Magic links por email | Latencia y dependencia de proveedor SMTP. Token QR de un solo uso cumple lo mismo en menos pasos. |
| **Admin users + QR token** | Elegida. Soluciona ambos problemas con código mínimo y sin dependencias nuevas. |

## Consecuencias

### Positivas

- Cliente puede escanear el QR desde su iPhone sin compartir credenciales.
- Trazabilidad por usuario en futuras auditorías (logs incluyen el
  `username`).
- Compatibilidad hacia atrás: el env user-pass sigue funcionando para
  el desarrollador.

### Negativas / costos

- Migración 005 (`db/migrations/005_qr_users_override.sql`) introdujo
  inconsistencia con `final_status` que requirió la migración 008 para
  resolver. Documentado en
  [ADR-0006](0006-schema-vs-migraciones.md) y la auditoría 2026-05-06.
- Los tokens QR son single-use con TTL — si el cliente abre el link
  desde una app que pre-fetchea (Slack, WhatsApp), el token se quema.
  Mitigación: el endpoint `/api/qr/public/{token}` devuelve mensajes
  diferenciados pero **leakea existencia del token** (ver auditoría
  2026-05-06 hallazgo #9).

## Notas de implementación

- CLI `python -m api.src.cli_users` para crear/desactivar usuarios.
- bcrypt directo (sin `passlib`) por incompatibilidad con `bcrypt 4.x`
  (commit `8931499`).
- Endpoint público `/api/qr/public/{token}` con rate limit 30/min.

## Referencias

- Migraciones: `005_qr_users_override.sql`, `008_cliente_existente.sql`.
- Routers: `api/src/routers/qr.py`, `api/src/auth.py`,
  `api/src/cli_users.py`.
- Dashboard: `dashboard/app/conexion/page.tsx`,
  `dashboard/app/escanear/[token]/page.tsx`.
