# ProtocolIA vNext — B11: reversión exactamente una vez de batch multipardita

**Fecha:** 2026-10-17.  
**Commit de código y test validado:** `76c43f4faf9fde45571c544421841da4eb2f0df3`.  
**Matriz de ejecución:** [vnext-b11 #39064173820](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39064173820) **SUCCESS** en `nestjs` y `modular-spring`.  
**Quality:** [#39064173961](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39064173961) **SUCCESS**.

## Semántica implementada

`@reverseBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku2,targetSku2,units2")` declara una operación de reversión que coincide **exactamente** con un `@moveBatch` creador. Se acepta un conjunto estático de **2–4 partidas**; el contrato del ejemplo se encuentra en `examples/vnext/multi-leg-reversal/contracts/main.tsp`.

Con `@behavior("transition","Batch","status")`, `@transition("posted","reversed")` y `@audit("status")`:

1. El comprobante lleva un estado servidor `@initial("posted")`; el DTO de creación no acepta el estado y el backend impide que el cliente lo suministre manualmente.
2. El compilador verifica una sola operación creadora multipardita, una sola reversión, las **mismas** FK y cantidades del contrato, una única propiedad de estado inicial, la transición exacta y su auditoría. Rechaza las mutaciones alternativas que pudieran modificar el comprobante.
3. La operación lee el asiento persistido y calcula, **por identidad de stock**, el delta neto inverso de todas las partidas. No procesa renglones individualmente.
4. Ambos runtimes abren una transacción PostgreSQL y bloquean **todos** los padres participantes en orden estable (mismo orden que B10); luego aplican un `UPDATE` compare-and-swap de `posted` a `reversed`, acreditan o descuentan cada neto con guardas de saldo `0..max`, y registran la auditoría en la **misma transacción**.
5. Un comprobante inexistente devuelve 404. Un comprobante ya revertido, cuentas no disponibles, saldo gastado o capacidad excedida devuelve 409 y revierte cualquier cambio parcial. La reversión requiere capacidad para escribir el comprobante **y** la entidad stock subyacente.

La plantilla React compartida genera la acción de reversión al ver la transición declarada, sin implementar componentes específicos para Bin ni Batch.

## Evidencia empírica

**Compilador/IR:** `tests/vnext/multi-leg-reversal.test.mjs` comprueba el emparejamiento del creador con el reversor, auditoría, ausencia de bypass, unicidad de transiciones, FK/campos de cantidades iguales y status HTTP. Junto a él corren B8, B9 y B10 en ambas matrices.

**Prueba real:** `scripts/vnext/probe-multi-leg-reversal-http.mjs`, sobre aplicaciones **generadas** desde TypeSpec y bases PostgreSQL efímeras de Docker Compose, con Chromium headless móvil 390×844:

- Caso de tránsito `A→B→C`, con B inicialmente en cero: creación mueve cuatro unidades de A a C, B permanece en cero; revertir devuelve los tres saldos originales y deja `reversed`. Segundo intento: 409.
- Reversión rechazada con **409** si una cuenta que debe ser debitada gastó unidades desde el asiento original; comprueba estado `posted` y todos los saldos intactos. Tras reposición, la misma reversión es exitosa.
- Reversión rechazada con **409** si restaurar los fondos excedería el límite del origen; todos los efectos vuelven atrás y la reversión puede repetirse después de liberar capacidad.
- **Diez reversores concurrentes del mismo comprobante:** exactamente **1×200 + 9×409**; sin restauración duplicada de existencias.
- **Diez reversiones de batches con sentidos contrarios:** **10×200**, sin interbloqueos; existencias originales restauradas.
- PostgreSQL: conservación del total de unidades y **15 asientos revertidos con 15 eventos auditados** antes del navegador.
- Chromium móvil inicia sesión, abre el comprobante y ejecuta la transición de reversión. Verifica HTTP 200, estado final y saldos, sin errores JavaScript. Después se confirmaron **16 eventos de auditoría**.
- Marcadores presentes en los **dos** jobs: `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`, `PROTOCOLIA_B11_MULTI_REVERSAL_REACT_CHROMIUM_PASS`, `PROTOCOLIA_B11_MULTILEG_REVERSAL_PASS`. Captura móvil adjunta como artifact por target.

## Incidencia corregida

Primera matriz [#39064107725](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39064107725) **FAIL** en un test negativo: el compilador rechazaba correctamente el contrato sin el HTTP 409 con el diagnóstico heredado `protocolia-transition-http`, mientras el oráculo solo aceptaba códigos nuevos B11. El test fue corregido para reconocer ambos diagnósticos válidos, sin reducir ninguna regla de compilación. Segunda matriz [#39064173820](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39064173820) **SUCCESS** en ambos runtimes.

## Límites y pendientes reales

Solo se admiten **2–4 partidas estáticas en columnas tipadas**, referidas al **mismo tipo de cuenta de stock**. No se admiten listas dinámicas, transacciones con distintos tipos de agregados, netos monetarios, crédito, múltiples monedas ni sagas externas. Se invierte el saldo **neto total**, no la disponibilidad temporal partida por partida. No hay modificación de ownership implícito ni migración de comprobantes existentes.

La auditoría registra el estado de reversión; no es todavía un libro mayor financiero reglamentario. La UI pasó la operación móvil real, pero continúa pendiente una revisión visual y de accesibilidad sistemática desktop y mobile.

**Seguridad y alcance de ejecución:** no se alteraron instancias persistentes de Render, Railway o Neon; `main` y PR #52 permanecen intactos. El dominio independiente de Bomberos y su verificador congelado no fueron reescritos.

**Próxima capacidad a evaluar:** cabecera/detalle con partidas dinámicas tipadas, incluyendo reconciliación y UX de composición/revisión de movimientos, en lugar de sumar otra excepción al formato de columnas planas.
