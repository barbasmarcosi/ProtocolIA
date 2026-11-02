# R2.4 — Débito de inventario atómico con registro y reversión

**Alcance:** ejemplo TypeSpec reproducible que **reutiliza** las primitivas canónicas `@reserve` (decrementar stock e insertar un registro en la misma transacción) y `@release` (reversión de una reserva mediante transición protegida). No se añade un `atomicDecrement` genérico que permitiera mutaciones arbitrarias sin trazabilidad.

## Contrato

El ejemplo `examples/vnext/stock-debit/contracts/main.tsp` declara:
- `StockItem(sku, name, available)`: SKU string único según comparación exacta, disponibilidad `int32` acotada a 0..100000.
- `StockDebit(debitId, stockSku, units, state)`: registro por clave única, FK obligatoria a StockItem, unidades 1..1000, estado inicial servido `posted`.
- `createStockDebit`: `@reserve("StockItem","available","stockSku","units")` crea un registro y resta unidades con SQL protegido en una **única transacción PostgreSQL**. Evita saldo negativo.
- `reverseStockDebit`: `@transition("posted","reversed")` + `@release` + `@audit("state")`; la segunda reversión y las carreras por el mismo movimiento no pueden acreditar de nuevo.
- `get` y `listPage` de ambas entidades y `/health`; capacidades independientes de lectura/escritura. No se incluye `delete` del registro ni `patch` de unidades o saldo.

**No se trata de ventas completas:** no incluye efectivo, pedidos, precios, impuestos, conciliación de caja, descuentos, descuentos de stock por una venta, política de reposición ni normalización de SKU. Un débito representa un movimiento de inventario; clasificarlo como venta exige otros contratos.

## Concurrencia real (no mock)

`packages/cli/conformance.mjs` añade un caso **genérico** para contratos con `reserve` y campos compatibles, sobre la base PostgreSQL desechable del comando `npm run app:test`:

1. Crea un StockItem separado con **7 unidades**.
2. Lanza **12 solicitudes HTTP simultáneas** de 2 unidades cada una, con `debitId` distinto.
3. Exige **3 transacciones 201**, **9 conflictos 409**, saldo final **1** y correspondencia exacta entre solicitudes aceptadas y registros realmente persistidos. Una implementación vulnerable a overselling, rollback parcial o pérdidas de actualización debe fallar.
4. El test de conformance existente comprueba además duplicación de `debitId`, decremento exacto, permisos y reversión única con 10 solicitudes de reversión concurrentes.

Esta ampliación solo se ejecuta si el IR y los límites declarados permiten la muestra; el job específico de esta rama **exige** ver el marcador `PROTOCOLIA_ATOMIC_DEBIT_RACE_PASS`, evitando un falso verde por un caso omitido. Usa `app:test` que crea su propio proyecto Docker Compose, credenciales demo temporales y volumen desechable. No toca bases de datos productivas.

## Reproducción

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:vnext
./node_modules/.bin/tsp compile examples/vnext/stock-debit
npm run app:build -- examples/vnext/stock-debit --target nestjs --out /tmp/protocolia-stock-app
npm run app:test -- /tmp/protocolia-stock-app
```

El flujo NestJS/React+PostgreSQL se comprueba primero; la compatibilidad y semántica Spring se audita a nivel de adaptadores en el resto de la suite, pero **no se presenta como ejecución E2E Spring de este nuevo caso**.

## Origen y seguridad

La fuente TypeSpec es un **contrato técnico de laboratorio**, no una decisión comercial firmada del propietario. No desbloquea por sí mismo K-Q03/K-Q04 del ensayo R2: allí se continúa exigiendo una decisión de alcance y, más adelante, evidencia de legitimidad. Un stock-debit auditable es una nueva capacidad existente que ahora se ilustra y somete a estrés; no debe convertirse silenciosamente en facturación real.

El saldo y la integridad del registro se validan mediante pruebas dinámicas; no se afirma que exista todavía evaluación independiente de desempeño de agentes, seguimiento del usuario durante dos años o infraestructura autorizada para producción.
