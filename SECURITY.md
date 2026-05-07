# Política de seguridad

Este documento describe cómo se gestionan los aspectos de seguridad del
sistema `whatsapp-audit` (auditoría de WhatsApp para Ortiz Finca Raíz).

> **Cliente único, software propietario.** No es un proyecto OSS — los
> reportes públicos no aplican. Las vulnerabilidades se gestionan
> internamente entre el Autor (Carlos Manuel Jiménez Méndez) y el
> responsable del tratamiento de datos (Oscar Ortiz, Ortiz Finca Raíz).

## Contacto del Autor

    Carlos Manuel Jiménez Méndez
    WhatsApp: +57 302 439 6752
    Correo:   carlitos05203rules@gmail.com

Es el único canal autorizado para asuntos técnicos y de seguridad.

## Reportar una vulnerabilidad

Si descubrís una vulnerabilidad en el sistema:

1. **No abras un issue público de GitHub.** El repositorio es privado,
   pero la regla aplica igual.
2. Notificá por canal directo al Autor (WhatsApp o correo, ver arriba).
3. Incluí: descripción del problema, pasos para reproducir, archivo y
   línea afectados, impacto estimado.

Tiempos de respuesta esperados:

| Severidad | Reconocimiento | Mitigación inicial | Solución |
|-----------|----------------|--------------------|----------|
| Crítica   | <4h            | <24h               | <72h     |
| Alta      | <24h           | <72h               | <2 sem   |
| Media     | <3 días        | <2 sem             | siguiente release |
| Baja      | <1 sem         | best-effort        | best-effort |

**Crítica** = exposición de datos personales de leads, robo de tokens
JWT activos, RCE en cualquier servicio, ban del WhatsApp del cliente,
pérdida total de datos.

## Modelo de amenazas resumido

| Vector | Riesgo | Mitigación |
|--------|--------|------------|
| Filtración de credenciales en repo | Alto | `.gitignore` con `.env`, hooks de pre-commit, secret scanning |
| Compromiso de cuenta WhatsApp del cliente | Catastrófico | Rate limits load-bearing, sesión en volumen aislado, validación con WhatsApp del dev primero |
| Robo de JWT vía XSS en dashboard | Medio | CSP estricta, sanitización en JSX, auditoría de `dangerouslySetInnerHTML` |
| SQL injection en API | Bajo | Todas las queries parametrizadas, allowlists para nombres dinámicos |
| Compromiso del servidor (RCE) | Alto | Containers no-root (donde aplica), UFW + Fail2ban, kernel parchado, SSH key-only |
| Filtración masiva de PII | Catastrófico (Ley 1581) | Cifrado en reposo, retención limitada, política documentada (`docs/PRIVACIDAD.md`) |
| Hijacking de la sesión Baileys | Alto | Volumen `extractor_session` aislado, no expuesto a internet, no entra a la imagen Docker |

## Secretos y rotación

Los secretos críticos del sistema están en `.env` (nunca commiteado):

- `POSTGRES_PASSWORD` — base de datos
- `REDIS_PASSWORD` — cola de jobs
- `OPENAI_API_KEY` — Whisper
- `ANTHROPIC_API_KEY` — Claude
- `JWT_SECRET` — firma de tokens del dashboard
- `ADMIN_PASSWORD` — cuenta admin del dashboard

### Política de rotación recomendada

| Secreto | Frecuencia | Cuando se sospecha compromiso |
|---------|-----------|-------------------------------|
| `JWT_SECRET` | cada 90 días | inmediato (invalida todos los JWT activos) |
| `ADMIN_PASSWORD` | cada 90 días | inmediato |
| `POSTGRES_PASSWORD` / `REDIS_PASSWORD` | cada 6 meses | inmediato (requiere reinicio de servicios) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | cuando lo dicte el provider | inmediato (revocar en consola del provider) |

### Procedimiento de rotación de `JWT_SECRET`

```bash
# 1. Generar nuevo secreto
openssl rand -hex 64

# 2. Actualizar .env en el servidor
ssh root@<droplet> 'cd /opt/whatsapp-audit && nano .env'

# 3. Reiniciar la API (todos los JWT vigentes quedan inválidos)
docker compose up -d --force-recreate api

# 4. Avisar a los usuarios que vuelvan a iniciar sesión
```

## Qué nunca hacer (load-bearing)

- **Nunca** commitear `.env`, `auth_state/`, `data/raw/` o cualquier archivo
  con datos reales de leads.
- **Nunca** bajar los rate limits del extractor (`EXTRACTION_DELAY_*`,
  `MEDIA_DELAY_*`) sin entender el riesgo de ban.
- **Nunca** correr `docker compose down -v` en el servidor de producción
  sin un backup verificado.
- **Nunca** usar el WhatsApp de Oscar para probar cambios — siempre validar
  primero con el WhatsApp del desarrollador.
- **Nunca** habilitar la API o el dashboard en HTTP plano en producción —
  es vector trivial de robo de credenciales.
- **Nunca** subir secretos a archivos `NEXT_PUBLIC_*` (se inlinean al
  bundle del cliente).

## Auditorías

Las auditorías de seguridad/código se almacenan en `docs/audits/`. Cada
auditoría incluye fecha, alcance, hallazgos por severidad y plan de
remediación.

## Cumplimiento legal

El tratamiento de datos personales se rige por la
[Ley 1581 de 2012](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981)
y el Decreto 1377 de 2013 (Colombia). Ver `docs/PRIVACIDAD.md`.
