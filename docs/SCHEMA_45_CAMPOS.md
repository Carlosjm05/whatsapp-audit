# Schema de los 45+ campos del analyzer

Documento de **referencia técnica** del contrato de salida del
analizador IA. Este es el punto de integración entre cinco
subsistemas:

```
analyzer/src/prompt.py  ──┐
                          ├──► analyzer/src/validator.py  ──► db/schema.sql  ──► api/src/schemas.py  ──► dashboard/types/api.ts
analyzer/src/db.py        ──┘                                          └──► analyzer/src/knowledge_base.py
```

> **Cualquier cambio al contrato exige tocar los 5 archivos a la vez.**
> Si modificás `prompt.py` sin actualizar `validator.py`, `schema.sql`,
> `schemas.py` y los tipos del dashboard, algo se rompe en silencio.

## Fuentes de verdad

Este documento es una **descripción conceptual**. Los detalles
exactos viven en código:

| Aspecto | Archivo |
|---------|---------|
| Campos exactos pedidos al modelo | [`analyzer/src/prompt.py`](../analyzer/src/prompt.py) |
| Validación de la respuesta | [`analyzer/src/validator.py`](../analyzer/src/validator.py) |
| Persistencia y enums | [`analyzer/src/db.py`](../analyzer/src/db.py), [`analyzer/src/enums.py`](../analyzer/src/enums.py) |
| Esquema relacional | [`db/schema.sql`](../db/schema.sql) |
| Schemas de respuesta API | [`api/src/schemas.py`](../api/src/schemas.py) |
| Tipos del frontend | [`dashboard/types/api.ts`](../dashboard/types/api.ts) |
| Export a Dapta | [`analyzer/src/knowledge_base.py`](../analyzer/src/knowledge_base.py) |

---

## Estructura general (13 secciones)

El analizador, dado el transcript completo de una conversación,
produce un objeto JSON con las siguientes secciones. Cada sección
mapea a una o varias tablas en la base de datos.

### 1. Datos del lead (`leads`)

Identificación y metadata básica.

- Teléfono, nombre WhatsApp, nombre real
- Ciudad / zona declarada
- Fuente del lead (anuncio FB/IG, referido, orgánico, etc.)
- Fecha primer / último mensaje, duración en días
- Es cliente existente (`cliente_existente`) — recompra/recomendación

### 2. Interés del lead (`lead_interests`)

Una conversación puede tener varios intereses; es 1:N.

- Tipo de producto: `lote | arriendo | compra | inversion | otro`
- Proyecto específico mencionado, todos los proyectos mencionados
- Zona deseada
- Tamaño / características requeridas (piscina, parqueadero, etc.)
- Propósito (vivienda, inversión, oficina, otro)

### 3. Situación financiera (`lead_financials`, 1:1 con lead)

- Presupuesto verbatim (palabras exactas del lead)
- Presupuesto estimado en COP
- Rango: `<50M | 50-100M | 100-200M | 200-500M | >500M | desconocido`
- Forma de pago: `contado | credito | leasing | financiacion_directa | subsidio | desconocido`
- Tiene preaprobación bancaria (`'si' | 'no' | 'desconocido'`)
- Ofrece inmueble en parte de pago (`offers_trade_in`)
- Depende de vender otro inmueble (`depends_on_selling`)
- Señales positivas / negativas de capacidad financiera

### 4. Intención de compra (`lead_intent`, 1:1 con lead)

- Intent score 1-10 con justificación textual
- Urgencia: `ya | 1-3_meses | 3-6_meses | mas_6_meses | desconocido`
- Señales de alta urgencia / baja urgencia
- Es quien decide (`is_decision_maker`):
  `si | no_pareja | no_socio | no_familiar | desconocido`
- Está comparando con competencia

### 5. Objeciones (`lead_objections`)

Lista (1:N por lead).

- Texto verbatim de la objeción
- Tipo: `precio | ubicacion | confianza | tiempo | financiacion | competencia | otro | desconocido`
- Fue resuelta (`'si' | 'no' | 'parcialmente' | 'desconocido'`)
- Respuesta del asesor (verbatim)
- Calidad de la respuesta del asesor (1-10)
- Es objeción oculta (inferida del contexto)

### 6. Métricas de conversación (`conversation_metrics`, 1:1)

> **No vienen de Claude.** Se computan en `analyzer.py` a partir del
> transcript y se persisten directamente. Validator NO las espera.

- Total de mensajes (lead vs asesor)
- Audios por cada lado
- Mandó info del proyecto / precios / preguntas de calificación
- Ofreció alternativas / propuso visita / intentó cerrar
- Hizo seguimiento (cuántos intentos)
- Mensajes genéricos vs personalizados
- Respondió todo lo que se le preguntó

### 7. Tiempos de respuesta (`response_times`, 1:1)

> **No vienen de Claude.** Se computan en `analyzer.py` con
> `business_hours.py` (horario laboral + domingo separado).

