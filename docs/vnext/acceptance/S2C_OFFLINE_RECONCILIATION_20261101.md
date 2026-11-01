# S2c — comparación contable offline (NO conciliación bancaria)

## Por qué existe

El registro de proveedores S2c mantiene eventos **sintéticos** y una proyección de integridad interna. Ninguna firma de demostración acredita liquidación real. Antes de integrar un proveedor, implementamos una herramienta **ejecutable** de comparación entre dos fuentes separadas: recibos internos y un extracto atribuido a un proveedor, unidos por un mapeo explícito de transacciones revisado fuera del motor. No requiere una clave de proveedor ni modifica PostgreSQL.

**Advertencia obligatoria:** coincidencia numérica = `amounts_agree_unverified`, nunca `settled`, `cleared`, `paid` ni constancia de transferencia externa. El contenido del extracto NO se autentica criptográficamente ni se valida contra el proveedor. No ingresar movimientos reales sin autorización ni usar esta salida para efectuar reembolsos.

## Uso local, sin red ni escritura

Tres archivos JSON separados (todos arrays):

`internal.json`
```json
[{"receiptId":"PAY-1","orderId":"OT-1","amount":"10.30","currency":"ARS","status":"posted","proofState":"unverified"}]
```

`links.json` — mapeo verificado manualmente, **no** es el identificador de evento del webhook:
```json
[{"receiptId":"PAY-1","providerId":"sandbox","transactionId":"TX-100"}]
```

`external.json` — transacciones referidas en un extracto externo **no autenticado**:
```json
[{"providerId":"sandbox","transactionId":"TX-100","eventId":"EV-C1","kind":"capture","amount":"10.30","currency":"ARS"}]
```

```sh
node scripts/vnext/reconcile-provider-statement.mjs \
  --internal internal.json --links links.json --external external.json \
  --currency ARS --scale 2
```

Código de salida: **0** cuando no hay discrepancias sintácticas o contables dentro de los datos suministrados (aun así NO hay autoridad), **2** con excepciones y reporte JSON completo, **1** cuando las fuentes no pueden validarse. Ninguna salida contiene booleanos de pago verificado ni cambia saldos.

## Cruce exacto de devoluciones y contracargos (opt-in)

El parámetro opcional `--internal-returns returns.json` incorpora un **cuarto archivo independiente** con eventos de devolución registrados internamente:

```json
[{"receiptId":"PAY-1","returnId":"RF-1","kind":"refund","amount":"1.30","currency":"ARS","status":"recorded"}]
```

Se admite `kind=refund|chargeback` y `status=recorded|voided`. Un evento `voided` se valida pero no contribuye al monto contabilizado. Los `returnId` deben ser únicos; cada evento debe referenciar un recibo interno existente y tener monto positivo exacto. El comparador calcula por separado devoluciones y contracargos **por recibo y transacción**, nunca solo por total neto. Dos fuentes con importes agregados idénticos pero tipos distintos producen `return_amount_or_kind_mismatch`. También identifica `internal_return_not_externally_reported`, `internal_returns_exceed_receipt` y `external_returns_exceed_capture`.

Cuando ambas fuentes coinciden, la única clasificación es `returns_agree_unverified`: **no significa devolución ejecutada, contracargo resuelto ni dinero acreditado**. Si no se suministra `--internal-returns`, la comparación no presupone que no hubo devoluciones internas; cualquier movimiento externo de retorno conserva `external_return_requires_review`. La ausencia del archivo NO equivale a un diario interno vacío auditado.

Ejemplo:

```sh
node scripts/vnext/reconcile-provider-statement.mjs \
  --internal internal.json --internal-returns returns.json \
  --links links.json --external external.json --currency ARS --scale 2
```

## Invariantes comprobables

- Cálculo decimal por `BigInt`, con cadenas monetarias estrictas, moneda/escala explícitas; rechaza `number` de JavaScript, notación exponencial, precisión excesiva, negativos y cero.
- Identidades únicas por recibo, por (proveedor, transacción) y por (proveedor, evento); rechaza ambigüedades, duplicaciones y métodos desconocidos.
- Reconoce capturas parciales múltiples, devoluciones y contracargos externos declarados; calcula sumas exactas, rechaza silencios y devuelve excepciones por montos no coincidentes, retornos superiores a capturas o movimientos sin vínculo.
- Una reversión interna no se confunde con una devolución externa; el reporte distingue ambos lados.
- Acepta solamente el estado de prueba `proofState=unverified`; no reinterpreta un campo `verified` como prueba bancaria.
- El resultado es determinista frente al orden de los arrays; límites de tamaño y cantidad de registros restringen archivos de entrada.

## Alcance / próximos gates obligatorios

Este incremento **no está conectado todavía** al exportador automático de NestJS/Spring ni a archivos autenticados de un banco o adquirente. El mapeo debe producirse con identificadores de transacción provistos por el proveedor, NO inferirse de eventos de webhook. Falta la importación firmada/autorizada del extracto, vinculación validada con un proveedor real, conciliación persistida con auditores, manejo de devoluciones de verdad, recuperación y operación segura. **TL-14 #57 sigue OPEN**.

Pruebas: `node --test tests/vnext/provider-statement-reconciliation.test.mjs tests/vnext/provider-statement-cli.test.mjs`. CI aislada en Node 22/24, sin secretos ni operaciones externas. No se debe confundir esta herramienta provider-neutral con paridad HTTP/PostgreSQL productiva de Spring/Nest.

## Exportación TypeSpec → Spring/NestJS — S2c siguiente incremento

En el perfil de conciliación exacta, **ambos generadores** emiten
`protocolia-reconciliation-internal-export.sql` derivado del mismo IR canónico.
Contiene exclusivamente un `SELECT` de recibos, con montos `NUMERIC::text`,
identificadores, estado interno y `proofState`. **No** genera ni adivina
`transactionId` externos a partir de `eventId` de webhooks.

Invocación manual en un entorno de **prueba**, usando un usuario PostgreSQL
autorizado de **solo lectura**, sin compartir credenciales de migración:

```sh
psql -X -v ON_ERROR_STOP=1 -v currency=ARS -At \
  -f /ruta/app-generada/protocolia-reconciliation-internal-export.sql \
  > internal.json
```

Esta consulta puede ver todos los recibos accesibles al principal SQL;
**no demuestra aislamiento multitenant**. Está prohibido utilizarla para
exportaciones productivas hasta tener un perfil de autorización tenant-scoped
verificado. No publica datos ni solicita credenciales y debe ejecutarse solo
por acción consciente del operador. El archivo `links.json` continúa siendo
un mapeo externo revisado; el generador no puede inventarlo.

Prueba de integración: el probe PostgreSQL del workflow de proveedores ahora
ejecuta realmente el SQL emitido en **ambos targets**, valida un `PAY-CAND`
con monto decimal exacto, procesa el JSON con la CLI/reconciliador y comprueba
que el estado de liquidación permanece `unverified`.
