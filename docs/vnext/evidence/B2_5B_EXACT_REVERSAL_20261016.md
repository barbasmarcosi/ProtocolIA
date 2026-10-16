# B2.5b — Reversa decimal exacta, estado terminal y crédito exactamente una vez

**Fecha:** 2026-10-16. **Estado: PASS acotado; regresión independiente PASS.**

## Contrato y arquitectura

Fuente ejecutable: [`3ea9d3de15dd472d70f6787a1feb2164d8d0add8`](https://github.com/barbasmarcosi/ProtocolIA/commit/3ea9d3de15dd472d70f6787a1feb2164d8d0add8) en `independent/volunteer-evaluations`.

El contrato independiente `examples/vnext/exact-debits/contracts/main.tsp` ahora define Charge con `@initial("posted") status: string`. La operación reversible se declara:

```typespec
@route("/api/charges/{chargeNumber}/reverse") @post
@behavior("transition", "Charge", "status")
@transition("posted", "reversed")
@reverseExact("Wallet", "available", "walletCode", "amount")
@audit("status")
@capability("charges.write")
op reverseCharge(@path chargeNumber: string):
  Charge | BadRequest | Conflict | NotFound | Unauthorized | Forbidden;
```

- Decorador `@reverseExact`, IR `behavior.reverseExact` y plan portable único en `packages/adapters/exact-debit.mjs`.
- Exige exactamente una operación CREATE anterior con `@debitExact` y mismos campos/tipos, estado inicial correcto, transición terminal y auditoría de estado. Compilador y generadores rechazan reglas inconsistentes, duplicados, referencias peligrosas, alternativas de transición, deletes/reasignación y PATCH sobre campos protegidos.
- El máximo permitido del balance se deriva de `decimal.max` o del máximo de `NUMERIC(p,s)`. Se impide un crédito que exceda ese máximo, conservando el estado original.
- Nest: conexión fijada, `BEGIN`, UPDATE condicional `status=posted → reversed RETURNING wallet_code,amount`, crédito `NUMERIC` parametrizado y evento auditado, `COMMIT/ROLLBACK`.
- Spring: `@Transactional`, UPDATE condicional `RETURNING`, `BigDecimal` con `NamedParameterJdbcTemplate` y el evento existente de auditoría dentro de la misma transacción.
- Autorización en ambos backends exige `charges.write` y `wallets.write` antes de ejecutar el efecto. El frontend generado expone una acción de transición en el detalle sólo cuando coincide el estado permitido, sin implementar una pantalla por dominio.

## Evidencia del SHA exacto

1. [Conformance B2.5b #38863631507](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38863631507) — **SUCCESS** con NestJS/Spring Boot, PostgreSQL descartable y Chromium móvil. Logs `PROTOCOLIA_B2_EXACT_REVERSAL_PASS` de ambos backends. Tras 10 llamadas concurrentes a la misma reversa: **1 éxito (200), 9 conflictos (409)** y exactamente una restitución de saldo. Dos cargos distintos revertidos registraron exactamente dos eventos de estado, y la tercera reversa de precisión alta también quedó auditada.
2. El ensayo fuerza un saldo a su límite `9999999999999999999999.99` y verifica que el crédito `+0.01` falla (409), deja el cargo `posted`, y no debita/acredita ni audita esa reversa; tras reponer saldo viable, acredita exactamente `0.01` a un saldo que supera el entero seguro JS.
3. Se vuelven a verificar débitos concurrentes (**9×201, 3×409**), rollback de identidad duplicada, SQL CHECK negativo y persistencia tras reinicio; en Chromium móvil se crea Wallet/Charge y se acciona `reverseCharge` desde el detalle de React generado.
4. [Quality #38863631509](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38863631509) — **SUCCESS** sobre el mismo SHA. Hubo un primer ensayo fallido anterior por expectativa obsoleta del probe (`...93.98` después de una reversa exitosa, cuando el saldo correcto era `...93.99`); el probe se corrigió y se reejecutó íntegro.
5. Promoción por fast-forward con `expected_sha` desde `bd7fbe4eb41d1c05c2cfe488a7f9af324a18554d` a `3ea9d3de15dd472d70f6787a1feb2164d8d0add8` sin modificar main.
6. [Regresión independiente Bomberos #38863941126](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38863941126) y [quality integrada #38863941119](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38863941119) — ambas **SUCCESS** sobre `3ea9d3de15dd472d70f6787a1feb2164d8d0add8`, incluyendo Spring/Nest, PostgreSQL y Chromium.

## Limitaciones y riesgos no resueltos

- Exactamente una acreditación por **movimiento en estado posted**, no un sistema genérico de deduplicación de negocio o idempotency keys. Un cargo nuevo con nueva identidad sigue siendo una operación distinta.
- Una transacción local de PostgreSQL con un solo movimiento hijo y un saldo padre; no soporta transferencias multiparte, compensación distribuida, pagos externos, impuestos, tipos de cambio, conciliación contra saldo de apertura ni reembolsos arbitrarios.
- Los CHECK SQL protegen rangos y estados permitidos, pero una escritura SQL directa con privilegios suficientes podría modificar `status` sin el crédito (o crédito sin movimiento): la consistencia cross-table aún requiere conciliación/permisos SQL más restrictivos.
- S1 autorización por registro/campo pendiente. Los usuarios de prueba usan Basic Auth de demo; no habilita operación financiera productiva.
- No hay migración `reverseExact` probada sobre datos previos. No tocar Neon ni la demo Railway UX9 con este contrato. El freeze de 16 requisitos de Bomberos no se altera ni se contabiliza como completado.
- La evidencia visual es funcional (Chromium) y captura preservada en Actions; no equivale a aprobación humana de diseño.

**Siguiente incremento recomendado:** B2.5c lectura reconciliada de saldo inicial + débitos activos/revertidos, con oráculos negativos contra alteraciones SQL directas y política de privilegios de base de datos.
