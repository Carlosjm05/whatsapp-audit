# ADR-0001 — Migrar de whatsapp-web.js a Baileys

- Estado: **Aceptado**
- Fecha: 2026-04-15
- Autor: Carlos Manuel Jiménez Méndez
- Commit que materializa: `b4a4911 feat(extractor): migrar de whatsapp-web.js a Baileys`

## Contexto y problema

El primer prototipo del extractor usó **`whatsapp-web.js`**, que
controla un Chromium headless vía Puppeteer para automatizar
WhatsApp Web. En las pruebas con el WhatsApp del desarrollador (~6,000
chats) aparecieron varios problemas serios:

- **Imagen Docker inflada** (~800 MB) por Chromium + dependencias
  (`libgbm-dev`, `libnss3`, `libxkbcommon0`, `libxcomposite1`, etc.).
- **Inestabilidad del Store** de WhatsApp Web: `getChats()` y
  `fetchMessages()` requirieron múltiples workarounds (lock files,
  paginación manual, keep-alive, calentamiento del chat, bypass del
  store).
- **Sync incompleto**: el historial completo nunca llegaba sin
  intervenciones manuales en el navegador.
- **Performance**: cada chat exige que Chromium navegue a la vista del
  chat — incompatible con una extracción masiva de 6,000+ conversaciones.
- **Riesgo de detección**: Chromium con automatización es un patrón
  fácil de detectar por WhatsApp.

## Decisión

Migrar a **`@whiskeysockets/baileys`**, que se conecta directamente al
protocolo WebSocket de WhatsApp Multi-Device sin navegador.

## Alternativas consideradas

| Opción | Por qué se descartó |
|--------|---------------------|
| Mantener `whatsapp-web.js` con más workarounds | Cada workaround duraba pocas semanas hasta que WhatsApp Web actualizaba el Store. Mantenimiento perpetuo. |
| **Baileys** | Elegida. Estable, sin Chromium, soporte multi-device, sync de historial confiable con `syncFullHistory: true`. |
| WhatsApp Business Cloud API (oficial Meta) | Requiere número dedicado, plantillas pre-aprobadas para iniciar conversaciones, no permite leer historial pasado. **No sirve para auditoría retrospectiva.** |
| `whatsmeow` (Go) | Estable pero exige reescribir el extractor en Go. Costo de migración mayor que el beneficio. |

## Consecuencias

### Positivas

- Imagen Docker ~300 MB (sin Chromium).
- Sync de historial fluido y confiable con `syncFullHistory: true` +
  `Browsers.macOS('Desktop')`.
- Performance: 12,000 chats procesables en 1-2 horas vs días.
- Menor superficie de detección: tráfico WebSocket idéntico al de un
  cliente real.
- API más predecible: menos workarounds, código del extractor más limpio.

### Negativas / costos

- **Baileys es ingeniería inversa no oficial**. WhatsApp puede romperla
  en cualquier momento. Mitigación: pinear versión (`6.7.x`) y
  monitorear el changelog del repo.
- La sesión Baileys (`auth_state/creds.json`) es delicada: si se
  corrompe, hay que escanear QR de nuevo. Mitigación: volumen Docker
  dedicado, backups del volumen.
- **Riesgo de ban regulatorio** sigue presente — los rate limits
  (`EXTRACTION_DELAY_*`, `MEDIA_DELAY_*`) son **load-bearing** y NO
  deben reducirse.
- Trabajo único de migración (~2 días) más limpieza de residuos en
  `setup.sh`, `.gitignore`, Dockerfile.

## Notas de implementación

- Sesión persistida en `extractor_session` (volumen nombrado), montada
  en `/app/auth_state` dentro del container.
- `webVersionCache` ya no aplica (era de whatsapp-web.js).
- `.gitignore` mantiene el patrón `auth_state/` (Baileys) y `.wwebjs_auth/`
  ya no aplica.

## Referencias

- Repo Baileys: https://github.com/WhiskeySockets/Baileys
- Commits relacionados: `b4a4911`, `8d5f399`, `cd84505` (cleanup), `8d62622` (cleanup Chromium).
