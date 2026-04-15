# CONTEXTO COMPLETO DEL PROYECTO — Para Claude Code

## INSTRUCCIÓN PRINCIPAL
Estoy construyendo un Sistema de Inteligencia Comercial por WhatsApp para mi cliente Oscar Ortiz de "Ortiz Finca Raíz", una inmobiliaria colombiana. El sistema audita, analiza y recupera 12,000 conversaciones de venta por WhatsApp.

ANTES de tocar el WhatsApp de Oscar, vamos a probar TODO el sistema con MI propio WhatsApp para validar que funciona perfecto.

## EL PROBLEMA
Oscar recibe 10-20 leads diarios por WhatsApp (pauta digital). Tiene ~10 asesores que:
- No responden a tiempo
- Dejan chats sin abrir
- No califican leads
- No hacen seguimiento
- No registran nada en CRM
- Resultado: dinero perdido en cada lead mal atendido

## LA SOLUCIÓN — 7 MÓDULOS

### Módulo 1: Extractor de WhatsApp (Node.js) ✅ HECHO
- Usa `whatsapp-web.js` para conectarse vía QR
- Extrae todas las conversaciones con textos, audios, imágenes
- Sistema de checkpoints (si se cae, retoma donde quedó)
- Rate limiting (2-4s entre chats, 3-6s entre media downloads)
- Guarda JSON crudo en disco + registros en PostgreSQL

### Módulo 2: Transcriptor de Audios (Python + Whisper) ✅ HECHO
- OpenAI Whisper API para transcribir audios a texto
- 3 workers paralelos
- Score de confianza (marca baja confianza < 80%)
- Genera "unified transcripts" (texto + audio en orden cronológico)
- Reintentos automáticos con backoff exponencial

### Módulo 3: Analizador con IA (Python + Claude Sonnet) 🔧 POR HACER
- Analiza cada conversación con Claude Sonnet
- Extrae 45+ datos estructurados por chat (ver lista abajo)
- 2 workers paralelos
- Validación de JSON de salida
- Manejo de conversaciones cortas (marca "datos insuficientes")

### Módulo 4: API Backend (Python FastAPI) 🔧 POR HACER
- Endpoints para los 7 paneles del dashboard
- Autenticación JWT (usuario: oscar)
- Exportación CSV/JSON
- Health checks

### Módulo 5: Dashboard (Next.js + React) 🔧 POR HACER
7 paneles:
1. Vista general: KPIs, embudo, distribución por estado/mes
2. Leads recuperables: tabla filtrable, exportable
3. Desempeño de asesores: ranking, scores, errores
4. Inteligencia de producto: demanda, presupuestos, zonas
5. Diagnóstico de errores: top 10, tiempos, % sin seguimiento
6. Inteligencia competitiva: competidores, razones de pérdida
7. Base de conocimiento: FAQ, objeciones, señales compra/abandono

### Módulo 6: Nginx + SSL 🔧 POR HACER
- Reverse proxy para API + Dashboard
- SSL con Let's Encrypt

### Módulo 7: Backups + Monitoreo 🔧 POR HACER
- Backup diario de PostgreSQL a DigitalOcean Spaces
- Script de monitoreo con alertas

## LOS 45+ DATOS QUE SE EXTRAEN POR CONVERSACIÓN

### 3.1 Datos del lead
- Teléfono, nombre WhatsApp, nombre real, ciudad/zona
- Fuente (anuncio FB/IG, referido, orgánico, etc.)
- Fecha primer/último mensaje, duración en días

### 3.2 Interés del lead
- Tipo producto: lote, arriendo, compra, inversión, otro
- Proyecto específico, todos los proyectos mencionados
- Zona deseada, tamaño/características, propósito
- Condiciones específicas (piscina, parqueadero, etc.)

### 3.3 Situación financiera
- Presupuesto verbatim (palabras exactas)
- Presupuesto estimado, rango (<50M, 50-100M, 100-200M, 200-500M, >500M)
- Forma de pago (contado, crédito, leasing, financiación directa, subsidio)
- Preaprobado bancario, ofrece inmueble en parte de pago
- Señales positivas/negativas de capacidad financiera

