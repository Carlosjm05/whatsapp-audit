# Contexto de negocio — Ortiz Finca Raíz

Documento de **explicación** (en términos de Diátaxis): cuál es el
problema que resuelve `whatsapp-audit`, quién paga, qué restricciones
no obvias condicionan el diseño.

> Este documento NO contiene comandos ni referencia técnica. Para eso,
> ver `docs/RUNBOOK.md` y `docs/SCHEMA_45_CAMPOS.md`.

## Quién es el cliente

**Ortiz Finca Raíz**, inmobiliaria colombiana con sede en Bogotá. La
operación comercial pasa casi enteramente por **WhatsApp**:

- ~10 asesores comerciales conectados al mismo número.
- 10-20 leads diarios entrantes desde pauta digital (Facebook,
  Instagram, Google Ads).
- ~12,000 conversaciones acumuladas a la fecha de la auditoría.
- El cierre típico de una venta de finca raíz toma semanas a meses.

El responsable del negocio es **Oscar Ortiz**.

## Qué problema resuelve este sistema

Oscar invierte en pauta digital pero no tiene visibilidad sobre lo que
pasa con cada lead una vez entra al WhatsApp. Patrones que él
sospechaba y que la auditoría confirmó:

- **Tiempos de respuesta lentos**: muchos leads quedan sin respuesta
  por horas o días.
- **Chats sin abrir**: leads que escribieron y nadie miró.
- **Cero calificación**: asesores no preguntan presupuesto, urgencia
  ni capacidad financiera.
- **Sin seguimiento**: una vez la conversación se enfría, nadie la
  retoma.
- **Sin registro en CRM**: la información del lead se pierde en el
  chat sin estructurarse.

**Resultado**: cada lead mal atendido es dinero pagado en pauta
desperdiciado.

`whatsapp-audit` extrae las 12,000 conversaciones, las analiza con IA
y produce:

1. **Un dashboard** con KPIs por asesor, embudo de conversión, leads
   recuperables, top objeciones, top errores.
2. **Una base de conocimiento exportable a Dapta** (plataforma
   colombiana de agentes IA en WhatsApp) para automatizar la primera
   respuesta y la calificación inicial.

## Restricciones que condicionan el diseño

Estas restricciones no son negociables y explican muchas decisiones
arquitectónicas:

### 1. No se puede romper el WhatsApp del cliente

El número de Ortiz ya tiene 12,000 chats activos y es el canal
comercial principal. Un ban de WhatsApp = pérdida total del negocio
durante el tiempo que tome recuperar el número (semanas en el mejor
caso, definitivo en el peor).

**Implicación arquitectónica**: rate limits del extractor son
**load-bearing**, ver [ADR-0001](adr/0001-baileys-vs-whatsapp-web-js.md)
y `SECURITY.md`.

### 2. Validación previa con el WhatsApp del desarrollador

Antes de cualquier cambio que toque el extractor, se valida con el
WhatsApp personal del desarrollador (Carlos). Esta es una **regla
explícita** del proyecto, no una sugerencia.

### 3. Inversión del cliente: $2,700,000 COP

Es un proyecto pequeño en cifras absolutas pero crítico para Oscar.
Tolerancia operativa:

- Downtime aceptable: <1h/mes.
- Pérdida de datos aceptable: 0 (con backup off-site).
- Falsos positivos en métricas: aceptables si son trazables.

### 4. Datos personales bajo Ley 1581 (Colombia)

12,000 personas escribieron al WhatsApp de Ortiz. El sistema procesa
sus datos personales (números, nombres, mensajes, audios). Aplica la
**Ley 1581 de 2012** y el Decreto 1377 de 2013.

**Implicación**: ver `docs/PRIVACIDAD.md`. Sanción posible por
incumplimiento: hasta ~2,000 SMMLV.

### 5. Todo en español

Por requerimiento del cliente y de coherencia con la audiencia final
(Oscar y sus asesores son hispanohablantes), todo el sistema usa
**español** en:

- UI del dashboard
- Mensajes de log
- Valores enum en la base de datos (`'si'`, `'no'`, `'desconocido'`,
  `'venta_cerrada'`, etc.)
- Documentación dirigida a humanos (esta misma)
- Mensajes de error de la API

**Excepción**: nombres de columnas en inglés
(`offers_trade_in`, `has_bank_preapproval`, etc.) heredados del
diseño inicial. Renombrarlos exigiría wipe de DB y cambios en 4
subsistemas; el costo no justifica el beneficio. Se mantienen en
inglés.

`CLAUDE.md` también está en inglés porque su audiencia es el agente
Claude Code (mejor performance del modelo en inglés).

### 6. Cliente abre el dashboard desde su iPhone

Oscar revisa el dashboard varias veces al día desde su celular. La
experiencia mobile NO es opcional: bottom navigation, drawer, áreas
de toque ≥44px, sin tablas que rompan el layout.

### 7. Pipeline reanudable

Procesar 12,000 chats toma horas. Si algo se cae a la mitad, el
sistema debe reanudar sin re-procesar lo ya hecho ni perder lo que
quedó pendiente. Ver
[ADR-0005](adr/0005-workflow-indexado-lotes.md).

## Stakeholders

| Rol | Persona | Cuándo se les consulta |
|-----|---------|------------------------|
| Autor y titular del software | Carlos Manuel Jiménez Méndez (+57 302 439 6752, carlitos05203rules@gmail.com) | Decisiones técnicas, cambios de arquitectura, autorización de uso |
| Responsable del tratamiento de datos | Oscar Ortiz (Ortiz Finca Raíz) | Cambios de finalidad, comunicación legal con titulares |
| Asesores comerciales | Equipo Ortiz | Validación de errores reales detectados por la IA |
| Plataforma destino (KB) | Dapta | Cambios al esquema del export |

> El Autor administra técnicamente el sistema sobre infraestructura
> contratada a nombre del cliente (modelo mixto). La cesión de uso es
> revocable por el Autor en cualquier momento. Ver `LICENSE`.

## Ciclo típico de uso

1. **Lunes**: Oscar abre el dashboard desde su iPhone, revisa KPIs de
   la semana anterior por asesor.
2. **Detecta** que un asesor tiene tiempos de respuesta >2h. Click
   para ver detalle.
3. **Filtra** leads recuperables del último mes con probabilidad
   "alta" y los exporta a CSV para repartir entre asesores como
   tarea concreta.
4. **Cada noche** el daemon analyzer procesa los leads nuevos del
   día.
5. **Cada semana** se exporta la KB actualizada hacia Dapta para que
   el bot atienda los nuevos contactos con respuestas más finas.

Para los procedimientos exactos, ver `docs/RUNBOOK.md`.

## Lo que el sistema NO hace

- **No envía mensajes en nombre del cliente.** Solo lee. Cualquier
  mensaje de recontacto se prepara como sugerencia textual para que
  un asesor humano lo envíe (o el bot Dapta).
- **No es un CRM.** No reemplaza al CRM existente del cliente;
  exporta datos para alimentar uno.
- **No predice cierres.** Sugiere probabilidades de recuperación
  basadas en patrones detectados, no garantías.
- **No es multi-tenant.** Está construido para un solo número de
  WhatsApp y un solo cliente.

## Documentos relacionados

- `README.md` — quickstart y overview técnico.
- `docs/SCHEMA_45_CAMPOS.md` — referencia de los datos extraídos.
- `docs/RUNBOOK.md` — operación día a día.
- `docs/PRIVACIDAD.md` — política de datos personales.
- `docs/adr/` — decisiones arquitectónicas.
