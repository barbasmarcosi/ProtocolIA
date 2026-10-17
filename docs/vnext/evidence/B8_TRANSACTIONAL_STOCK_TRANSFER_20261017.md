# ProtocolIA B8 — Transferencia atómica entre dos registros y asiento de movimiento

**Fecha:** 2026-10-17. **Resultado:** PASS acotado, ambos targets generados desde un único contrato TypeSpec.  
**Commit de implementación + pruebas:** `859fdfadeaae61cc784cf49fea5d459a19e451d4`.  
**CI real:** [vnext-b8-stock-transfer #39057233608](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39057233608) — **SUCCESS** NestJS y Spring Boot.  
**Quality:** [#39057233477](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39057233477).

## Capacidad implementada

El decorador `@moveUnits("Bin","available","sourceSku","targetSku","units")`, utilizado junto a `@behavior("create","Movement")`, produce una operación de negocio de **tres escrituras en una única transacción PostgreSQL**:

1. Verifica la existencia de dos padres distintos y bloquea sus filas en orden estable por clave pública mediante `SELECT ... ORDER BY ... FOR UPDATE`.
2. Descuenta la cantidad positiva del origen si tiene saldo suficiente, y la suma al destino si no supera el máximo `int32` o `@maxValue` declarado.
3. Inserta la fila de movimiento como asiento durable. Un error en cualquiera de los tres pasos revierte la transacción completa. Un movimiento duplicado es HTTP 409 y no deja saldos parcialmente alterados.

El compilador y los adaptadores comparten validación fail-closed sobre ambos FK requeridos a la misma entidad, cantidad positiva entera, balance no negativo, ausencia de propietario implícito y permisos de escritura independientes en el recurso padre y el movimiento. Un actor debe disponer de **ambas capacidades**. El adaptador JHipster stock conserva su declaración de incapacidad de implementar el contrato completo; no se afirma un JDL ejecutable.

**Fixture:** `examples/vnext/stock-transfer/contracts/main.tsp` modela `Bin` y `Movement` de un dominio administrativo independiente; no se modifica el banco de prueba congelado de Bomberos. `packages/adapters/stock-transfer.mjs` valida IR reusando el mismo criterio en ambos generadores.

La plantilla React compartida usa los campos del contrato para mostrar ambos selectores relacionales, la ayuda transaccional y la validación contextual del caso origen=destino. El resultado es generado sin código React escrito para `Bin` o `Movement`.

## Pruebas observadas

Se ejecutaron sobre `859fdfadeaae61cc784cf49fea5d459a19e451d4`:

- TypeSpec/TypeScript y pruebas negativas B8/B7: **PASS**, incluyendo un mismo FK repetido, campo sin FK, unidades cero, status 409 ausente e IR manipulado.
- Generación limpia y smoke `npm run app:build` y `npm run app:test`: **PASS** Spring (Java 21) y Nest (Node 24), cada uno con base PostgreSQL efímera y aplicación real. Marcador `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`.
- Transferencia válida (origen 20→17, destino 20→23), transferencia duplicada rechazada 409 sin efecto, destino completo rechazado 409, ausencia de padre 400, cantidad no válida 400 y lector 403.
- Concurrencia sobre 7 unidades del origen: **7×201 + 5×409**; el destino recibe 7 unidades y el origen queda en 0.
- 24 transferencias concurrentes de sentidos contrarios sobre los mismos dos registros: **24×201**, ningún deadlock, ambos saldos originales conservados.
- Consulta directa con `psql` confirma **187 unidades totales** y **32 asientos persistidos** tras la prueba HTTP. La UI efectúa un movimiento adicional real después de esa verificación.
- Chromium móvil 390×844: se navega a movimientos, abre el formulario generado, selecciona el mismo origen y destino, observa validación por campo y comprueba que no sale ningún POST; corrige el destino, crea con HTTP 201 y verifica un asiento `UI-1` y saldos A=16, B=24. Cero excepciones JavaScript. Marcador `PROTOCOLIA_B8_TRANSFER_MOBILE_CREATE_CHROMIUM_PASS` en ambos backends.
- Logs finales en ambos jobs: `PROTOCOLIA_B8_TRANSFER_PG_HTTP_PASS` y `PROTOCOLIA_B8_TRANSFER_MOBILE_CREATE_CHROMIUM_PASS`. Capturas móviles: artifacts `b8-transfer-nestjs` y `b8-transfer-modular-spring` del workflow.

**Regresiones:** conformance genérico fue extendido para crear dos padres distintos cuando el contrato declara `moveUnits` y afirmar ambos deltas/rollback; no se reutiliza el mismo FK en las dos posiciones. Primera CI #39056715509 FAIL reveló ese defecto del generador de fixtures; segunda #39056886888 PASS en ambos targets; prueba final con UI completa #39057233608 PASS en ambos. No se interpretó un FAIL como PASS.

## Límites pendientes

- Se soporta únicamente un par de registros distintos de **una misma entidad** con un balance entero positivo/no negativo y una fila de movimiento. No es un motor arbitrario de transacciones, saga distribuida ni reconciliación contable universal; no hay múltiples partidas ni cancelación/reversión B8.
- Campos owner-managed y reglas cross-tenant no son compatibles con esta operación: se rechazan en compilación/adaptador. No hay cuotas por usuario o workflow de aprobación.
- La transacción usa bloqueos de PostgreSQL y no coordina recursos fuera de esa base. No se desarrolló aquí migración de esquema en sitio ni backfill de movimientos históricos.
- La UI real pasó en Chromium móvil, pero requiere todavía una auditoría completa con lector de pantalla y evaluación visual desktop para todas las operaciones.
- Los avisos de dependencias y deprecaciones observados en el build deberán revisarse en un incremento de mantenimiento independiente, sin ampliar seguridad sin un bloqueo demostrado.

**Despliegue:** ninguna instancia persistente Railway, Render o Neon fue alterada; las pruebas usan Compose efímero con volúmenes eliminados. Integrar por fast-forward protegido en `independent/volunteer-evaluations` tras CI; `main` y PR #52 permanecen sin fusionar.
