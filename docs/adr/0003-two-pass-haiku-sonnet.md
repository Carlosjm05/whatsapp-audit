# ADR-0003 — Two-pass Haiku (triaje) + Sonnet (análisis) en analyzer

- Estado: **Aceptado**
- Fecha: 2026-04-24
- Autor: Carlos Manuel Jiménez Méndez
- Commit que materializa: `7433b80 feat(analyzer): cerebro v3 - 8 mejoras en medicion y prompt`

## Contexto y problema

El analizador procesa ~12,000 conversaciones con Claude Sonnet
extrayendo 45+ campos por chat. A precio de Sonnet 4.5
(input + output + cache), el costo proyectado pasaba de varios
cientos de dólares — y muchas conversaciones eran:

- **Spam** (3 mensajes "hola, info", luego silencio).
- **Número equivocado** (1 mensaje, sin engagement).
- **Conversaciones de menos de 20 palabras** sin intención clara.

Procesar todas esas con Sonnet completo era desperdicio. Necesitábamos
un filtro previo barato.

## Decisión

Implementar un **flujo de dos pasos**:

1. **Pass 1 — Triaje con Claude Haiku** (`CHEAP_MODEL`): clasifica el
   chat como `analizable | trivial | spam` con prompt minimalista
   sobre los primeros 3,000 + últimos 1,000 caracteres.
2. **Pass 2 — Análisis completo con Sonnet** solo si Haiku marcó el
   chat como `analizable`. Para `trivial` y `spam`, se persiste un
   resumen mínimo y se evita el gasto.

Adicionalmente:
- **Prompt caching** (`cache_control: ephemeral`) en el system prompt
  de Sonnet — el prompt grande (~10k tokens) se cobra una vez y se
  cachea por 5 minutos.
- **Short-circuit** por `MIN_WORDS=20`: chats por debajo de esa
  longitud van directo a `'datos_insuficientes'` sin llamar a Claude.

## Alternativas consideradas

| Opción | Por qué se descartó |
|--------|---------------------|
| Solo Sonnet para todo | Costo proyectado inaceptable. |
| Solo Haiku para todo | Precisión insuficiente para los 45+ campos estructurados (probado en sandbox). |
| Reglas heurísticas (regex / keywords) en lugar de Haiku | Frágil ante variantes idiomáticas y errores de tipeo. Haiku es más robusto y casi tan barato. |
| **Two-pass Haiku + Sonnet** | Elegida. Mantiene precisión de Sonnet donde importa, recorta ~70% del costo total. |

## Consecuencias

### Positivas

- Costo total reducido ~60-70% comparado con un solo paso de Sonnet
  para los 12,000 chats.
- Latencia agregada baja: Haiku tarda ~1-2 seg, Sonnet 10-30 seg.
- Trazabilidad: el verdict de Haiku se persiste en
  `lead_analysis_history` con su propio `cost_usd`.

### Negativas / costos

- **Riesgo de drift de modelo**: si el ID `claude-haiku-4-5` cambia o
  se retira, el triaje falla y todo escala a Sonnet
  (defeats the purpose). La auditoría 2026-05-06 marcó esto como
  CRÍTICO #21 — verificar el ID está vigente.
- Falsos negativos del triaje (chats `analizables` clasificados como
  `trivial`) se pierden silenciosamente. Mitigación: `recompute_metrics`
  permite reanalizar manualmente cuando se detecta uno.
- Complejidad operativa: ahora hay dos paths de costo (Haiku + Sonnet).

## Notas de implementación

- `analyzer/src/analyzer.py:36-46` — constantes `CHEAP_MODEL`,
  `EXPENSIVE_MODEL`, `MIN_WORDS`.
- `analyzer/src/analyzer.py:622` — método `triage()`.
- `analyzer/src/analyzer.py:662` — sistema con
  `cache_control: ephemeral`.
- `analyzer/src/db.py:287-366` — `write_triage_verdict` atómico
  (single transaction).

## Referencias

- Anthropic prompt caching:
  https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Auditoría hallazgo CRÍTICO #21 (verificar Haiku 4.5 existe):
  `docs/audits/2026-05-06-auditoria-completa.md`.
