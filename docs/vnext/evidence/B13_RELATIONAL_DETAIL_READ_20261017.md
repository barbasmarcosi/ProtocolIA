# B13 — Lectura integrada y paginada de renglones generados

**Fecha:** 2026-10-17.  
**CI de producto:** [vnext-b13 #39067132713](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39067132713) — **SUCCESS** en `modular-spring` y `nestjs`.  
**CI de calidad:** [#39067132723](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39067132723) — **SUCCESS**.
**HEAD fuente probado:** `08db0876f2c2832424f23462ab72615c8bfa7e5b`.

## Capacidad real, sin generadores especiales para el dominio

B13 reutiliza dos primitivas que ya integraba ProtocolIA:

1. B12 `@createDetails("OrderLine","orderCode","lines")` sobre CREATE de la entidad cabecera;
2. `@behavior("queryPage","OrderLine")`, `@queryOrder("lineCode","asc")` y `@queryFilter("orderCode","eq")` sobre un GET paginado del hijo.

**No se agrega una excepción al compilador ni SQL escrito a mano para una orden:** el compilador existente genera el IR, el plan de consulta, los índices y los adaptadores Spring/Nest. La plantilla React común busca la entidad hija desde `createDetails`, verifica una consulta `queryPage` con filtro **local, tipado, exacto, por la FK declarada**, exige las capacidades de lectura de `queryPage` y `get` de la entidad hija, y genera un panel dentro del modal de detalle de la cabecera.

El panel solicita **siempre** `orderCode=<identidad seleccionada>` junto con `limit` y `offset`, valida `items`, `total` y que **todas las filas devueltas** tengan la FK solicitada; nunca hace un `listPage` sin filtro como fallback. Paginación y ordenamiento se ejecutan en SQL, no en memoria del navegador. La interfaz tiene feedback de carga, error accesible, recarga, navegación anterior/siguiente, total de renglones y renglones visibles.

La UI muestra una suma para el primer campo int32 no negativo **solo de la página visible**, rotulada expresamente como tal. Esto **no es** una suma global de la orden; un total agregado completo en SQL requiere otro contrato declarativo y es un pendiente deliberado.

## Evidencia ejecutable

- **TypeSpec independiente:** `examples/vnext/dynamic-order-read/contracts/main.tsp` agrega un `queryPage` de OrderLine por `orderCode` sin modificar el ejemplo B12.
- **IR y validación fail-closed:** `tests/vnext/dynamic-order-read.test.mjs`, ejecutado junto al test B12. Verifica el filtro local de igualdad, su tipo `string`, el orden determinista y el generador SQL; rechaza campos inexistentes, operadores incompatibles y ausencia de orden declarado.
- **PostgreSQL/HTTP reales:** `scripts/vnext/probe-dynamic-order-read-http.mjs` parte del oráculo B12 (transacciones, 20 filas y rollback de unicidad) y añade consultas paginadas de la orden con 20 renglones: 7+7+6, `total=20` en cada página, ninguna fila de otra cabecera; consulta de otra orden `total=3`; rechazo de límites inválidos y parámetros desconocidos, y 401 para credenciales inválidas.
- **Chromium móvil 390×844:** la UI generada crea dos renglones después de agregar y eliminar otros, abre la orden de 20 filas en el modal, lee 7, avanza a 8–14, avanza a 15–20, vuelve a 8–14 y cambia a la orden de tres renglones sin filtración de datos. Verifica que el subtotal diga **«en esta página»**, cero errores JS, y captura `b13-detail-read-mobile.png` dentro del app generado.
- **Marcadores presentes en ambos runtimes:** `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`, `PROTOCOLIA_B13_DETAIL_PAGE_CHROMIUM_PASS` y `PROTOCOLIA_B13_SQL_DETAIL_PAGING_PASS`, con `allPagesScoped:true`, `paginatedTwenty:true`, `noOrphans:true`.

## Incidencia corregida

La primera matriz [#39066909315](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39066909315) **FAIL** en ambos Chromium: la pantalla incrementaba `offset` y actualizaba el texto «15–20» mientras las siete filas de la página anterior permanecían visibles. Se corrigió el contrato local de presentación con `state.offset` correspondiente a la respuesta recibida y `pending=busy || state.offset!==offset`; mientras una nueva página está pendiente, los datos anteriores quedan ocultos y se muestra el spinner. La **segunda matriz** [#39067132713](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39067132713) fue **SUCCESS** en ambos targets.

## Límites y siguiente incremento

No se implementa todavía edición de renglones existentes, suma global SQL, campos decimales totales ni una entidad hija exclusivamente modificable por la cabecera. El panel usa 7 elementos por página dentro del perfil probado `limit:1..50`. La consulta depende de que exista en el contrato un `queryPage` compatible y de que el usuario tenga capacidades de lectura en los recursos pertinentes; no se crean permisos implícitos ni se inventan rutas.

Los servicios persistentes no se modificaron; `main` y PR #52 se mantienen. La integración se condiciona a CI de calidad, verificación del dominio independiente previamente congelado y aprobación del workflow.
