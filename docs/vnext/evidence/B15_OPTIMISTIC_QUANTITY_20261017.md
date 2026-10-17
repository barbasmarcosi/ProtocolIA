# B15 — Edición optimista y auditada de cantidades en renglones

**Fecha:** 2026-10-17  
**Commit funcional validado:** `fec97397bdb085a4d6b4f72b0b17ab6baf016d4d`  
**CI funcional definitiva:** [#39076279230](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39076279230) — **SUCCESS** en `nestjs` y `modular-spring`  
**CI calidad:** [#39076279231](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39076279231) — **SUCCESS**

## Nueva capacidad derivada exclusivamente de TypeSpec

`examples/vnext/dynamic-order-quantity/contracts/main.tsp` declara el cuerpo `QuantityChange` con `units:int32` y `expected:int32`, ambos con `@minValue(1) @maxValue(100)`, y un `PATCH /api/order-lines/{lineCode}/units` vinculado con `@behavior("patchFields","OrderLine","units","units") @audit("units")`.

La validación del compilador ahora permite un `patchFields` auditado de **int32 positivo y acotado** para hijos del contrato `@createDetails`. Exige que el campo persistido, el nuevo valor y el valor esperado sean `int32`, requeridos y no nulos, con exactamente los mismos límites; no admite FK, clave pública, campo derivado, estado inicial ni identidad del propietario. El máximo admitido en este perfil es 1.000.000.000; el caso congelado de órdenes exige 1..100. Un validador compartido y verificaciones de cada adaptador vuelven a comprobar las restricciones antes de generar backend.

## Semántica del runtime

- El `PATCH` mantiene la comparación atómica `UPDATE ... SET units = :nuevo WHERE line_code = :id AND units = :expected`. PostgreSQL arbitra la carrera: éxito 200 solo para el valor vigente; intento obsoleto 409; identidad inexistente 404. No-op 409. Valores no enteros, nulos, fuera de rango y cadenas donde se espera int32 reciben 400.
- La auditoría es parte de la misma transacción que el cambio de cantidad; guarda identidad, operación, actor, cantidad anterior y nueva. Un conflicto no escribe auditoría ni altera el total.
- `@detailSum`, ya existente desde B14, calcula con `SUM(units::bigint)` y resultado en texto. No se persiste un total duplicado que pueda quedar desincronizado; cada lectura posterior al `COMMIT` consulta los valores confirmados en PostgreSQL.
- El editor React compartido detecta que el campo auditado es `int32`, genera input numérico con `min`, `max`, `step=1`, valida el número entero sin notación exponencial y envía un solo PATCH con `expected`. Después de guardar vuelve a consultar las filas y actualiza el bloque de total SQL.

## Evidencia independiente de implementación manual

- El nuevo ejemplo `dynamic-order-quantity` se compila exclusivamente desde los contratos. Mantiene y vuelve a probar B12/B13/B14 mediante el `node --test` completo y `npm run app:build/app:test` de ambos targets.
- `tests/vnext/dynamic-order-quantity.test.mjs` afirma los metadatos del nuevo PATCH y el aggregate SQL y prueba que TypeSpec rechaza DTO de cantidad o expected sin límites equivalentes, expected ausente, suma sobre campo inválido, relación falsa y edición sin auditoría.
- `packages/cli/conformance.mjs` elige un valor int32 válido nuevo y suministra el expected obtenido del cuerpo generado; una repetición obsoleta produce 409 sin lógica de dominio hardcodeada.
- `scripts/vnext/probe-dynamic-order-quantity-http.mjs` ejecutó dos aplicaciones completas sobre PostgreSQL efímero con Docker Compose. Repite la creación dinámica de 20 filas, integridad de FK, rollback, 10 creaciones concurrentes con 1 éxito y 9 conflictos, paginación y agregación global. Después intentó `units=7` y `units=12` simultáneamente contra `expected=2`: **1 éxito 200 + 1 conflicto 409**, una fila exacta de auditoría `2:<ganadora>`. Total de la orden pasa de `9` a `ganadora + 7`, mientras otra orden conserva `210` unidades. Los payloads inválidos no cambian nada.
- Chromium 390×844 abrió la orden editada, comprobó su suma derivada, introdujo `30` en el editor numérico, esperó PATCH 200 y verificó `units=30` por API junto al nuevo total global **37** en PostgreSQL y en el bloque React. Sin errores JS. Captura `b15-detail-quantity-mobile.png` en el workspace efímero de CI.
- En ambos jobs aparecen los marcadores `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`, `PROTOCOLIA_B15_QUANTITY_EDIT_CHROMIUM_PASS` y `PROTOCOLIA_B15_QUANTITY_CAS_AGGREGATE_PASS`, con `globalTotalRecalculated:true`, `integerBoundsEnforced:true`, `oneWinnerConcurrentPatch:true`, `noOrphans:true`.

## Incidencias tratadas sin maquillar resultados

La primera matriz [#39075984384](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39075984384) falló por un tipo TypeScript que no aceptaba el valor `null` de un parser. La siguiente [#39076030281](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39076030281) falló por la validación del ciclo de vida de hijos B14, que solo admitía texto. La tercera [#39076087991](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39076087991) pasó Spring y falló un oráculo Nest en Chromium: esperaba erróneamente el total anterior a la carrera `9`. La aserción fue corregida a `String(ganadora+7)`. La matriz final [#39076279230](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39076279230) **pasó por completo en ambos targets**, más calidad.

## Límites y siguiente hito

El perfil probado permite **una operación de `patchFields` por entidad**, por eso B14 y B15 usan **fixtures separadas**: una para modificar descripción, otra para modificar unidades. Aún no se pueden editar libremente descripción, cantidad y precio dentro de un mismo documento mediante operaciones independientes. Tampoco existe reemplazo transaccional de colecciones, adición/eliminación posterior de renglones, cierre/posting de documentos, control monetario `decimal` ni aislamiento por propietario para cada cabecera. No se realizó ningún despliegue persistente ni cambio a `main`.

El siguiente incremento debe habilitar **múltiples campos editables por línea con auditoría y permisos diferenciados**, respetando los metadatos en la UI; luego incorporar mutación de colecciones con reglas de versión, estado y conciliación y un caso de aceptación independiente congelado antes de la generación.
