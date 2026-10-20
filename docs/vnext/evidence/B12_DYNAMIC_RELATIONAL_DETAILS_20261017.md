# B12 — Cabecera/detalle relacional con cantidad dinámica de renglones

**Fecha:** 2026-10-17. **Alcance:** primera capacidad de colección tipada 1–20 declarada en TypeSpec; no es un motor genérico de órdenes ni soporta renglones de stock con efectos adicionales.  
**Commit funcional probado:** `ee4cdfafd410c72903679094756653350dd774b4`.  
**CI funcional definitiva:** [#39065762171](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39065762171) — **SUCCESS** en `modular-spring` y `nestjs`.  
**Quality:** [#39065762079](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39065762079) — **SUCCESS**.

## Contrato y proyección

En `examples/vnext/dynamic-order-details/contracts/main.tsp`:

```typespec
model PurchaseOrderRequest {
  @minLength(1) @maxLength(40) code: string;
  @minLength(1) @maxLength(120) title: string;
  @minItems(1) @maxItems(20) lines: OrderLineInput[];
}
@post @behavior("create", "PurchaseOrder")
@createDetails("OrderLine", "orderCode", "lines")
@capability("orders.write")
op createPurchaseOrder(@body input: PurchaseOrderRequest): /* respuestas declaradas */;
```

El contrato de renglón contiene campos tipados `lineCode`, `product`, `units`; el recurso persistido `OrderLine` declara `orderCode` como una FK `restrict` a `PurchaseOrder.code`. La FK **no es cliente-editable en el body anidado**: el backend la deriva de la identidad de la cabecera.

La metadata de `createDetails` se emite en el IR con `childEntity`, `parentField`, `rowsField` y un máximo **fijo de 20**. La compilación TypeSpec valida `@minItems(1) @maxItems(20)`, exactamente los campos tipados del DTO hijo, tipos y límites iguales al modelo persistido, relación FK requerida, sin propiedades desconocidas y sin campos inventados en el DTO. Un único validador compartido `packages/adapters/create-details.mjs` vuelve a validar el plan antes de emitir Java/TypeScript; el perfil impide combinar alta de renglones con efectos de dominio adicionales en el mismo hijo.

## Semántica de ejecución

- **Spring Boot:** `dispatch()` transaccional autoriza tanto `orders.write` como `lines.write`. Verifica cardinalidad y cada objeto/identificador contra el manifiesto de la entidad hija, elimina `lines` del INSERT plano de la cabecera e inserta los hijos en la misma transacción PostgreSQL. Un error de validación, FK o unicidad deshace la cabecera y todos los renglones.
- **NestJS:** valida por la misma metadata, usa un único cliente `pg` bajo `BEGIN`, crea cabecera y filas hijas parametrizadas y efectúa `COMMIT` conjunto; cualquier excepción ejecuta `ROLLBACK`. La autorización de escritura sobre hijos se aplica aunque el endpoint sea de cabecera.
- **React:** el motor de presentación común lee `createDetails`, obtiene campos de `OrderLine` desde el manifiesto y genera un editor accesible dentro del modal, con agregar/quitar hasta 20 renglones, contador, validación inline de cada campo, protección de borrador y un único POST. No hay código de UI específico de `PurchaseOrder`.

## Pruebas ejecutadas

- `tests/vnext/dynamic-order-details.test.mjs`: TypeSpec real→IR, emparejamiento del validador compartido y contratos negativos sin límite, con relación faltante, solicitud que filtra FK y cantidad debilitada.
- `packages/cli/conformance.mjs`: adaptado genéricamente para construir dos renglones desde los metadatos de la entidad hija y verificar que el HTTP GET de cada uno devuelve la FK de cabecera. Se conserva el verificador de otros perfiles sin fixtures por nombre de dominio.
- `scripts/vnext/probe-dynamic-order-details-http.mjs`: Docker Compose y PostgreSQL efímeros en ambos targets, comprobar FK real generada, rechazar cuerpo vacío, 21 renglones, campo desconocido, FK falsificada, cantidad cero y rol lector; persistencia de 3 renglones y 20 adicionales; rollback por clave duplicada dentro del body o de un comprobante anterior; una sola creación entre 10 llamadas concurrentes. SQL directo comprobó **3 cabeceras, 25 hijos y 0 huérfanos** antes de UI.
- Chromium a 390×844 creó una orden desde el React generado después de agregar/quitar renglones. El POST único insertó **2 nuevos hijos** referidos a esa orden, no insertó el eliminado, y no produjo errores JavaScript. SQL después de UI confirmó **4 cabeceras y 27 hijos**.
- En **ambos** jobs aparecen `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`, `PROTOCOLIA_B12_DYNAMIC_DETAILS_CHROMIUM_PASS`, `PROTOCOLIA_B12_RELATIONAL_DETAILS_PASS` con `atomic:true`, `maxRowsAccepted:20`, `duplicateChildRollback:true`, `concurrentCreateWinners:1`, `concurrentConflict:9`, `uiCreatedRows:2`, `noOrphans:true`.

## Honestidad sobre las incidencias

Se corrigió validación de HTTP realizada antes de `getHttpOperation`, nombres de prueba tras sustituir `Order` (palabra reservada SQL) por `PurchaseOrder`, y el verificador general que antes enviaba solo cuerpos planos. Las matrices intermedias fallaron/cancelaron y no cuentan como PASS. La matriz final [#39065762171](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39065762171) pasó completa.

## Límites / pasos posteriores

Este primer perfil entrega **CREATE transaccional** de una cabecera más 1–20 renglones, pero no edita/reordena colecciones existentes, ni agrega una vista maestra/detalle de lectura anidada. El recurso hijo conserva sus operaciones CRUD declaradas por separado; todavía no existe una política general de hijo exclusivamente gestionado por la cabecera. No se calculan totales de precios/cantidades agregados, reservas de inventario por cada línea, impuestos ni descuentos. No hay colecciones ilimitadas, streaming ni migración de colecciones históricas. Se mantiene la autorización contractual de los dos recursos; no se afirma multitenancy certificado, auditoría regulatoria ni producción.

**Siguiente mejora:** detalle y consulta de la orden con sus renglones paginados y capacidades autorizadas, cálculo exacto derivado de las líneas, y un perfil de hijos gestionados exclusivamente mediante operaciones de cabecera. Después corresponde un caso de negocio independiente nuevo, congelado antes de generar, con evaluación end-to-end de una aplicación real.
