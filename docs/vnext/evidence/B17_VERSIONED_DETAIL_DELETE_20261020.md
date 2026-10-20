# B17.3b — Eliminación auditada y versionada de renglones dinámicos

**Fecha:** 2026-10-20  
**Dependencia:** [B17.3a: CAS documental](B17_VERSIONED_DETAILS_20261020.md), posterior a [B17.2: permisos y auditoría](B17_PARENT_AUTH_AUDIT_20261020.md).  
**Commit funcional probado:** `23cca9724ef10c49f1d2162042516b48de96796f`  
**Matriz real:** [GitHub Actions #39473296866](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39473296866) — **SUCCESS** tanto en `nestjs` como en `modular-spring`.  
**Quality:** [#39473296830](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39473296830) — **SUCCESS**; [#39473368400](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39473368400) — **SUCCESS**.

## Objetivo contractual

El contrato `examples/vnext/dynamic-order-versioned/contracts/main.tsp` ahora incluye:

```typespec
@route("/api/order-lines/{lineCode}")
@delete @behavior("delete","OrderLine")
@audit("orderCode,product,units")
@capability("lines.write")
op deleteOrderLine(@path lineCode:string,@header("If-Match") ifMatch:string):
  {@statusCode _:204;} | Invalid | Conflict | Missing | Unauthorized | Forbidden;
```

Se permite únicamente en colecciones `@versionedDetails`. No se abrió un DELETE masivo genérico ni un atajo de borrado para las colecciones anteriores; el contrato continúa siendo la fuente de verdad.

El compilador y los generadores Spring/NestJS exigen:
- Operación `delete` vinculada a una entidad hija con creador `@createDetails` de versión optativa explícita.
- `@audit` de 1–8 campos declarados, sin identidad pública y **con el FK de cabecera incluido**; listado sin duplicados.
- Capacidad del DELETE igual a la de creación del hijo y no pública; la ejecución exige **también** la capacidad de escritura de la cabecera.
- HTTP DELETE por identidad pública, respuesta 204 y estados 400/401/403/404/409 declarados.
- No se permite el DELETE en colecciones sin versión ni la eliminación directa de la cabecera versionada.

## Algoritmo de ejecución, común a Spring y NestJS

1. Rechaza payloads de DELETE, If-Match ausente o formato diferente de ETag fuerte `"N"`, y permiso de escritura insuficiente. No revela renglones a un usuario que carece de permiso sobre la orden.
2. Identifica la cabecera a través de la FK y obtiene el bloqueo transaccional `SELECT ... FOR UPDATE` sobre la cabecera, siguiendo el **mismo orden de bloqueo** de los POST y PATCH versionados.
3. Compara bajo bloqueo el `document_version` persistido con el valor enviado. Ante desactualización devuelve **409**; un hijo inexistente devuelve **404**.
4. Relee el hijo dentro de la transacción y comprueba el número de renglones. Si solo queda uno, devuelve **409** para preservar el límite inferior de la colección (1–20).
5. Elimina la fila, escribe los campos seleccionados en `protocolia_audit_event` con `before_value` poblado y `after_value=NULL`, incrementa `document_version` en la cabecera y hace commit. En Spring se usa el `dispatch @Transactional`; en NestJS un `pg` client fijado para la transacción.
6. Cualquier fallo de auditoría o de versión revierte **borrado, eventos y contador**. No se registra artificialmente un borrado que no ocurrió.

## Evidencia en PostgreSQL real

El oráculo `scripts/vnext/probe-versioned-order-http.mjs`, ejecutado contra aplicaciones recién **generadas** desde TypeSpec, confirmó en ambos backends el marcador:

```
PROTOCOLIA_B17_VERSIONED_DELETE_PASS {"bothCapabilitiesRequired":true,"ifMatchRequired":true,"auditedBeforeValues":true,"lastRowGuarded":true,"concurrentDeletesOneWinner":true,"failedAuditRollsBackDeletion":true,"failedAuditRollsBackVersion":true,"sqlAggregateUpdated":true}
```

Detalle de las comprobaciones:
- DELETE con If-Match ausente o débil: 400; versión antigua: 409; usuario autorizado a crear hijos pero sin escritura de cabecera: 403.
- DELETE válido: 204, GET posterior del hijo 404, versión de documento incrementada, total calculado en SQL reducido exactamente por la cantidad eliminada.
- Auditoría del DELETE: campos `orderCode`, `product` y `units` con sus valores **anteriores exactos**, y sus valores posteriores vacíos.
- Carrera DELETE/DELETE sobre **distintos hijos** usando el mismo If-Match: resultado `[204,409]`, una sola modificación de versión y ningún registro de auditoría para la operación perdedora.
- Trigger de prueba PostgreSQL que lanza una excepción durante el INSERT de auditoría del DELETE: HTTP 500, el hijo continúa existiendo, la versión no avanza y no aparece evento parcial. Tras retirar el trigger, la misma versión permite la baja exitosa.
- Documento separado con exactamente un hijo: DELETE responde 409, mantiene al hijo y conserva `documentVersion = 1`.
- Los escenarios previos de B17.3a siguen pasando en la misma matriz: POST/POST y POST/PATCH con un solo ganador, auditoría de edición, ETag persistido y rollback.

## Fronteras explícitas

Este hito completa el **DELETE de un renglón**, no una implementación total del documento:
- No hay edición UI autogenerada de versiones/errores 409; aún falta implementar adquisición/refresco de ETag en la PWA.
- No hay reemplazo de colecciones en bloque, orden cerrada/inmutable, ni autorizaciones por instancia/propietario.
- No se ha probado aún una carrera cruzada directa DELETE/POST en el oráculo específico (aunque ambos comparten bloqueo de cabecera).
- No hay migración in-place de SQL sobre aplicaciones ya desplegadas ni prueba de operación contra datos reales de cliente.
- La conformance genérica del CLI aún no envía If-Match; se utiliza el oráculo versionado dedicado. El flujo histórico sin versionado mantiene su propia matriz.

**Siguiente bloque:** B17.4: generación de UX que maneje versiones, conflictos y eliminación accesible, seguida de una estrategia de migraciones y conformance unificada. El PR #53 permanece Draft y `main` intacta.
