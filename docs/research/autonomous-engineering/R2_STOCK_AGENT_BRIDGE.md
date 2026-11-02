# R2.5 — Agente → inventario de dos entidades → TypeSpec → PostgreSQL

**Estado:** implementación experimental y **restringida a un perfil cerrado**. No se afirma generación arbitraria de software desde lenguaje natural, aprobación de negocios, ventas, cargos o seguridad IAM de producción.

## Qué se ha implementado

El gateway general `agent-intake-gateway.mjs`, y por extensión el cliente compatible con modelos `model-proposal-runner.mjs`, admiten un nuevo brief `protocolia-agent-brief/v0.2` con `project.profile = stock-debit-lab/v0`.

La fuente `research/autonomous-engineering/samples/stock-debit-lab-brief.json` congela **ocho operaciones de TypeSpec en dos entidades**: crear/leer/listar StockItem; crear/leer/listar StockDebit; revertir el movimiento; consultar /health. Incluye explícitamente los requisitos que aún no se han resuelto (ventas, precios, política de devolución, normalización de SKU, identidad de los operadores).

El fichero `research/autonomous-engineering/trials/chat-agent-stock-debit/proposal-template.json` contiene una **propuesta escrita por el asistente**, con correspondencias y preguntas nuevas. Tiene una marca de hash que el procedimiento local/CI sustituye con el SHA-256 del brief original antes de pasarla por el gateway. Es una prueba **no ciega** y no contiene salida de proveedor de API ni costos medidos.

El nuevo `stock-debit-intake.mjs` convierte fuente + propuesta en un proyecto TypeSpec completo, de manera determinista. Por diseño, **no inventa código a partir de la propuesta**: copia el contrato ya conformante `examples/vnext/stock-debit/contracts/main.tsp`, cambiando exclusivamente el título de servicio (presentación). El código de débito/reserva, la reversión, los identificadores, campos, claves foráneas, permisos y rutas no son editables desde un modelo. Guarda en un lock hashes de fuente, candidato, plantilla y artefactos. De este modo se comprueba la integración del agente con el compilador sin otorgarle un espacio inseguro de generación semántica.

El resultado contiene `requirements.json`, `decisions.json`, `source-provenance.json` y `protocolia-intake-report.json`; el Project Passport preserva preguntas sin resolver como datos **no validados por el propietario**.

## Cómo ejecutarlo

Usar Node 24+ desde la raíz del repositorio:

```sh
BRIEF=research/autonomous-engineering/samples/stock-debit-lab-brief.json
PROPOSAL_TEMPLATE=research/autonomous-engineering/trials/chat-agent-stock-debit/proposal-template.json
mkdir -p /tmp/protocolia-r25
node -e 'const fs=require("node:fs"),crypto=require("node:crypto");
const [brief,template,out]=process.argv.slice(1);
const p=JSON.parse(fs.readFileSync(template,"utf8"));
p.briefSha256=crypto.createHash("sha256").update(fs.readFileSync(brief)).digest("hex");
fs.writeFileSync(out,JSON.stringify(p,null,2)+"\n");' \
  "$BRIEF" "$PROPOSAL_TEMPLATE" /tmp/protocolia-r25/proposal.json

node scripts/research/agent-intake-gateway.mjs admit \
  "$BRIEF" /tmp/protocolia-r25/proposal.json /tmp/protocolia-r25/admitted
node scripts/research/stock-debit-intake.mjs generate \
  "$BRIEF" /tmp/protocolia-r25/proposal.json /tmp/protocolia-r25/generated
node scripts/research/stock-debit-intake.mjs verify \
  "$BRIEF" /tmp/protocolia-r25/proposal.json /tmp/protocolia-r25/generated

npm run app:build -- /tmp/protocolia-r25/generated --target nestjs --out /tmp/protocolia-r25/app
npm run app:test -- /tmp/protocolia-r25/app
```

Se puede usar el comando `prompt` del gateway para pedir una propuesta v0.2 a un modelo autorizado. El ejecutor de modelos no recibe permisos para editar los hechos fuente; sus resultados deben superar los mismos controles. En la CI, **solo se simula el transporte del modelo**; el backend y la base de datos **sí se prueban realmente**.

## Seguridad y criterios de aceptación

1. El agente debe referirse a cada hecho original exactamente una vez, sin modificar su texto, permisos u operaciones. Un intento de omitir/reemplazar una de las ocho operaciones fracasa.
2. Un requisito hipotético queda `agent_assumption` y `deferred` con cero operaciones.
3. Preguntas de negocio o seguridad pendientes en funcionalidades futuras permanecen visibles. Si una nueva pregunta material se refiere a funcionalidades soportadas, la generación **falla antes de crear el directorio**.
4. Source hash equivale a integridad de bytes, **no** a consentimiento humano. El origen se guarda como `source_brief_unverified`.
5. Modificaciones a TypeSpec, manifiestos o salidas posteriores son detectadas mediante `verify`. El compilador y los adaptadores NestJS/Spring siguen siendo los que ya existían.
6. GitHub Actions verifica el perfil y el registro mediante TypeSpec real, Project Passport, y doce transacciones HTTP de débito simultáneas contra PostgreSQL efímero (deben producirse 3 éxitos, 9 conflictos, saldo=1), junto a la reversión exactamente una vez.

## Límite y próximo paso

Esto demuestra **selección segura de un perfil conocido** a partir de una propuesta estructurada por un agente. El siguiente desafío es introducir un **IR de restricciones tipadas**, con validadores de correspondencia y pruebas de ejecución, que permita parametrizar entidades, operaciones y nuevas reglas reales sin usar sustituciones textuales ni ampliar automáticamente el alcance. La evaluación ciega de diferentes harnesses y el handoff de dos años siguen pendientes. No fusionar ni desplegar en producción por este ensayo.

Apilado sobre #123; `main` no queda modificado.
