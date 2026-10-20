# ProtocolIA vNext — B10 liquidación transaccional multipardita (17-10-2026)

**Implementación probada:** `5d198f28cc62106aef4be0ee6058850c1b704458`.  
**GitHub Actions:** [B10 matriz #39063295754](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39063295754) — **SUCCESS** en `nestjs` y `modular-spring`.  
**Quality:** [#39063295720](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39063295720).

## Alcance entregado

El decorador TypeSpec `@moveBatch("Bin","available","sourceSku1,targetSku1,units1;sourceSku2,targetSku2,units2")`, combinado con `@behavior("create","Batch")`, describe una **liquidación de 2 a 4 partidas planas en un único comprobante**. El contrato no especifica SQL ni código específico de NestJS/Spring/React. Cada partida obliga a declarar dos FK `restrict` a la misma entidad y una cantidad positiva `int32` en el modelo y en el DTO de creación.

En el **IR** se guarda `moveBatch:{stockEntity,availableField,legs:[{sourceField,targetField,quantityField},...]}`. Los dos adaptadores invocan el validador compartido `packages/adapters/multi-leg-transfer.mjs`. Se rechazan de manera cerrada referencias inexistentes, campos reutilizados entre partidas, tipos incompatibles, cantidades cero, operaciones alternativas que modificarían el comprobante y perfiles owner-managed no compatibles. El lector no puede liquidar si carece de la capacidad de escritura del comprobante o del recurso de stock.

**Semántica del settlement:** suma los débitos y créditos de todas las partidas **por cada identidad de existencia**; incluye una existencia que recibe y entrega unidades en el mismo comprobante aunque comience vacía. Adquiere bloqueos `FOR UPDATE` sobre **todas** las identidades participantes ordenadas por clave pública. Luego aplica los deltas netos por identidad bajo guardas de saldo final entre 0 y el límite `@maxValue` (o `int32` máximo). Inserta el comprobante dentro de la misma transacción. Error de alguna guarda, FK o unicidad implica rollback de todos los saldos y del comprobante, sin asentamientos parciales. No se aplican cambios a recursos externos a PostgreSQL.

**UX generada:** el formulario React interpreta 2–4 relaciones y cantidades directamente del contrato. Incluye ayuda contextual sobre el settlement indivisible y rechazo inline si una partida usa el mismo origen y destino. No se escribieron componentes exclusivos de las entidades `Bin` ni `Batch`.

## Evidencia reproducible

- Contrato TypeSpec independiente: `examples/vnext/multi-leg-settlement/contracts/main.tsp` y `tspconfig.yaml`.
- Pruebas de compilador/adaptadores: `tests/vnext/multi-leg-settlement.test.mjs`. Se verifican planes de 2, 3 y 4 partidas, límites 1/5, FK y DTO incompatibles, claves duplicadas, permiso público de escritura, operaciones alternativas y 409 ausente.
- Pruebas reales: `scripts/vnext/probe-multi-leg-settlement-http.mjs`; Docker Compose + PostgreSQL efímeros en Spring y Nest, y Chromium a 390×844.
- **Neto compartido:** A=20, B=0, C=0; dos partidas A→B 4 y B→C 4. Después: A=16, B=0, C=4; ningún paso intermedio visible. Otro comprobante de A→B 3 y B→C 2 deja A=13, B=1, C=6.
- Comprobante duplicado: HTTP 409, saldos intactos. Un solo destino al límite de capacidad impide **todas** las partidas, HTTP 409 y rollback completo.
- **Carrera de doce transacciones** por siete unidades: 7×201 y 5×409. La existencia intermedia termina en 0, sin duplicar unidades.
- **Carrera de doce transacciones por idéntico comprobante**: 1×201 y 11×409. Las tres existencias conservan la semántica de una única liquidación.
- **Veinte batches en direcciones contrarias**, con una existencia compartida en ambas partidas, todos 201 y sin interbloqueos; saldos originales preservados.
- Consulta directa mediante `psql`: **345 unidades totales conservadas** y **30 comprobantes confirmados** antes de Chromium.
- Chromium móvil: abre sección, completa cuatro selectores de FK, rechaza origen=destino sin enviar POST, corrige la segunda selección y crea el comprobante real con HTTP 201. Verifica saldos resultantes, cero excepciones JS. Total 31 comprobantes.
- Marcadores observados **idénticos** en ambos jobs: `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS`, `PROTOCOLIA_B10_GENERATED_MULTILEG_REACT_CHROMIUM_PASS`, `PROTOCOLIA_B10_ATOMIC_NET_SETTLEMENT_PASS`. Captura móvil en artifact del workflow.

**Regresión del verificador genérico:** `packages/cli/conformance.mjs` ahora construye hasta tres padres de ejemplo relacionados para un batch de dos partidas y comprueba deltas netos y rollback de un comprobante duplicado; no hay nombres específicos del dominio en el oráculo.

## Incidencias de validación

Primera matriz [#39063143620](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39063143620) quedó en FAIL porque el oráculo HTTP buscaba los nombres de FK de B8; los DDL generados ya contenían `fk_batch_source_sku1` y `fk_batch_target_sku2`. El error del test se corrigió en `5d198f28cc62106aef4be0ee6058850c1b704458`. La **segunda matriz** #39063295754 terminó SUCCESS en ambos targets con PostgreSQL y UI completos. No se ocultó el primer fallo.

## Límites reconocidos

B10 soporta **2–4 partidas estáticas y campos planos declarados en TypeSpec**; no admite todavía un arreglo dinámico arbitrario de renglones ni relaciones a diferentes tipos de saldo, ni moneda, ni valoración, ni lógica distribuida. El settlement es por **delta neto final**, no exige saldo disponible temporal para cada partida antes de compensarla con otra partida del mismo comprobante. No se integra con la reversión B9: un batch multipardita NO tiene todavía una operación de reversión generada. Prohíbe ownership implícito o modificaciones alternativas del comprobante; no representa un motor universal de transacciones.

La validación no sustituye una auditoría visual completa desktop, pruebas WCAG exhaustivas ni aprobación de negocio para procesos financieros. No se modificaron deploys persistentes ni el evaluador congelado de Bomberos.

**Siguiente incremento:** evolucionar a conjuntos dinámicos de renglones con un modelo de cabecera/detalle tipado, o reversión exactamente-una-vez de todos los renglones, antes de declarar soporte empresarial de múltiples partidas.
