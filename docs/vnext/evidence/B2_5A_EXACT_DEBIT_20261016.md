# B2.5a — Débito exacto transaccional de dos entidades
Fecha: 16 de octubre de 2026. **PASS acotado y regresión independiente PASS.**

## Contrato y semántica

El fixture independiente `examples/vnext/exact-debits/contracts/main.tsp` declara:
```typespec
@route("/api/charges") @post
@behavior("create","Charge")
@debitExact("Wallet","available","walletCode","amount")
@audit("amount")
@capability("charges.write")
op createCharge(@body input: ChargeRequest):
  { @statusCode _: 201; @body charge: Charge; }
  | BadRequest | Conflict | Unauthorized | Forbidden;
```

`Wallet.available` y `Charge.amount` son `decimal` TypeSpec con `@encode(string)` y `@exactDecimal`. Balance mínimo `0`, importe mínimo positivo `0.01`, igual escala (2), precisión de balance al menos tan amplia como importe y FK `Charge.walletCode → Wallet.walletCode` obligatorio. No se habilitan expresiones libres ni SQL procedente del contrato.

La metadata `debitExact` se valida en el compilador/IR y de nuevo mediante `packages/adapters/exact-debit.mjs`, consumido por ambos generadores. Debe ser CREATE con respuestas 201/400/409, no puede coexistir con `reserve`/`release`, y exige que la entidad padre tenga un CREATE con capacidad de escritura distinta de `public`.

## Comportamiento comprobado

- NestJS usa conexión fijada, `BEGIN`, `UPDATE ... available=available-$1::numeric WHERE wallet_code=$2 AND available>=$1::numeric`, `INSERT` y, cuando está declarado, evento de auditoría; ante fallo ejecuta `ROLLBACK`.
- Spring Boot 4 usa un único `@Transactional` y `BigDecimal` con `NamedParameterJdbcTemplate`, incluyendo auditoría bajo el mismo commit. Ningún cálculo monetario usa IEEE-754 `Number`.
- Ambos comprueban capacidad de escritura para Charge **y** Wallet antes de efectos de dominio; no basta ocultar acciones en React.
- Error de importe malformado: HTTP 400 con `issues` tipados; wallet inexistente: HTTP 400; saldo insuficiente: HTTP 409; identidad de cargo duplicada: 409 y débito previo revertido.
- PostgreSQL retiene NUMERIC(24,2), exige `available>=0` y `amount>=0.01` y rechaza una actualización SQL que haga negativo el saldo; no protege por sí sola la conciliación entre inserts SQL directos y cargos.
- La UI autogenerada se ejercitó en Chromium móvil, creando Wallet, seleccionando su FK desde Charge y registrando un importe decimal sin código React por entidad.

### Pruebas y resultados en SHA exacto

Fuente funcional: [`34b201010fdd880b4113e68943885c9ebe0d27d4`](https://github.com/barbasmarcosi/ProtocolIA/commit/34b201010fdd880b4113e68943885c9ebe0d27d4).

- [B2.5a conformance #38861898964](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38861898964): **SUCCESS** con NestJS/Spring Boot, PostgreSQL descartable y React Chromium móvil. El oráculo creó un cargo inicial por 1.00, luego **12 solicitudes simultáneas** sobre saldo restante 9.00: exactamente **9×201 y 3×409**; saldo final 0.00. Se probó rollback por identidad duplicada, auditabilidad (11 eventos sólo para 11 cargos comprometidos), importes de escala inválida, autorización básica y permanencia tras reinicio. Saldo `9007199254740993.99` menos `0.01` se conservó como `9007199254740993.98`.
- [Quality #38861898645](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38861898645): **SUCCESS** sobre el mismo SHA.
- Promoción estricta por fast-forward y comparación de ancestry desde `9a6d873dca32862817f98edd8bdfa2ef9161bab4` a `34b201010fdd880b4113e68943885c9ebe0d27d4`, sin force.
- [Bomberos independientes #38862188292](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38862188292): **SUCCESS** sobre el SHA integrado, ambos backends PostgreSQL/HTTP y Chromium Nest.
- [Quality integrada #38862188266](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38862188266): **SUCCESS** sobre ese SHA. Los commits documentales posteriores no constituyen una nueva aceptación del código.

## Límites expresos

1. Un débito en el balance de una entidad padre y un único movimiento hijo por transacción PostgreSQL local. Sin reembolsos, transferencias, reconciliación general, asientos dobles, moneda/cambio de divisas, reversas ni contabilidad productiva.
2. El identificador de cargo único evita el doble débito en un duplicado, pero una repetición deliberada con otro identificador es otra transacción válida; no existe idempotencia de negocio independiente ni libro mayor protegido de escrituras directas.
3. `@audit` es explícito; la atomicidad de auditoría está probada **cuando se declara**, no se obliga de manera automática. Sin política de retención/identidad IAM productiva.
4. El modelo de permisos sigue siendo de demostración y por capacidad: aún no se probó un principal que tenga únicamente escritura de Charge y no la de Wallet; falta S1 por fila/campo. No habilita producción.
5. La garantía de escala estricta se aplica a HTTP antes del driver; PostgreSQL `NUMERIC(p,s)` puede redondear escrituras SQL directas antes de los CHECK. No hay evolución in-place aprobada sobre un esquema existente ni migración de Neon.
6. `main` y PR #52 quedan sin cambios. La demo Railway UX9 y Neon persistente permanecen intactos. El benchmark congelado de 16 requisitos Bomberos **no cambia su resultado por el solo hecho de incorporar esta capacidad**.

**Continuación:** B2.5b conciliación bajo concurrencia e invariantes durables del ledger; S1 capacidades por registro/campo con oráculos negativos independientes.
