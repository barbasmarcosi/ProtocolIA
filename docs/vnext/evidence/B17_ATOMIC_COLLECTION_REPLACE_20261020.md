# B17.5b — Reemplazo íntegro, auditable y atómico de colecciones versionadas

**Fecha:** 2026-10-20  
**Dependencias:** B17.1–B17.5a (acotamiento, permisos, auditoría, CAS de documento, DELETE, UI y cierre).  
**Commit funcional verificado:** `98dab4a4010114c520885cbdf9f1dc2e0519d3f9`.  
**Matriz de aplicaciones reales:** [GitHub Actions #39481216143](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39481216143) — **SUCCESS**, `nestjs` y `modular-spring`.  
**Quality:** [#39481223246](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39481223246) y [#39481216233](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39481216233), ambas **SUCCESS**.

## Problema

Con B17.5a cada renglón podía añadirse, editarse o eliminarse con CAS global, pero una actualización conjunta de varias líneas seguía exigiendo múltiples solicitudes, dando lugar a estados intermedios observables y posibles conflictos a mitad de la operación. B17.5b añade **reemplazo completo**, no reconciliación parcial, con una única transición del documento.

## Contrato TypeSpec

```typespec
model ReplaceOrderLines {
  @minItems(1) @maxItems(20) lines:OrderLineInput[];
}
@route("/api/orders/{code}/lines")
@put @behavior("replaceDetails","PurchaseOrder") @replaceDetails
@capability("orders.write")
op replaceOrderLines(
  @path code:string,
  @header("If-Match") ifMatch:string,
  @body input:ReplaceOrderLines
): VersionedPurchaseOrder | Invalid | Conflict | Missing | Unauthorized | Forbidden;
```

El compilador comprueba:
- PUT con una única identidad de cabecera, body JSON y estados 200/400/401/403/404/409.
- Exactamente **una** operación de reemplazo sobre una cabecera con `@createDetails` + `@versionedDetails`.
- DTO con **solo** el campo de colección declarado, de 1 a 20 objetos con las mismas propiedades, restricciones y tipos que el hijo de creación inicial. Ninguna FK de la cabecera puede suministrarse dentro de un renglón.
- Capacidad de escritura igual a la del creador de cabecera, y existencia de operaciones de alta/baja de hijos con auditoría declarada, incluyendo la FK.
- Conserva el comportamiento de los contratos anteriores que no declaran `@replaceDetails`.

La anotación es optativa, por lo que no se activa un reemplazo de colecciones arbitrarias ni se infiere a partir de una ruta de apariencia similar.

## Generación y algoritmo común

Los adaptadores Spring y NestJS reutilizan la relación tipada del creador `@createDetails` en el manifiesto/IR, evitando duplicar o desacoplar la fuente de verdad del contrato.

1. Autenticación y capacidades: cabecera, alta de hijo y baja de hijo.
2. Validación estricta del body (sin propiedades extra), de la longitud de colección y de cada renglón usando los validadores genéricos del runtime. La FK se asigna desde la identidad de la cabecera. Las identidades duplicadas dentro del reemplazo se rechazan.
3. Bloqueo transaccional **de la cabecera primero** mediante `SELECT ... FOR UPDATE`; comparación fuerte del `If-Match` con `document_version` y rechazo si la orden está `closed`.
4. Lectura ordenada de las líneas existentes, eliminación física por la FK **solo de esa cabecera** y auditoría con `before_value` de cada propiedad declarada, `after_value=NULL`, asociada a la operación de DELETE del hijo.
5. Inserción de los nuevos renglones y auditoría con `before_value=NULL`, `after_value` correspondiente a la operación CREATE del hijo. Si los identificadores se reutilizan, el historial anterior y nuevo siguen siendo eventos distintos.
6. Un único incremento de la versión de cabecera, y confirmación de la transacción. Un fallo SQL o de auditoría revierte **bajas, altas, eventos y versión**.

No hay un DELETE seguido por POSTs independientes: Spring utiliza el `dispatch @Transactional` y NestJS un cliente PostgreSQL fijo entre `BEGIN` y `COMMIT`.

## Pruebas reproducibles

El oráculo extendido `scripts/vnext/probe-versioned-order-http.mjs`, integrado en el workflow `vnext-b17-versioned-details.yml`, ejecutó las aplicaciones **generadas a partir de TypeSpec** y PostgreSQL real en ambos backends.

Ambas ejecuciones emitieron:

```text
PROTOCOLIA_B17_BOUNDED_REPLACE_PASS {
  "typedBoundedRows":true,
  "fullReplacement":true,
  "childCreateAndDeleteAudited":true,
  "parentAndChildWritePermissions":true,
  "oneWinnerAgainstAppend":true,
  "staleVersionRejected":true,
  "rollbackRestoresEntireCollection":true,
  "rollbackRestoresVersion":true,
  "closedOrderImmutable":true,
  "derivedTotalConsistent":true
}
```

Evidencia:
- 400 por `If-Match` ausente, 0 filas y 21 filas; 409 por identidades repetidas, expectativa obsoleta u orden cerrada; 403 por autoridad insuficiente.
- Reemplazo de dos filas: las anteriores devuelven 404, las nuevas existen, la versión pasa 1→2 y los totales SQL reflejan únicamente las nuevas filas.
- Se observaron exactamente **6 eventos de CREATE y 6 de DELETE** para dos filas y tres campos auditados, sin eventos parciales.
- Carrera reemplazo contra POST de hijo con la misma versión: **una sola operación confirma**, otra recibe 409; versión pasa 2→3.
- Se instaló un trigger temporal que provoca error durante el INSERT de auditoría de la nueva fila. HTTP 500, todas las filas originales siguen idénticas, no existe la fila nueva ni un evento parcial, y `documentVersion` permanece en 3.
- Tras eliminar el trigger, **el mismo `If-Match: "3"` sigue siendo válido** y permite confirmar el reemplazo, con versión 4 y total SQL correcto.
- Se conserva la regresión de cierre, auditoría de bajas, UI React móvil y conflictos entre altas/ediciones.

## Límites conocidos

- El reemplazo completo de colección **está expuesto en la API generada**, pero todavía **no existe un editor visual por lotes autogenerado** para este endpoint. La interfaz ya dispone de alta, PATCH, DELETE y cierre individuales de B17.4–B17.5a.
- Se usa DELETE físico con historial en `protocolia_audit_event`. No se modeló soft-delete ni auditoría temporal bitemporal.
- Si otras entidades referencian un hijo por FK con `RESTRICT`, un reemplazo que intente eliminarlo fallará y se revertirá totalmente. No hay reconciliación de referencias externas.
- No se fusionan automáticamente colecciones editadas por dos autores. Las versiones obsoletas devuelven 409 para evitar sobrescrituras silenciosas.
- Persisten pendientes las migraciones `in place` para bases ya desplegadas, el conocimiento `If-Match` en el verificador genérico y la autorización por instancia/propietario.
- No se ha validado aún una carga masiva en entornos productivos ni un estudio de rendimiento amplio. El límite deliberado de 20 filas minimiza la complejidad transaccional.

**Próximo tramo:** B17.6: migraciones seguras del esquema versionado y unificación del verificador `If-Match`, o B17.5c si se prioriza UI de reemplazo en lote. Mantener PR #53 como **Draft**, sin modificar `main`.