### 3.4 Intención de compra
- Score 1-10 con justificación
- Urgencia: ya, 1-3 meses, 3-6 meses, >6 meses
- Señales alta/baja urgencia
- ¿Es quien decide? (pareja, socio, familiar)
- ¿Comparando con competencia?

### 3.5 Objeciones
- Texto de cada objeción con palabras exactas
- Tipo: precio, ubicación, confianza, tiempo, financiación, competencia, etc.
- ¿Fue resuelta? ¿Qué respondió el asesor?
- Objeciones ocultas (inferidas del contexto)

### 3.6 Métricas de conversación
- Total mensajes (asesor vs lead), audios por cada uno
- ¿Mandó info del proyecto? ¿Precios? ¿Hizo preguntas de calificación?
- ¿Ofreció alternativas? ¿Propuso visita? ¿Intentó cerrar?
- ¿Hizo seguimiento? ¿Cuántos intentos?
- ¿Mensajes genéricos o personalizados? ¿Respondió todo?

### 3.7 Tiempos de respuesta
- Tiempo primer respuesta (minutos)
- Promedio de respuesta, brecha más larga (horas)
- Mensajes sin respuesta, lead tuvo que repetir
- Horarios activos del asesor

### 3.8 Calificación del asesor
- Nombre/identificación del asesor
- 6 scores (1-10): velocidad, calificación, presentación producto, objeciones, cierre, seguimiento
- Score general (promedio)
- Lista de errores concretos, lista de fortalezas

### 3.9 Resultado
- Estado final: venta_cerrada, visita_agendada, negociacion_activa, seguimiento_activo, se_enfrio, ghosteado_por_asesor, ghosteado_por_lead, descalificado, nunca_calificado, spam, numero_equivocado
- Razón de pérdida, punto exacto donde se perdió

### 3.10 Recuperabilidad
- ¿Recuperable? Probabilidad: alta/media/baja
- Razón de recuperabilidad
- Estrategia sugerida + mensaje de recontacto
- Producto alternativo, prioridad (esta_semana, este_mes, puede_esperar)

### 3.11 Competencia
- Competidor mencionado, qué ofrecen, por qué lo consideran
- ¿Se fue con la competencia? ¿Por qué?

### 3.12 Base de conocimiento (para Dapta)
- Preguntas reales del lead con palabras exactas
- Clasificación por tema
- Top 50 preguntas, top 20 objeciones
- Señales de compra y abandono

### 3.13 Resumen ejecutivo
- Un párrafo concreto explicando qué pasó en la conversación

## ESQUEMA DE BASE DE DATOS
El esquema completo está en `db/schema.sql` con 20+ tablas. Los índices están en `db/indexes.sql`.

## INFRAESTRUCTURA
- Servidor: DigitalOcean NYC1, Ubuntu 24.04
- Docker Compose con 8 contenedores
- PostgreSQL 16 + Redis 7
- APIs: OpenAI Whisper + Anthropic Claude Sonnet
- El `docker-compose.yml` y `.env.example` ya están configurados
- El `setup.sh` configura el servidor desde cero

## INVERSIÓN DEL CLIENTE
$2,700,000 COP — NO PUEDO FALLAR. Todo debe funcionar perfecto.

## PLATAFORMA DESTINO: DAPTA
Dapta es una plataforma colombiana de IA que crea agentes automáticos para WhatsApp. Necesitamos exportar la base de conocimiento en formato JSON para que el agente de Dapta responda con datos reales de las conversaciones de Oscar.

## PRIORIDAD INMEDIATA
1. Completar el módulo analyzer (prompt + main + validator)
2. Completar el API backend (FastAPI)
3. Completar el dashboard (Next.js)
4. Configurar nginx + SSL
5. Scripts de backup y monitoreo
6. Probar todo el pipeline con MI WhatsApp personal
7. Una vez validado, conectar el WhatsApp de Oscar
