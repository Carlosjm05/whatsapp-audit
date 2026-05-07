# Política de tratamiento de datos personales

Documento de cumplimiento de la **Ley 1581 de 2012** (Colombia) y su
Decreto Reglamentario 1377 de 2013, aplicable al sistema
`whatsapp-audit` operado para Ortiz Finca Raíz.

> **Estado del documento**: borrador técnico preparado por el
> desarrollador. Antes de entrar a producción con datos reales, debe
> ser revisado por un asesor legal en derecho de datos personales en
> Colombia y firmado por el Responsable.

## 1. Identificación del Responsable del Tratamiento

| Campo | Valor |
|-------|-------|
| Razón social | Ortiz Finca Raíz |
| NIT | [completar] |
| Representante legal | Oscar Ortiz |
| Dirección | [completar] |
| Ciudad | Bogotá D.C., Colombia |
| Correo de contacto para PQR de datos | [completar] |
| Teléfono | [completar] |

## 2. Identificación del Encargado del Tratamiento

El presente sistema es operado técnicamente por el Autor del software,
quien actúa como **Encargado** en los términos del Art. 3 literal d) de
la Ley 1581:

| Campo | Valor |
|-------|-------|
| Nombre | Carlos Manuel Jiménez Méndez |
| Documento | [pendiente de completar] |
| WhatsApp | +57 302 439 6752 |
| Correo de contacto | carlitos05203rules@gmail.com |
| País | Colombia |

El Encargado solo procesa datos por instrucción del Responsable y bajo
los términos de la licencia descrita en `LICENSE`. El Encargado es,
adicionalmente, el titular de los derechos de propiedad intelectual
sobre el software.

## 3. Finalidad del tratamiento

Los datos personales recolectados a través del WhatsApp del Responsable
se procesan exclusivamente para las siguientes finalidades:

1. **Auditoría interna de gestión comercial.** Identificar leads
   recuperables, evaluar el desempeño de los asesores, detectar
   errores operativos y oportunidades de mejora.
2. **Recuperación de leads perdidos.** Generar mensajes de
   recontacto con leads que fueron mal atendidos o quedaron sin
   seguimiento.
3. **Inteligencia de producto y mercado.** Identificar patrones
   agregados de demanda, presupuestos, zonas y objeciones.
4. **Construcción de base de conocimiento para automatización.**
   Exportar preguntas frecuentes, objeciones reales y respuestas ideales
   hacia el agente de WhatsApp de Dapta, manteniendo la coherencia con
   el estilo de respuesta del Responsable.

**Los datos NO se utilizan para:**
- Vender o ceder a terceros con fines comerciales
- Perfilamiento crediticio ni decisiones automatizadas con efectos
  jurídicos sobre el titular
- Publicidad de terceros

## 4. Categorías de datos tratados

| Categoría | Ejemplo | Sensible |
|-----------|---------|----------|
| Identificación | número de teléfono, nombre WhatsApp, nombre real | No |
| Localización aproximada | ciudad, zona declarada por el lead | No |
| Información financiera | presupuesto declarado, forma de pago, preaprobado | No (declaración voluntaria del titular) |
| Comunicaciones | texto de mensajes y transcripciones de audio | No (pero confidencial) |
| Multimedia | audios, imágenes, documentos enviados | Depende del contenido |

**No se tratan datos sensibles** en el sentido del Art. 5 de la Ley 1581
(salud, orientación sexual, datos biométricos, opiniones políticas,
etc.). Si un titular envía espontáneamente este tipo de información en
una conversación, se aplica el procedimiento de eliminación inmediata
descrito en la sección 9.

## 5. Base legal del tratamiento

Para los datos ya existentes en el WhatsApp del Responsable al momento
de la implementación:

- **Interés legítimo del Responsable** (Art. 10, lit. e) Ley 1581):
  evaluación de su propia operación comercial sobre comunicaciones de
  las que ya es parte. El titular envió el mensaje al número del
  Responsable de manera voluntaria con el propósito de obtener
  información comercial.

Para nuevos contactos posteriores a la implementación, se incorporará
en el primer mensaje automático un enlace al **aviso de privacidad**
con la política completa.

## 6. Derechos del titular (ARCO)

Todo titular tiene derecho a:

