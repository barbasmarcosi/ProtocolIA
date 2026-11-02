# R2.6 — IR semántico tipado y límites del alcance

**Estado:** investigación implementada en rama, sujeto a evidencia del último HEAD de GitHub Actions. No es un generador arbitrario desde lenguaje natural.

## Qué cambia frente a R2.5

R2.5 seleccionaba/copió un contrato TypeSpec de inventario completamente fijo. Ahora `protocolia-agent-brief/v0.3` admite **restricciones numéricas congeladas en la fuente**: `skuMaxLength`, `nameMaxLength`, `stockMaxUnits`, `debitIdMaxLength`, `debitMaxUnits`. Estas se validan antes de admitir la propuesta del agente y se convierten en un **grafo semántico tipado** `protocolia-stock-semantic-ir/v0.1` de entidades, campos, referencias, capacidades, operaciones y metadata transaccional.

`scripts/research/stock-semantic-ir.mjs` define el grafo y lo emite como TypeSpec. Ya no se modifica una plantilla original con sustituciones de textos para la ruta v0.3; `emitStockTypeSpec` utiliza los nodos tipados y una tabla cerrada de renderizadores de operaciones `create`, `get`, `listPage`, `transition` y `health`. La operación `createStockDebit` incorpora el plan aprobado `reserve`; la compensación `reverseStockDebit` incorpora `release` + estado `posted → reversed` + auditoría. No existe una entrada para SQL, expresiones, código arbitrario o acciones de agentes.

La función `validateStockSemanticIr` reconstruye el grafo autorizado a partir de los límites y exige coincidencia exacta antes de emitir. No basta con que el modelo suministre un JSON aparentemente válido. El proyecto publicado incluye `semantic-ir.json` y el lock de hashes para reproducción y detección de deriva. `requirements.json` y `decisions.json` siguen preservando procedencia e incógnitas.

La versión v0.2 sigue generando exactamente su perfil anterior; v0.3 agrega un nivel de expresividad controlado y compatible con el gateway y el runner HTTP.

## Caso con parámetros diferentes

`research/autonomous-engineering/samples/stock-debit-typed-ir-brief.json` propone **un laboratorio sintético**, no un negocio real, con los siguientes parámetros:

| Restricción | Valor anterior (R2.5) | Nuevo valor (R2.6) |
|---|---:|---:|
| SKU longitud máxima | 40 | 56 |
| Nombre longitud máxima | 100 | 140 |
| Saldo máximo | 100.000 | 50.000 |
| Identificador de débito longitud máxima | 48 | 64 |
| Unidades máximas por débito | 1.000 | 250 |

Las ocho operaciones, las referencias, las capacidades y la transacción de débito/reversión **no son configurables por el agente**. El máximo de débito debe ser al menos 2 y el saldo máximo al menos 7 para la carrera de prueba; ambos permanecen acotados.

## Pruebas

`tests/research/stock-semantic-ir.test.mjs` verifica: campos y restricciones, salida determinista, intentos de añadir operaciones, mutación de FK/rol/auditoría, valores decimales o fuera de rango, HTML/TypeSpec inyectado, SHA de brief obsoleto, incógnitas materiales bloqueantes, integridad del lock, y dos configuraciones de límites diferentes con idéntico conjunto de operaciones. El workflow existente `signed-decision-gate-r2.yml` ejecuta, además, compilación oficial TypeSpec y chequea límites reales en el IR de salida, Project Passport y la app NestJS contra PostgreSQL con prueba de carrera y compensación.

Para reproducir:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/research/stock-semantic-ir.test.mjs
npm run build:vnext
# Crear proposal.json con briefSha256 igual al SHA-256 de los bytes del brief v0.3;
# la CI del proyecto muestra el procedimiento concreto.
node scripts/research/stock-debit-intake.mjs generate \
  research/autonomous-engineering/samples/stock-debit-typed-ir-brief.json \
  /tmp/protocolia-typed-proposal.json /tmp/protocolia-typed-contract
./node_modules/.bin/tsp compile /tmp/protocolia-typed-contract
```

## Limites

Este IR es **parametrizable solo para un dominio/tipología cerrada**. No implica síntesis segura de cualquier modelo de datos, ciclo de estados, regla comercial o endpoint. La fuente misma sigue sin acreditar al propietario; el agente no modifica los límites, y el ensayo no es ciego. Las incógnitas sobre política SKU, permisos reales, ventas y retornos se mantienen fuera del alcance. Tampoco reemplaza los controles de producción de `main`.

Próximo hito: IR versionado y ampliable con operadores nuevos sujetos a *pruebas de comportamiento independientes*, sin admitir JSON libre como autoridad. Ver [roadmap general](./DELIVERY_ROADMAP.md).
