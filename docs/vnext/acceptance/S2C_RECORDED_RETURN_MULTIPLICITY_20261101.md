# S2c — multiplicidad de devoluciones internas registradas (2026-11-01)

## Riesgo y contrato

La comparación anterior agregaba todas las devoluciones internas `recorded` por recibo/tipo antes de cotejarlas con el extracto. Dos devoluciones locales del mismo tipo (por ejemplo 0.10 + 0.20) podían coincidir con un único evento externo de 0.30 y producir `returns_agree_unverified` sin excepciones. La suma exacta no demuestra que exista correspondencia de eventos, ni descarta un registro duplicado.

## Cambio funcional

- Contar únicamente eventos `recorded` por recibo y tipo (`refund` y `chargeback`); `voided` no cuenta.
- Cuando haya más de un evento local del mismo tipo, emitir `multiple_recorded_return_events_require_review` incluso si la suma coincide exactamente con un único evento externo.
- Conservar el resultado primario de mayor precedencia (captura incorrecta, sobredevolución, reversión, falta de vínculo), agregando esta anomalía independientemente.
- No tratar dos tipos distintos (una devolución y un contracargo) como duplicación del mismo tipo.
- No rechazar ni modificar el diario: los reembolsos parciales legítimos son posibles, pero exigen revisión del operador ante la ausencia de vínculo evento-a-evento.

## Evidencia reproducible

```sh
node --check packages/adapters/provider-statement-reconciliation.mjs
node --test tests/vnext/provider-statement-reconciliation.test.mjs \
  tests/vnext/provider-statement-multi-anomaly.test.mjs \
  tests/vnext/provider-statement-cli.test.mjs
```

Los tests cubren sumas exactas, reversión de orden de arrays, no mutación, ausencia de vínculo, discrepancia de captura, devoluciones anuladas, tipos diferentes y código de salida CLI 2. La CI S2c ejecuta la suite completa en Node 22 y 24. Las CI de calidad, S2a/S2b y PostgreSQL/HTTP NestJS/Spring son obligatorias antes de fusionar.

## Límites

Esta herramienta es comparación offline de archivos aportados por el operador. No prueba identidad bancaria, clearing, integridad distribuida, transacciones atómicas entre archivos, ni efectúa devoluciones. Mantener TL-14 #57 abierto; sin despliegue, tag financiero estable u operaciones reales.