- **Conocer** qué datos suyos se procesan
- **Actualizar y rectificar** los datos
- **Solicitar prueba** de la autorización
- **Ser informado** sobre el uso dado a sus datos
- **Presentar quejas** ante la SIC
- **Revocar** la autorización y/o solicitar la **supresión**

### Cómo ejercer los derechos

El titular puede ejercer cualquiera de estos derechos enviando un
correo a [completar correo de PQR] con:

- Nombre completo y documento de identificación
- Número de teléfono usado en la conversación con Ortiz Finca Raíz
- Petición concreta

El Responsable tiene **10 días hábiles** para responder consultas y
**15 días hábiles** para responder reclamos (Art. 14 y 15 Ley 1581).

## 7. Transferencia y transmisión internacional

Para procesar audios y conversaciones, el sistema realiza llamadas a
servicios de IA con datacenters fuera de Colombia:

| Encargado | País | Datos enviados | Propósito |
|-----------|------|----------------|-----------|
| OpenAI (Whisper API) | Estados Unidos | audios crudos | transcripción a texto |
| Anthropic (Claude API) | Estados Unidos | transcript completo del chat (texto y audio transcrito) | análisis estructurado |

Ambos proveedores cuentan con cláusulas contractuales de protección de
datos y certificaciones de seguridad reconocidas internacionalmente.
La transferencia se realiza al amparo del **Art. 26 Ley 1581** y bajo
las cláusulas estándar publicadas por la SIC.

> **Nota técnica**: el contenido de los audios y mensajes se envía a
> estos servicios para procesamiento puntual; no se utilizan para
> entrenar modelos según las condiciones contractuales de OpenAI y
> Anthropic vigentes.

## 8. Seguridad de la información

El sistema implementa las siguientes medidas:

- **Acceso autenticado** al dashboard con JWT firmado, expiración 8h,
  contraseñas con bcrypt.
- **Comunicación cifrada** (HTTPS con certificado Let's Encrypt) entre
  cliente y servidor.
- **Aislamiento por contenedores Docker** con red interna privada.
- **Servicios de base de datos no expuestos** a internet (bind a
  127.0.0.1).
- **Rate limiting** en el endpoint de login.
- **Backups cifrados** off-site (DigitalOcean Spaces).
- **Política de rotación** de secretos descrita en `SECURITY.md`.

Las medidas se revisan en cada auditoría documentada en `docs/audits/`.

## 9. Retención y supresión

| Tipo de dato | Plazo de retención |
|--------------|---------------------|
| Conversaciones crudas y transcripciones | 24 meses desde el último mensaje |
| Análisis estructurado (leads) | 24 meses desde el último contacto |
| Logs de extracción y métricas | 12 meses |
| Backups encriptados | 90 días |

Vencido el plazo, los datos se eliminan de la base de datos de
producción y de los backups (hasta donde la rotación lo permita).

**Eliminación a solicitud del titular**: tras una solicitud ARCO de
supresión, el dato se elimina de producción en máximo 15 días hábiles
y de los backups en su próxima rotación (≤90 días).

## 10. Registro Nacional de Bases de Datos (RNBD)

El Responsable debe registrar la base de datos de
`leads_ortizfincaraiz` ante la **Superintendencia de Industria y
Comercio** dentro de los plazos vigentes para empresas de su
clasificación (consultar circular SIC vigente).

Datos a declarar (entre otros):
- Nombre de la base
- Volumen estimado: ~12,000 titulares
- Finalidad y categorías de datos (ver secciones 3 y 4)
- Medidas de seguridad (ver sección 8)
- Encargado del tratamiento (ver sección 2)

## 11. Aviso de privacidad para nuevos titulares

Mensaje sugerido para incorporar al primer contacto automático con
nuevos leads (vía agente Dapta o respuesta inicial del asesor):

> *"Hola, en Ortiz Finca Raíz tratamos tus datos personales para
> atender tu consulta y darte seguimiento comercial conforme a la Ley
> 1581 de 2012. Podés conocer y ejercer tus derechos
> escribiéndonos a [correo PQR]. Política completa: [URL]."*

## 12. Vigencia y modificaciones

Esta política rige desde [fecha de firma] y se revisa al menos
anualmente o cada vez que cambien las finalidades del tratamiento. Las
modificaciones se publican en `docs/PRIVACIDAD.md` del repositorio y
se versionan en el historial de git.

---

**Documento técnico — pendiente revisión legal antes de producción.**
