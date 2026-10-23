# v1.1 — Conformance genérica para documentos con If-Match

**Fecha:** 2026-10-20
**Base:** tag inmutable v1.0.0 / main = cf4f768a5fc55356f16afc9c70788b241a74202f.
**Estado:** incremento verificado en rama de trabajo, sin merge ni etiqueta de v1.1.
**Commit funcional verificado:** 2e02a1c98479b4df7f66817875bb5c3b593f97d3.
**GitHub Actions:** [#39489856837](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39489856837) — SUCCESS para Spring y NestJS. [Quality #39489856867](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39489856867) — SUCCESS.

## Problema

El CLI genérico `npm run app:test -- <generated-directory>` aplicaba la batería histórica de HTTP incluso cuando un contrato `@versionedDetails` exigía `If-Match`. El oráculo independiente de B17 ya verificaba bien el comportamiento, pero el comando general producía falsos fallos 400 para escritura de hijos, ediciones y cierre por no gestionar versiones.

## Cambios

En `packages/cli/conformance.mjs`:

1. Identifica las cabeceras versionadas **por el manifiesto generado**, usando `operations.create.behavior.createDetails.versioned` y `childEntity`; no depende de nombres de tablas o rutas particulares.
2. Antes de los intentos de escritura autorizados de un hijo (alta, PATCH auditado o baja), obtiene el FK desde el payload o la fila existente y consulta la cabecera mediante su operación declarada `get`.
3. Valida que `documentVersion` sea entero positivo y coincida con el ETag HTTP fuerte; remite ese ETag como `If-Match` en la operación real.
4. Aplica también el mecanismo a transiciones terminales y operaciones de reemplazo completo (`replaceDetails`) cuando sean invocadas por el runner.
5. Los intentos de usuario sin capacidad no disparan consultas auxiliares con poderes adicionales. Las pruebas de error intencionadas por identidad ausente conservan un If-Match sintácticamente correcto para no convertir un 404 esperado en un 400 artificial.
6. Retrasa solo la transición **terminal** de una cabecera hasta después de crear los recursos dependientes. Mantiene la prueba de contención de 10 transiciones (exactamente un 200 y nueve 409), controla el ETag final y verifica que una orden cerrada rechace altas posteriores.
7. Cuando el test genérico intenta limpiar una fila perteneciente a una orden ya cerrada, comprueba el 409 esperado y la persistencia de la fila, en lugar de exigir su eliminación ilegal.

El runner Docker Compose existente conserva la seguridad del modo test: base y volumen efímeros, claves aleatorias, bind a loopback y prohibición de targets remotos.

## Pruebas reales

La matriz [#39489856837](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39489856837) generó **cuatro aplicaciones separadas** desde contratos TypeSpec:

| Contrato | NestJS + PostgreSQL | Spring Boot + PostgreSQL |
|---|---|---|
| `dynamic-order-versioned` | PASS | PASS |
| `dynamic-order-audited-append` sin versionado | PASS | PASS |

Ambos targets versionados emitieron:
- `PROTOCOLIA_STATEFUL_CONFORMANCE_PASS`
- `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`

Y ambos targets históricos, sin versionado, también emitieron `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`. La suite de calidad general concluyó en SUCCESS.

## Límites

- El verificador ya **transporta correctamente** `If-Match` para las operaciones versionadas que ejercita, pero **no reemplaza aún** la aceptación profunda de B17: inyección de fallos de auditoría, carreras PUT/POST y browser checks siguen cubiertas por el oráculo específico.
- La comprobación de cierre requiere contrato que declare `@versionedDetails(closeField,closeState)`; no se intenta inferir terminalidad por el nombre de una transición o una URL.
- La autorización por instancia/propietario, migraciones SQL en bases existentes y la UI de reemplazo masivo siguen pendientes.
- La rama no modifica el tag v1.0.0 ni el commit de release de main.

**Siguiente:** integrar más cobertura de reemplazo en la conformance general sin duplicar el oráculo de aceptación y continuar con migraciones seguras.
