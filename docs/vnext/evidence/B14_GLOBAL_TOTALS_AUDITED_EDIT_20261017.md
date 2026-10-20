# B14 — Total global SQL y edición auditada con control de concurrencia

**Fecha:** 2026-10-17  
**Commit funcional validado:** `d88001ff197b4fbd59f4acea3f23a2f6f7e22299`  
**CI B14:** [#39071072388](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39071072388) — **SUCCESS** en **modular-spring** y **nestjs**  
**Quality funcional:** [#39071072415](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39071072415) — **SUCCESS**

## Capacidades implementadas de verdad

### 1. Total de todos los renglones

El contrato `examples/vnext/dynamic-order-lifecycle/contracts/main.tsp` declara `@detailSum("OrderLine","orderCode","units")` sobre un `@behavior("sumDetails","PurchaseOrder")` GET con respuesta estricta `{totalUnits:string}`. El compilador verifica relación padre/hijo declarada por B12 (`@createDetails`), FK `restrict`, cantidad `int32` requerida y positiva, GET por identidad de cabecera, y correspondencia exacta con el lector de la cabecera. Ambos adaptadores usan **el mismo plan SQL validado** en `packages/adapters/detail-sum.mjs`.

El SQL usa `LEFT JOIN` con comprobación de existencia de cabecera y `COALESCE(SUM(c.units::bigint),0)::text`: un único snapshot MVCC y sin acumular montos en coma flotante JavaScript. El servidor requiere **dos permisos de lectura**: el del recurso cabecera y el del recurso hijo, antes de consultar datos. Una cabecera inexistente devuelve 404. La interfaz generada usa un bloque de resumen que aclara que incluye **todos** los renglones, independiente del subtotal de la página B13.

### 2. Edición de una descripción sin perder cambios ajenos

El contrato de ejemplo usa `@behavior("patchFields","OrderLine","product","product") @audit("product")` y el body tipado `{product:string;expected:string}`. ProtocolIA ahora puede compilar un PATCH auditado de campo simple, obligatorio, no derivado, **no FK**, no identidad ni estado gestionado. Ambos campos deben tener límites compatibles con el campo persistido; la compilación rechaza un DTO que relaje los límites de longitud. El adaptador compartido B12 también rechaza actualizaciones sin auditoría o mutaciones de FK/identidad en el hijo.

- La sentencia PostgreSQL aplica una **comparación atómica** `UPDATE ... SET product = nuevo WHERE line_code = id AND product = expected`. Si el registro existe pero fue modificado, devuelve **409**; si no existe, **404**. No se usa un read-before-write que permita lost updates.
- En Spring el PATCH participa de la transacción de `dispatch()`; en Nest el PATCH abre una transacción `BEGIN/COMMIT`, usa el mismo cliente para actualizar y escribir la auditoría, y revierte ambas cosas en una excepción.
- La auditoría guarda usuario, entidad, identidad, operación, campo, valor anterior y valor nuevo. No se generan filas de auditoría para conflictos, entradas inválidas ni actualizaciones idénticas.
- Rechaza texto vacío, propiedades ajenas, `null`, valor esperado obsoleto, actualización idéntica y credenciales sin permisos de escritura.
- El editor React aparece dentro del panel de líneas del modal **solo si** el manifiesto declara el PATCH auditado y el usuario tiene capacidad de escritura sobre el hijo. Los cambios se refrescan sin salir del detalle; no existen campos manuales específicos de `OrderLine` en el template.

## Evidencia ejecutable reproducible

- **Fixture nueva y distinta de B12/B13:** `examples/vnext/dynamic-order-lifecycle/contracts/main.tsp`, sin implementar código manual en la app generada.
- **Compiler y negativos:** `tests/vnext/dynamic-order-lifecycle.test.mjs` confirma IR y SQL global; rechaza sumas de campos incompatibles, relaciones falsas, ausencia de `expected`, edición sin auditoría y contrato de campo nuevo menos estricto que el modelo persistido. Se vuelven a correr las pruebas de B12 y B13.
- **Conformance genérico:** `packages/cli/conformance.mjs` añade `expected` cuando encuentra `patchFields` auditado y confirma que un reintento con el valor anterior devuelve 409.
- **Oracle E2E:** `scripts/vnext/probe-dynamic-order-lifecycle-http.mjs`, ejecutado sobre los **dos targets** con Docker Compose + PostgreSQL efímeros. Verifica la conservación de B12/B13 (20 filas, 7/7/6 páginas, integridad FK, rollback ante claves duplicadas, 10 altas concurrentes con 1 éxito/9 conflictos). Verifica `totalUnits="210"` para 20 líneas y `"9"` para tres; 404 del padre inexistente; acceso no autenticado 401. Edita la descripción de un hijo con dos PATCH simultáneos usando el mismo `expected`: exactamente **un 200 y un 409**; una fila real de auditoría `Café:<descripción ganadora>`; reintento viejo 409, resumen global sin cambio, payload inválido 400 y edición idéntica 409.
- **Chromium 390×844:** el React generado carga cabecera/lines/total, navega a otra cabecera, abre el editor inline, guarda la nueva descripción y actualiza el renglón visible. Confirma backend y ausencia de errores JS. Captura `b14-detail-lifecycle-mobile.png` en el directorio efímero del proyecto generado.
- **Marcadores en ambos jobs:** `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`, `PROTOCOLIA_B14_DETAIL_EDIT_CHROMIUM_PASS` y `PROTOCOLIA_B14_GLOBAL_SUM_CAS_PASS`, con `wholeDocumentSum210:true`, `auditedCompareAndSet:true`, `oneWinnerConcurrentPatch:true`, `noOrphans:true`.

Los primeros runs de este incremento fueron fallidos o cancelados por una expresión mal parentizada del validador, un patrón HTTP demasiado escapado y un verificador genérico que todavía no enviaba `expected` en el PATCH. Se corrigieron, se añadieron tests negativos y el último run sobre commit `d88001ff` pasó completo.

## Límites conocidos: no exagerar el alcance

**B14 no genera todavía un editor arbitrario de colecciones.** La edición demostrada corresponde a un **campo de texto** permitido, con comparación del valor anterior y auditoría; no modifica unidades ni precios, no permite agregar/eliminar renglones después de crear la cabecera, no implementa versionado de documentos ni máquina de estados. El total SQL es de **cantidades enteras positivas** con salida `bigint` como string; **no es un total monetario**, no incluye descuentos/impuestos ni exact-decimal calculations. No se afirma multi-tenant completo ni que el rol writer esté limitado a un documento específico: la política vigente se basa en capacidades explícitas por recurso.

El siguiente incremento debe contemplar unidades/precios editables bajo una transacción autorizada y conflict-safe, reglas sobre documentos ya confirmados, totales decimales exactos y una operación de reemplazo/adición/eliminación de líneas con identidad y auditoría sin romper la integridad de B12/B13. Otra evaluación independiente congelada permitirá medir cuánto resuelve ProtocolIA sin adaptar el generador al caso.
