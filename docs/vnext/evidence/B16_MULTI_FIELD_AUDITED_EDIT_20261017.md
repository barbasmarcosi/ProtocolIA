# B16 — Edición de múltiples campos auditados con permisos independientes

**Fecha:** 2026-10-17  
**Commit funcional probado:** `334ee8a0385f6fdc7d82aa70bb2c043931708d37`  
**Matriz definitiva:** [#39078089678](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39078089678) — **SUCCESS** en `nestjs` y `modular-spring`  
**Quality:** [#39078089651](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39078089651) — **SUCCESS**.

## Qué cambió

ProtocolIA ya generaba desde TypeSpec una cabecera de orden con filas variables (B12), su consulta paginada (B13), totales enteros PostgreSQL (B14) y una edición auditada de un solo campo por entidad (B14/B15). B16 elimina esta última limitación **en el perfil de hijo relacional declarado por `@createDetails`**: acepta de una a tres operaciones `patchFields` auditadas, cada una sobre un **campo distinto** y con **capacidad de escritura distinta**.

El ejemplo `examples/vnext/dynamic-order-multi-edit/contracts/main.tsp` declara dos endpoints diferentes sobre `OrderLine`:
- `PATCH /api/order-lines/{lineCode}/product`, `@behavior("patchFields","OrderLine","product","product") @audit("product") @capability("lines.product.write")`.
- `PATCH /api/order-lines/{lineCode}/units`, `@behavior("patchFields","OrderLine","units","units") @audit("units") @capability("lines.write")`.

El compilador TypeSpec valida el DTO `{expected,nuevo}`, límites y tipos idénticos al campo persistido, audita exactamente el campo editado y rechaza identidades, referencias padre, estados o campos computados. También rechaza múltiples endpoints para el mismo campo, capacidades compartidas entre editores y cambios sin auditoría. `packages/adapters/create-details.mjs` aplica verificaciones equivalentes antes de cualquiera de los dos generadores.

Las aplicaciones generadas mantienen la semántica de **compare-and-set atómico** PostgreSQL y auditoría en la misma transacción que B14/B15. Un `expected` obsoleto es 409; 404 distingue identidad ausente; entradas inválidas son 400. Permisos separados son enforced en el backend: el permiso de cambiar descripciones no otorga el de cambiar cantidades.

La plantilla React compartida recibe `patchFieldsOptions` desde el manifiesto del generador, muestra **un botón por campo permitido** y genera el formulario correspondiente con validación de string/int32, sin lógica específica de `OrderLine`. Preserva el test-id anterior de un editor cuando solo existe uno, para no quebrar B14/B15. La prueba de conformidad de CLI también itera todos los PATCH disponibles en vez de probar uno arbitrario.

## Pruebas verificadas

- `tests/vnext/dynamic-order-multi-edit.test.mjs`: contrato TypeSpec compilado → IR con dos operaciones, dos capacidades y auditorías; negativos para campos duplicados, permisos coincidentes, ausencia de auditoría e intento de editar una FK.
- `npm run app:build` + `npm run app:test` de cada target, con PostgreSQL y Docker efímeros, ejecutaron el verificador genérico y el caso completo de B12–B15.
- `scripts/vnext/probe-dynamic-order-multi-edit-http.mjs`: conserva 20 renglones, rollback por duplicados, paginación y total global SQL. Prueba dos PATCH concurrentes a cantidades (**uno 200 y otro 409**), dos PATCH concurrentes a descripción (**uno 200 y otro 409**), valores totales inalterados tras cambio de texto y **exactamente dos auditorías** para los campos `product` y `units`.
- El usuario de prueba `product_editor` tiene `orders.read,lines.read,lines.product.write`, pero no `lines.write`. En **ambos** runtimes se validó **PATCH descripción 200** y **PATCH unidades 403**. Es una prueba de seguridad de servidor, no de visibilidad de botón.
- Chromium 390×844 abre la orden en React generado, encuentra **ambos editores** para el mismo renglón, modifica unidades y observa el total SQL actualizado, luego modifica la descripción y verifica que ese total no cambia. Sin errores JavaScript. Captura: `b16-detail-multi-edit-mobile.png` en el proyecto efímero de CI.
- Ambos jobs terminaron con `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`, `PROTOCOLIA_B16_MULTI_FIELD_CHROMIUM_PASS` y `PROTOCOLIA_B16_TWO_FIELD_CAS_PASS`. La última evidencia incluye `twoDistinctFieldAudits:true`, `scopedWriterCannotUpdateQuantity:true`, `globalTotalRecalculated:true`, `oneWinnerConcurrentPatch:true` y `noOrphans:true`.

## Transparencia sobre intentos y límites

Dos ejecuciones B16 preliminares fallaron porque el compilador rechazó antes de lo esperado dos contratos negativos (diagnóstico `invalid-audit` en vez del diagnóstico específico de edición). El compilador **sí rechazaba** correctamente ambos contratos. Se corrigieron únicamente las expectativas del test para registrar el diagnóstico real. La matriz final `#39078089678` pasó por completo y quality también.

**No se afirma edición general de colecciones:** el perfil permite hasta tres campos escalares auditados por fila, cada PATCH individual con su `expected`. No hay un PATCH conjunto atómico de varios campos ni inserción/eliminación de filas en documentos ya creados. No hay transacciones entre una edición de unidades y una edición de producto; cada PATCH es su propia transacción. No genera aún totales monetarios `decimal` con impuestos/descuentos ni políticas de estado para documentos confirmados. Los permisos son por operación/recurso, no por propietario de cada orden.

**Siguiente hito:** operaciones de agregar/retirar/reemplazar renglones con versión del documento, verificación de `expectedVersion`, auditoría y transacción en ambos backends; sobre esa base, estados y reglas de cierre/confirmación de órdenes. Antes de afirmar generación de un sistema empresarial completo, realizar una prueba independiente de requisitos congelados en un dominio no modelado en las fixtures B12–B16.
