# B17.5a — Cierre terminal y auditado de documentos versionados

**Fecha:** 2026-10-20  
**Base:** B17.1–B17.4, rama `feature/b17-atomic-bounded-detail-append-20261020`.  
**Commit funcional verificado:** `292aaeeed9c8557f6f96dca8f023702e168b5963`.  
**Integración real:** [GitHub Actions #39478935642](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39478935642) — **SUCCESS** en `modular-spring` y `nestjs`, con PostgreSQL y Chromium 390px.

## Propósito

B17.4 permitía modificar una orden con control optimista de su versión, pero aún faltaba una operación terminal para inmovilizarla. B17.5a añade un cierre de cabecera declarado en TypeSpec, que coordina de manera transaccional:
- transición de estado inicial a terminal;
- comparación con la versión global solicitada en `If-Match: "N"`;
- auditoría de estado `before_value` / `after_value`;
- incremento de versión;
- bloqueo posterior de **todas** las modificaciones directas del detalle (POST, PATCH, DELETE) incluso si el cliente conoce la versión más reciente.

## Contrato: opt-in y cierre explícito

La anotación anterior `@versionedDetails` sigue siendo válida sin argumentos y mantiene su comportamiento histórico. La nueva forma optativa es:

```typespec
model PurchaseOrder {
  @publicIdentity @unique code: string;
  title: string;
  @initial("draft") status: string;
}

@post @behavior("create","PurchaseOrder")
@createDetails("OrderLine","orderCode","lines")
@versionedDetails("status","closed") @capability("orders.write")
op createPurchaseOrder(...): ...;

@route("/api/orders/{code}/close")
@post @behavior("transition","PurchaseOrder","status")
@transition("draft","closed") @audit("status") @capability("orders.write")
op closePurchaseOrder(@path code:string,@header("If-Match") ifMatch:string):
  VersionedPurchaseOrder | Invalid | Conflict | Missing | Unauthorized | Forbidden;
```

El compilador valida un solo cierre de la cabecera, estado inicial persistido, destino terminal permitido, auditoría exclusiva del campo de estado, la misma capacidad de escritura declarada para la cabecera, estados HTTP explícitos y ninguna otra mutación no protegida de la cabecera. Se rechaza un ciclo de vida ambiguo, incluido un intento de reapertura. Los valores del decorador se preservan como literales TypeSpec, sin coerción insegura de objetos.

## Implementación del backend

**Spring Boot:** el método genérico de transición terminal bloquea la cabecera por `document_version` bajo `@Transactional`, ejecuta el cambio `draft → closed` mediante CAS SQL, incrementa la versión y registra su auditoría en la misma transacción del `dispatch`.

**NestJS:** la transición terminal utiliza un cliente PostgreSQL fijo entre `BEGIN` y `COMMIT`. El bloqueo, el CAS de estado, la auditoría y la actualización de versión comparten la misma transacción.

El guard de versión compartido detecta el estado terminal bajo el bloqueo `SELECT … FOR UPDATE`. Una vez cerrado, los POST de detalle, PATCH auditados y DELETE auditados son rechazados con 409 aun con `If-Match` vigente. La autorización de cierre sigue dependiendo de `orders.write`.

## UI React generada

El componente común para NestJS y Spring reconoce la transición vinculada a `createDetails.closeField` / `closeState`, recibe la versión de cabecera por GET autenticado y envía el correspondiente `If-Match` al cerrar. Al confirmar, actualiza el estado y versión y deja los controles de cambio en modo **solo lectura**. La pantalla conserva la recuperación explícita ante errores 409 ya implementada en B17.4.

No se creó una página `PurchaseOrder` específica: tanto el botón de transición como la vista de renglones proceden del manifiesto generado desde TypeSpec.

## Pruebas ejecutadas

La matriz [#39478935642](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39478935642) completó con éxito en ambas aplicaciones generadas y emitió:

```
PROTOCOLIA_B17_TERMINAL_DOCUMENT_PASS {
 "strongIfMatchRequired":true,
 "parentWriteRequired":true,
 "auditableClose":true,
 "closePreventsAppend":true,
 "closePreventsPatch":true,
 "closePreventsDelete":true,
 "closeVersusAppendOneWinner":true,
 "auditRollbackPreservesDraft":true,
 "retrySameVersionAfterRollback":true
}
```

La comprobación HTTP exigió:
- 400 por `If-Match` ausente/débil y 403 a un actor sin permiso de cabecera.
- Cierre válido 200: estado `closed`, versión siguiente, `ETag` consistente en GET y un único evento auditado `status:draft:closed`.
- Reintento de cierre, creación, edición o eliminación posteriores: 409.
- Carrera **cierre/alta** con la misma versión: exactamente un éxito y un 409; en SQL, versión, estado y renglones coherentes.
- Trigger PostgreSQL con excepción durante la auditoría del cierre: HTTP 500, estado y versión anteriores preservados y ningún evento parcial. Tras retirar el trigger, el mismo ETag se acepta y se confirma la operación.

Chromium 390 × 844, en ambos backends, emitió:

```
PROTOCOLIA_B17_VERSIONED_REACT_PASS {
 "mobileViewport390":true,
 "stalePatch409":true,
 "conflictRecoveryRefresh":true,
 "generatedPatch":true,
 "generatedAppend":true,
 "generatedDelete":true,
 "strongIfMatchForwarded":true,
 "totalsUpdated":true,
 "lastRowDeleteDisabled":true,
 "capabilityActionsHidden":true,
 "terminalCloseUi":true,
 "closedDocumentUiReadOnly":true,
 "consoleErrorsNone":true
}
```

Se conserva también la regresión de auditoría transaccional y de bajas B17.3b. Se generan capturas móviles de los dos backends como artefactos del workflow.

## Límites y próximo incremento

**B17.5a no equivale a completar todo B17.5.** Quedan pendientes:
1. Reemplazo masivo/acotado y **atómico** de los renglones de una orden, preservando límite 1–20, CAS global, permisos y eventos de auditoría.
2. Migración SQL *in place* de órdenes ya desplegadas y estrategia de rollback de migraciones, además de detección del esquema anterior.
3. Incorporar conocimiento del protocolo `If-Match` en la conformance genérica de ProtocolIA, en vez de depender únicamente del oráculo especializado B17.
4. Autorización por propietario o ámbito de instancia, no solamente por capacidad global.
5. Flujo de confirmación explícita antes del cierre definitivo, así como pruebas extensas de accesibilidad y distintas resoluciones: Chromium a 390px no es una auditoría UX integral.
6. Estrategia de prohibición de cierres sobre documentos con procesos de negocio pendientes en otros modelos: esta versión valida consistencia de una colección, no todos los flujos comerciales.

El PR #53 debe permanecer **Draft**; no modificar `main` sin decisión explícita.
