# ADR-0007 — Licenciamiento como cesión de uso revocable, no venta

- Estado: **Aceptado**
- Fecha: 2026-05-06
- Autor: Carlos Manuel Jiménez Méndez
- Documento materializa: `LICENSE` (licencia maestra), `docs/PRIVACIDAD.md` (Encargado), `docs/RUNBOOK.md` (procedimiento de revocación)

## Contexto y problema

El sistema fue desarrollado íntegramente por Carlos Manuel Jiménez
Méndez para uso de Ortiz Finca Raíz. La operación tiene tres
particularidades que exigen un acuerdo formal:

1. **No hay contrato escrito previo** entre las partes. La relación
   se basó en confianza y un pago inicial. Si surgiera una
   controversia (ej. el cliente quiere darle el código a otro dev,
   o reclama propiedad por haber pagado la infraestructura), no
   habría documento al cual acudir.
2. **El droplet está a nombre del cliente** (correo de Oscar Ortiz),
   pero la administración técnica (claves SSH, despliegues, repo
   privado, claves API) es exclusiva del Autor. Modelo mixto.
3. **El sistema procesa datos personales bajo Ley 1581** — la figura
   legal del Encargado debe quedar formalizada para distribuir
   correctamente las responsabilidades.

Sin un instrumento jurídico claro, los dos riesgos extremos son:

- El cliente asume que pagar la infraestructura le da propiedad sobre
  el código (no la tiene) y replica el sistema en otro servidor.
- El Autor pierde control operativo si el cliente cambia las
  credenciales del droplet sin previo aviso.

## Decisión

Adoptar como instrumento legal un único documento `LICENSE` que
funcione como **licencia de uso revocable a sola discreción del
Autor**, con las siguientes características esenciales:

1. **El Autor es titular único** de todos los derechos sobre el
   software (código, prompts, schema, lógica de extracción y
   análisis, frontend, documentación).
2. **El Usuario recibe una licencia personal, no exclusiva,
   intransferible y revocable** para USAR el sistema mediante el
   dashboard que el Autor administra sobre infraestructura del
   Usuario.
3. **El Autor puede revocar la licencia en cualquier momento** con
   un preaviso de cinco (5) días calendario por WhatsApp o correo.
4. **Tras la revocación**: el Autor retira el código del servidor
   del Usuario; el Usuario conserva su base de datos PostgreSQL
   (datos del negocio) pero pierde el dashboard y el motor de
   análisis.
5. **El Usuario se compromete** a no contratar terceros para
   reactivar el sistema sobre los componentes del Autor, ni a
   conservar copias del código.

La decisión queda materializada en el archivo `LICENSE` (sección 6
detalla el procedimiento de revocación) y en el procedimiento operativo
correspondiente en `docs/RUNBOOK.md`.

## Alternativas consideradas

| Opción | Por qué se descartó |
|--------|---------------------|
| Vender el código fuente al cliente | Pérdida total de control y de futuras oportunidades de mantenimiento. El Autor no quería esto. |
| Licencia perpetua e irrevocable | Imposibilita revocar si la relación comercial se daña. Inaceptable bajo la condición del Autor "al momento que yo quiera puedo quitarle el acceso a Oscar". |
| Contrato civil de servicios profesionales con cláusula de licenciamiento | Más completo legalmente, pero exige firma notarial y revisión de abogado. Para un cliente único que ya está operando, costo > beneficio. La licencia LICENSE.md cumple lo esencial. |
| **Licencia de uso revocable como documento principal** | Elegida. Único documento, claro, ejecutable, sin necesidad de firma notarial (la aceptación se materializa con el inicio de uso, sección 11.c del LICENSE). |
| Licencia OSS (MIT, Apache) | Inviable: regalaría el sistema a la competencia inmobiliaria del cliente. |
| Permanecer sin licencia escrita | Opción anterior. Riesgo legal alto. |

## Consecuencias

### Positivas

- El Autor conserva el control absoluto sobre el sistema y puede
  revocar cuando lo decida, sin necesidad de demanda.
- Distribución clara de responsabilidades en materia de Ley 1581:
  Oscar como Responsable, el Autor como Encargado.
- Documento autosuficiente — no requiere notario, abogado, firma
  manuscrita.
- El cliente recibe certeza sobre lo que sí puede hacer (usar el
  dashboard, conservar su DB) y lo que no (replicar el sistema,
  contratar otros devs sobre el mismo código).

### Negativas / costos

- Sin firma manuscrita ni testigos, la "aceptación tácita" por inicio
  de uso (sección 11.c) podría ser cuestionada si la disputa escala
  a juzgados. Mitigación parcial: enviar el `LICENSE` por correo
  formal al cliente al menos una vez, archivando el comprobante de
  envío.
- Una revocación abrupta puede dañar la relación comercial. El
  preaviso de 5 días busca dar margen para resolver la causa raíz
  primero. Mitigación: usar revocación como ultimátum, no como
  primera medida.
- Si en el futuro se quiere vender una porción del sistema o
  licenciar a otro cliente, este modelo deberá ser actualizado con
  un ADR posterior que lo supersede.

## Notas de implementación

- El `LICENSE` debe enviarse al cliente al menos una vez por correo
  formal (carlitos05203rules@gmail.com → correo del cliente),
  archivando el comprobante. Esto convierte la "aceptación por inicio
  de uso" en una aceptación documentada.
- El procedimiento de revocación paso a paso vive en
  [`docs/RUNBOOK.md`](../RUNBOOK.md) sección "Procedimiento de
  revocación".
- El Autor debe conservar:
  - Acceso SSH al droplet en su `~/.ssh/config`
  - Claves API (ANTHROPIC_API_KEY, OPENAI_API_KEY) que él pagó o
    al menos que están configuradas con su cuenta
  - El repositorio git privado del Sistema (no compartirlo con el
    cliente bajo ninguna circunstancia)

## Referencias

- `LICENSE` — documento legal completo
- `docs/PRIVACIDAD.md` sección 2 — Encargado del tratamiento
- `docs/RUNBOOK.md` sección "Procedimiento de revocación"
- Ley 1581 de 2012 (Colombia) — protección de datos personales
- Sesión de auditoría 2026-05-06 donde se tomó la decisión
