# R2.2 — Ejecución real de propuestas de modelos (sin herramientas)

**Estado: experimental.** Este incremento habilita una solicitud real a un modelo compatible con el protocolo Chat Completions, con admisión automática por el gateway de procedencia de #110. **No se ha ejecutado un proveedor comercial en la CI**: el transporte se prueba contra un servidor HTTP de simulación local y el compilador real se prueba en los PR anteriores. No confundir esto con una evaluación de Superpowers, GSD Core o Spec Kit.

## Objetivo

Pasar de un JSON de propuesta fabricado manualmente a un resultado **efectivamente producido por un modelo** cuando el operador lo habilite; conservar token usage, identidad declarada, latencia, hashes y fallas para el futuro benchmark. No introducir todavía agentes con filesystem, herramientas, navegación, permisos productivos ni shell: esta modalidad es *model-only*. Superpowers/GSD/Spec Kit son **workflows/harnesses**, no simples endpoints de modelos; medirlos requiere otros adaptadores y un entorno de ejecución controlado.

## Ejecución opt-in

Requiere Node 24+ y un proveedor que implemente el endpoint JSON `POST /chat/completions` con `response_format: {type:"json_object"}`. Ejemplo genérico (no contiene un modelo o endpoint predeterminado y **no envía nada si no se ejecuta la instrucción**):

```sh
export PROTOCOLIA_MODEL_API_KEY="...cargado desde un gestor de secretos..."
node scripts/research/model-proposal-runner.mjs run \
  --brief research/autonomous-engineering/samples/kiosk-owner-brief.json \
  --out /tmp/protocolia-model-experiment-001 \
  --endpoint https://TU_ENDPOINT_AUTORIZADO/v1/chat/completions \
  --model TU_MODELO_AUTORIZADO \
  --key-env PROTOCOLIA_MODEL_API_KEY \
  --max-output-tokens 1800 \
  --timeout-ms 30000 \
  --network-approved
```

El endpoint y el modelo **se proporcionan explícitamente**. El gateway rechaza endpoints no HTTPS salvo HTTP sobre localhost, URLs con credenciales o querystrings, y secretos transmitidos por HTTP. No se redirigen solicitudes. El número de solicitudes es **uno** y no hay reintentos automáticos. Se fija un máximo de tokens de salida y timeout; no hay presupuesto monetario garantizado porque cada proveedor puede cobrar distinto.

Una vez admitida la salida, el directorio nuevo recibe cuatro archivos: `proposal.json`, `intake.json`, `source-provenance.json`, `model-run.json`. El registro no guarda la clave, el cuerpo íntegro de la respuesta, mensajes de error remotos ni el prompt completo. **El propio brief y los archivos de propuesta pueden contener información privada**; guardar fuera del repositorio y controlar los permisos. Tampoco usar CI en PR públicos con secretos de proveedor.

Siguiente etapa manual con los resultados:

```sh
node scripts/research/intake-to-typespec.mjs generate \
  /tmp/protocolia-model-experiment-001/intake.json \
  /tmp/protocolia-typespec-001
```

A partir de ahí puede continuarse con TypeSpec, compilación Spring/Nest, conformance y Project Passport. Si una duda afecta la semántica implementada, **el generador debe rechazarla** y no considerarla implementada.

## Controles y limitaciones

- El proveedor genera únicamente texto JSON; no recibe herramientas, shell, filesystem ni operaciones mutadoras.
- El resultado vuelve a pasar por `admitProposal`: no puede reescribir el brief, alterar operaciones autorizadas ni presentarse como fuente humana.
- Se rechazan respuestas incompletas, refusals, herramientas solicitadas, respuesta sobredimensionada, error HTTP, redirección, JSON incorrecto y salidas no admitidas.
- `model-run.json` informa `requestedModel`, `reportedModel`, IDs declarados, tokens reportados, latencia y hashes; **ninguno verifica criptográficamente la identidad del proveedor o su facturación**. El costo se declara `UNKNOWN_UNPRICED`.
- Un servidor de prueba falso también podría producir respuestas que pasen. **La aceptación del JSON y la ejecución en CI no prueban que intervino una IA real**: ese dato requiere evidencia independiente de la sesión.
- La fuente `brief` y el perfil de operaciones continúan definidos externamente. La clasificación y completitud de preguntas todavía pueden ser erróneas.
- Aún faltan precios comparables por proveedor, captura/verificación de múltiples corridas, holdouts no públicos, autenticación fuerte de intención del propietario, modos reales de Superpowers/GSD/Spec Kit y el test R4 de retoma.

## CI del experimento

`.github/workflows/model-proposal-runner-r2.yml` comprueba el cliente contra un servidor **localhost**, la redirección, llamadas fallidas, truncamientos, JSON inválido, propuestas adulteradas, protección de secretos y el puente a TypeSpec. No se realizan llamadas pagas ni se usan credenciales.

Documentación de protocolo (válida para modelos que soporten la ruta): https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create . Para modelos que no admitan JSON mode o la opción `max_completion_tokens`, será necesario un adaptador explícito, no asumir compatibilidad.

**No fusionar** sin CI verde y revisión de límites. La rama se apila sobre #110; #106 sigue abierto.