- Primer respuesta en minutos
- Promedio de respuesta en minutos
- Brecha más larga en horas
- Mensajes del lead sin respuesta
- Lead tuvo que repetir su pregunta
- Horarios activos del asesor
- Categoría: `excelente | bueno | regular | malo | critico`

### 8. Calificación del asesor (`advisor_scores`, 1:1)

- Nombre / identificación del asesor (puede ser "General" si no se
  identifica)
- 6 scores 1-10:
  - `speed_score` — velocidad de respuesta
  - `qualification_score` — calificación del lead
  - `presentation_score` — presentación del producto
  - `objection_handling_score` — manejo de objeciones
  - `closing_score` — cierre
  - `followup_score` — seguimiento
- Score general (promedio)
- Lista de errores concretos (verbatim)
- Lista de fortalezas

### 9. Resultado / outcome (`conversation_outcomes`, 1:1)

- Estado final (`final_status`):
  `venta_cerrada | visita_agendada | negociacion_activa | seguimiento_activo | se_enfrio | ghosteado_por_asesor | ghosteado_por_lead | descalificado | nunca_calificado | spam | numero_equivocado | cliente_existente`
- Razón de pérdida (`perdido_por`):
  `precio | ubicacion | tiempo | confianza | competencia | desinteres | financiacion | otro | no_aplica | desconocido`
- Punto exacto de la conversación donde se perdió

### 10. Recuperabilidad (parte de `conversation_outcomes`)

- Es recuperable
- Probabilidad: `alta | media | baja | desconocida`
- Razón de la recuperabilidad
- Estrategia sugerida (texto libre)
- Mensaje de recontacto sugerido (verbatim)
- Producto alternativo recomendado
- Prioridad: `esta_semana | este_mes | puede_esperar`

### 11. Competencia (`competitor_intel`, 1:N)

- Competidor mencionado
- Qué ofrece
- Por qué lo está considerando el lead
- Se fue con la competencia
- Razón

### 12. Base de conocimiento para Dapta (`dapta_knowledge_base`)

> Se genera con `knowledge_base.py` a partir de los datos analizados.
> No es output directo de Claude.

- Preguntas reales del lead (verbatim) clasificadas por tema
- Top 50 preguntas, top 20 objeciones
- Señales de compra / abandono detectadas
- Respuestas ideales (extraídas de objeciones donde
  `response_quality >= 8`)

### 13. Resumen ejecutivo (`conversation_summaries`, 1:1)

- Un párrafo concreto explicando qué pasó en la conversación
  (3-5 oraciones).

---

## Convenciones de enums

Los valores enum se almacenan como **strings en español**:

- Sí / no: `'si' | 'no' | 'desconocido'` (no booleanos).
- Estados / categorías: snake_case sin tildes.
- Fuente única: [`analyzer/src/enums.py`](../analyzer/src/enums.py).

`db/schema.sql` aplica `CHECK` constraints sobre los valores válidos.
Cualquier valor fuera del set hace fallar el INSERT.

## Manejo de "datos insuficientes"

Conversaciones de menos de 20 palabras o que el triaje Haiku marca
como `trivial | spam` no llegan a Sonnet. Se persisten con:

- `analysis_status = 'datos_insuficientes'`
- `final_status = 'numero_equivocado' | 'spam'` según el caso
- Resto de campos en NULL

Ver [ADR-0003](adr/0003-two-pass-haiku-sonnet.md).

## Cómo se calculan los campos NO-IA

Algunos campos clave NO los pide Claude porque salen más baratos y
deterministas computados a partir del transcript:

| Campo | Calculado en |
|-------|--------------|
| `total_messages`, `advisor_messages`, `lead_messages` | `analyzer.py:compute_metrics_from_msgs` |
| `advisor_audios`, `lead_audios` | idem |
| `first_response_minutes`, `avg_response_minutes` | idem + `business_hours.py` |
| `longest_gap_hours`, `advisor_active_hours` | idem |
| `response_time_category` | umbrales en `analyzer.py` |
| `ghost_score` | `ghost_score.py` |

Ver `recompute_metrics.py` para el script que recalcula estos campos
sin re-llamar a Claude.

## Cambios al schema

**Antes** de modificar este contrato, leer
[ADR-0006](adr/0006-schema-vs-migraciones.md). El cambio debe
propagarse a:

1. `analyzer/src/prompt.py` — pedir el nuevo campo al modelo.
2. `analyzer/src/validator.py` — aceptarlo en el schema Pydantic.
3. `analyzer/src/db.py` — persistirlo (INSERT / UPDATE).
4. `analyzer/src/enums.py` — si es enum.
5. `db/schema.sql` — agregar columna + CHECK si aplica.
6. `db/migrations/NNN_*.sql` — migración idempotente.
7. `api/src/schemas.py` y router relevante — exponerlo si la UI lo usa.
8. `dashboard/types/api.ts` y página relevante — consumirlo.
9. `analyzer/src/knowledge_base.py` — si afecta el export Dapta.

Y actualizar este documento.
