# B2.5c — Conciliación exacta entre saldo inicial y movimientos

**Fecha:** 16 de octubre de 2026. **Estado:** PASS específico y regresión independiente integrada PASS.

## Contrato formal y semántica

El fixture `examples/vnext/exact-debits/contracts/main.tsp` modela `Wallet.openingBalance` y `Wallet.available` como `decimal` TypeSpec (JSON wire `string`; `NUMERIC(24,2)` PostgreSQL). Las creaciones de Wallet requieren igualdad exacta entre saldo inicial y disponible. `Charge.amount` es un decimal positivo, su FK a Wallet es requerido y su estado se inicia en `posted`; la operación `reverseCharge` genera la transición auditada `posted → reversed`.

```typespec
@route("/api/wallets/{walletCode}/reconciliation")
@get @behavior("reconcileExact", "Wallet")
@reconcileExact("openingBalance", "available", "Charge",
                "walletCode", "amount", "status", "posted", "reversed")
@capability("wallets.read")
op reconcileWallet(@path walletCode: string):
  ExactLedgerSnapshot | NotFound | Unauthorized | Forbidden;
```

El contrato requiere una respuesta tipada de ocho campos: `openingBalance`, `available`, `postedTotal`, `reversedTotal`, `expectedAvailable`, `difference`, `postingCount` como cadenas decimales y `balanced` booleano. Ningún cálculo monetario viaja en formato JSON Number.

**Cálculo autoritativo**: `expectedAvailable = openingBalance − SUM(amount WHERE status='posted')`, `difference = available − expectedAvailable`, `balanced = available = expectedAvailable`. Los cargos `reversed` se muestran en `reversedTotal` pero no se descuentan dos veces. Los agregados y los dos saldos se leen en una **única sentencia MVCC** con `LEFT JOIN LATERAL`. Una consulta retorna 404 si no existe la Wallet.

## Propagación y validaciones del generador

- `@reconcileExact` → estado del compilador TypeSpec → IR `behavior.reconcileExact` → plan SQL seguro `packages/adapters/exact-reconciliation.mjs` → NestJS/Spring/React generados.
- Rechazo de identificadores SQL no seguros, tipos incompatibles, decimales de diferente escala/precisión, saldos de apertura ausentes, FK inválida, estado inicial diferente, operación no GET, status HTTP/response incorrectos, doble conciliación, falta de lectores declarados, ciclos debit/reverse incompletos y PATCH/delete/reasignación que permitan alterar indebidamente el libro.
- `Wallet.openingBalance` y `available` deben ser campos exactos no nulos, requeridos, de mínimo cero y misma precisión/escala; la creación rechaza importes iniciales distintos con código de campo `invalid_comparison`. Spring limita esa regla a **la entidad declarada** (no por coincidencia de nombres), y Nest enlaza el manifiesto por nombre de entidad.
- Ambas APIs verifican capacidad de lectura de Wallet en la operación y capacidad de lectura de Charge en el plan, antes de consultar. No hay acceso anónimo.
- React muestra un panel de conciliación en el detalle de Wallet sólo cuando están habilitadas ambas capacidades. Tiene refresco explícito, indicador de carga, error accesible, alerta para diferencias y representación directa de las cadenas monetarias devueltas por la API. Se reutiliza para NestJS y Spring Boot.

## Evidencia ejecutable verificada

**Código funcional exacto:** [`32a8fd51f7681c20b00ea46f0a9dc3a96a3e3cdb`](https://github.com/barbasmarcosi/ProtocolIA/commit/32a8fd51f7681c20b00ea46f0a9dc3a96a3e3cdb).

- [B2.5c conformance #38903094611](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38903094611): **SUCCESS**, los dos backends sobre contrato generado, PostgreSQL descartable y Chromium móvil de NestJS.
- El oráculo crea Wallet en saldo 10.00, prueba 12 débitos concurrentes para 9.00 restantes (9 compromisos, 3 conflictos), comprueba `postedTotal=10.00`, `available=0.00`, `balanced=true`; revierte dos cargos y comprueba `postedTotal=8.00`, `reversedTotal=2.00`, `available=2.00`, `balanced=true`, sin pérdida de precisión.
- El oráculo altera directamente PostgreSQL `available=available-0.01`; la API devuelve `balanced=false`, `difference=-0.01` y conserva el total basado en movimientos. Tras la corrección externa, la conciliación vuelve a `balanced=true`.
- Se prueba un decimal mayor que `Number.MAX_SAFE_INTEGER`, reversa exacta `+0.01`, rechazo de saldo inicial inconsistente (HTTP 400 con `issues`), SQL CHECK negativo, reinicio, identidad faltante (404) y solicitud anónima (401). El Chromium móvil abre el detalle y valida el panel de saldo conciliado.
- [Quality específica #38903094822](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38903094822): **SUCCESS** sobre el SHA exacto.
- Promoción por fast-forward con SHA esperado desde `ae256255b1516eff110ac8a5cfdffec29f7aea83` a `32a8fd51f7681c20b00ea46f0a9dc3a96a3e3cdb`, sin tocar `main`.
- [Regresión oficial Bomberos #38903381081](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38903381081): **SUCCESS** NestJS + Spring/PostgreSQL, HTTP independientes y Chromium.
- [Quality integrada #38903381027](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38903381027): **SUCCESS**, sobre el mismo código funcional. Este commit de documentación posterior no es una nueva ejecución de código.

## Límites y riesgos

1. Es **detección de discrepancias**, no reparación automática; ante `balanced=false`, se debe inspeccionar el movimiento, la auditoría y el origen de la escritura.
2. Una modificación SQL externa coordinada que altere a la vez `openingBalance`, `available` o los cargos puede manipular la comparación; no hay ledger append-only a nivel de roles SQL, control de dos-personas, firma criptográfica ni autenticación/operaciones financieras productivas.
3. No existen conciliación externa bancaria, reservas distribuidas, monedas o FX, idempotencia entre integraciones, conciliación con pasarelas de pago, impuestos ni doble partida.
4. Las capacidades del prototipo se basan en roles de demostración. El oráculo **no** incluye todavía una identidad con lectura de Wallet pero sin lectura de Charge para medir el 403 de segundo permiso. S1 debe cubrir autorizaciones por registro/campo y sujetos negativos reales.
5. Crear o migrar Wallet existente con nuevo `openingBalance` requiere una estrategia declarativa y pruebas de datos históricos. No se aplicó ninguna migración sobre Neon, ni cambio de la demo Railway. `main` y PR #52 continúan intactos.
6. La regresión verde no implica que los **16 requisitos congelados de Bomberos** estén terminados; B2.5c es una capacidad transversal del generador.

**Siguiente incremento:** S1 autorización por registro/campo, proveer identidades adversariales (sólo lectura padre, sólo lectura hija y ninguna), controles API+SQL+UI, sin ampliar a producción ni tocar Neon.
