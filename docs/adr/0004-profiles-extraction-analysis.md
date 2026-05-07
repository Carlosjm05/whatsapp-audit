# ADR-0004 — Profiles `extraction` y `analysis` en docker-compose

- Estado: **Aceptado**
- Fecha: 2026-04-23
- Autor: Carlos Manuel Jiménez Méndez
- Commit que materializa: `72aca65 fix(panel): tone='danger' en KpiCard + analyzer protegido contra auto-arranque`

## Contexto y problema

Originalmente todos los servicios tenían `restart: always`. Eso
parecía conservador, pero generó dos incidentes operativos:

1. **Auto-arranque del extractor tras un reinicio del Droplet**:
   Baileys reconectaba con la sesión existente, asumía que estaba en
   medio de una extracción y se ponía a sincronizar 12,000 chats
   sin que nadie lo hubiera pedido. Ese tipo de actividad
   inesperada es exactamente el patrón que dispara las alarmas
   antibot de WhatsApp.
2. **Auto-arranque del analyzer**: cada vez que el daemon se levantaba
   procesaba todos los `analysis_status = 'pending'` que hubiera —
   incluso después de un rollback o re-deploy a media noche, gastando
   plata en Claude sin supervisión.

Ambos casos comparten causa: servicios caros e irreversibles que se
arrancaban solos.

## Decisión

Aplicar **profiles de Docker Compose** a `extractor` y `analyzer`:

```yaml
extractor:
  profiles: ["extraction"]
  restart: unless-stopped

analyzer:
  profiles: ["analysis"]
  restart: "no"
```

`docker compose up -d` (sin args) **no los levanta**. Para activarlos,
el operador debe escribir explícitamente:

```bash
docker compose --profile extraction up -d extractor
docker compose --profile analysis up -d analyzer
```

## Alternativas consideradas

| Opción | Por qué se descartó |
|--------|---------------------|
| Mantener `restart: always` y confiar en que nadie reinicie el droplet | Ya falló dos veces. |
| `restart: "no"` en todos | Postgres, Redis, API, Dashboard, Nginx **sí** deben auto-arrancar. |
| Variable `EXTRACTION_ENABLED=false` chequeada por el código | Frágil — la variable se podía olvidar. Profiles los hace explícitos en el `compose up`. |
| **Profiles `extraction` y `analysis`** | Elegida. Estándar Docker, declarativo, imposible activar por accidente. |

## Consecuencias

### Positivas

- Imposible que el extractor o el analyzer arranquen sin acción
  humana explícita.
- El comando para activarlos queda documentado en el propio
  `docker-compose.yml`.
- `docker compose up -d` se vuelve seguro de correr en cualquier
  momento (deploys, hotfixes).

### Negativas / costos

- Operación más verbosa: dos comandos en lugar de uno.
- Riesgo opuesto: si el extractor o analyzer se cae y nadie nota,
  no se reinicia solo. Mitigación: monitoreo externo (pendiente) y
  alerts al panel `/extraccion`.
- Algunos comandos `docker compose ...` requieren recordar la flag
  `--profile`. Documentado en `docs/RUNBOOK.md` y en el comentario
  inline del compose file.

## Modelo mental

| Servicio | Profile | restart | Por qué |
|----------|---------|---------|---------|
| postgres | (default) | always | DB de producción, debe estar arriba siempre |
| redis | (default) | always | Cola de jobs, debe estar arriba siempre |
| api | (default) | always | Dashboard depende, siempre arriba |
| dashboard | (default) | always | Cliente visita el sitio, siempre arriba |
| nginx | (default) | always | Reverse proxy, siempre arriba |
| certbot | (default) | unless-stopped | Renovación automática SSL |
| **extractor** | **extraction** | unless-stopped | **No auto-arranca; mientras corre, sí se mantiene** |
| **analyzer** | **analysis** | **no** | **No auto-arranca, ni se reinicia si crashea — exige supervisión humana** |

## Referencias

- Comentarios inline en `docker-compose.yml:73-95` (extractor) y
  `:178-194` (analyzer).
- `docs/RUNBOOK.md` — procedimientos operativos.
