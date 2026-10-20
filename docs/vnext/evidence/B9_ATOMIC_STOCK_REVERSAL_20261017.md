# B9 — Reversión atómica y auditada de transferencias entre registros

**Fecha:** 2026-10-17. **Resultado:** PASS acotado en aplicaciones generadas Spring Boot y NestJS, bases PostgreSQL reales y React móvil con Chromium.
**Código validado:** `13da72769b33aa6fdefd16e6c79530393155a51b`.  
**CI ejecutable:** [B9 #39060745103](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39060745103) — **SUCCESS** (ambos backends).  
**Quality:** [#39060745123](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39060745123) — **SUCCESS**.

## Semántica declarativa

Un contrato TypeSpec con `@behavior("create","Movement")` y `@moveUnits("Bin","available","sourceSku","targetSku","units")` crea un movimiento persistente y desplaza las existencias en una transacción (B8).

B9 complementa ese contrato con la operación:

```typespec
@post @behavior("transition","Movement","status")
@transition("posted","reversed")
@reverseUnits("Bin","available","sourceSku","targetSku","units")
@audit("status")
@capability("movements.write")
op reverseMovement(@path number: string):
  Movement | NotFound | Conflict | BadRequest | Unauthorized | Forbidden;
```

- `status` es un atributo de movimiento requerido con `@initial("posted")`, nunca aportado por el cliente de una transferencia reversible.
- El compilador obliga a encontrar exactamente un creador `moveUnits` compatible, una única reversión con auditoría de estado, ambos FK tipados a la misma entidad, y prohíbe modificaciones alternativas del registro que puedan falsear origen, destino o cantidad.
- Ambos runtimes leen los datos inmutables del asiento y bloquean **primero** las dos filas padre, **ordenadas** por clave pública. A continuación efectúan una única transición condicional `posted→reversed`, descuentan unidades del antiguo destino si hay suficiente stock y acreditan el antiguo origen si existe capacidad. La escritura de auditoría ocurre antes de COMMIT, en la misma transacción.
- Si no hay movimiento: HTTP 404. Si ya está revertido, faltan unidades, se supera la capacidad o hay competición: HTTP 409 sin cambio parcial ni falsa confirmación.
- Requiere tanto la capacidad de reversión declarada en la operación como la capacidad de escritura de la entidad padre. El frontend React común descubre la transición por contrato y ofrece la acción cuando el movimiento está `posted`; no hay React específico de Bin ni Movement.
- `main`, el estudio P4 y los oráculos congelados de Bomberos no se modifican.

## Evidencia repetible

**Contrato independiente:** `examples/vnext/stock-reversal/contracts/main.tsp`.  
**Aserciones TypeSpec/IR:** `tests/vnext/stock-reversal.test.mjs`; casos negativos sobre origen y destino, emparejamiento de creador, auditoría, estado inicial, dato aportado por cliente y códigos de respuesta.  
**Prueba real:** `scripts/vnext/probe-stock-reversal-http.mjs`, ejecutada sobre Docker Compose efímero/PostgreSQL y Chromium en la matriz `nestjs`, `modular-spring`:

1. Creación de movimiento: stock origen 20→17, destino 20→23, estado `posted`. Reversión: ambos saldos a 20 y estado `reversed`. Segundo intento rechazado 409.
2. Si el destino gastó 8 de las 10 unidades recibidas, revertir devuelve 409. El estado permanece `posted` y ningún saldo se modifica. Tras reponer las 8 unidades, la reversión se completa.
3. Si el origen supera su capacidad al restaurar la cantidad, 409 con rollback; después de liberar capacidad, 200.
4. **10 solicitudes concurrentes sobre el mismo movimiento**: exactamente 1×200 y 9×409, sin stock duplicado.
5. **10 reversals concurrentes con direcciones opuestas**: 10×200, saldo final conservado, sin interbloqueos.
6. Consulta directa por `psql`: suma de existencias 185, 17 movimientos retenidos, 15 movimientos revertidos y **15 eventos de auditoría** para la operación.
7. Chromium a 390×844 inicia sesión, abre el movimiento desde React, pulsa la acción declarada de reversión y comprueba HTTP 200, estado persistido `reversed` y ambos saldos restaurados. Cero excepciones JS. Marcador `PROTOCOLIA_B9_REVERSE_REACT_CHROMIUM_PASS`.
8. Marcadores idénticos en NestJS y Spring: `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS` y `PROTOCOLIA_B9_REVERSE_PG_HTTP_PASS` con 1 ganador y 9 conflictos, 10 reversals cruzadas, journal de 18 filas con la creada desde UI y 16 reversals auditadas.

**Incidente corregido:** CI inicial [#39060557300](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39060557300) marcó FAIL para Spring: la validación de estado proporcionado por cliente ocurría después de aplicar `@initial` y rechazaba el valor generado por el propio backend. Commit `13da72769b33aa6fdefd16e6c79530393155a51b` movió el chequeo al payload original. La matriz posterior #39060745103 terminó completamente en verde.

## Límite del resultado

Esta capacidad no es una saga ni un motor universal de transacciones. Solo revierte exactamente una transferencia entre dos registros de una misma entidad con cantidad positiva `int32`, campo de disponibilidad acotado, y una fila de movimiento inmutable. No ejecuta compensaciones fuera de PostgreSQL ni conserva un ledger general de valoración monetaria.

No cubre ownership cruzado, cambios posteriores a la estructura del movimiento, idempotency keys de requests previos a la creación ni múltiples partidas por movimiento. No se hizo una auditoría WCAG integral ni se modificaron despliegues persistentes. Las regresiones del dominio independiente deben quedar verdes antes de promover a integración.

**Próximos pasos:** movimientos con múltiples partidas, operaciones de negocio transaccionales declarativas que compongan efectos sin salirse del perfil verificable, y mejora UX en operaciones complejas (revisión/confirmación y accesibilidad).
