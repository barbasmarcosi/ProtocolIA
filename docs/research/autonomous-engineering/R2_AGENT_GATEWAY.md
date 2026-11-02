# R2.1 — Gateway de entrada para agentes con procedencia vinculada

**Estado:** incremento experimental, implementado sobre los PR apilados #105 → #107 → #109. **No ejecuta ningún LLM ni compara proveedores.** El objetivo es que Superpowers, Spec Kit, GSD Core o un agente distinto tengan una interfaz de entrada/salida común, validable y segura antes de traducir sus propuestas a TypeSpec.

## Problema resuelto parcialmente

En R2 el JSON podía declarar por sí mismo `origin: "explicit_owner"`. Un agente mal configurado podía atribuirse una aprobación humana y pasar el validador de estructura. El gateway nuevo ya **no acepta atributos de autoridad enviados por el agente**. Los requisitos iniciales provienen de un fichero independiente fijado antes de la sesión; el agente solo puede devolver referencias a sus IDs, asignaciones dentro del perfil acordado y preguntas nuevas. El gateway reconstruye el JSON final, asigna orígenes y conserva la fuente sin reescribirla.

Eso **no equivale a autenticación criptográfica del usuario**: quien controle el fichero de entrada podría falsificarlo. La CI y las herramientas deben garantizar que ese fichero sea proporcionado fuera del área modificable por el agente. Las referencias de procedencia solo prueban concordancia de bytes, no que el usuario haya aprobado realmente una regla.

## Protocolo de tres fases

### 1. Brief independiente del agente

`research/autonomous-engineering/samples/kiosk-owner-brief.json` contiene:
- `project`: el perfil TypeSpec elegido.
- `facts`: `id`, texto original, `scope: supported|deferred` y conjunto de operaciones **congelado por la fuente independiente**.
- `knownQuestions`: preguntas preexistentes que nunca pueden omitirse.

El perfil admitido sigue limitado a una entidad administrativa y cinco operaciones. Los nombres técnicos `expectedOperations` son una política de aceptación preparada por el sistema o un operador; **no estamos resolviendo todavía la traducción automática de lenguaje natural a esas operaciones**.

### 2. Propuesta del agente

Emitir instrucciones de salida para cualquier harness:

```sh
node scripts/research/agent-intake-gateway.mjs prompt research/autonomous-engineering/samples/kiosk-owner-brief.json > /tmp/intake-agent-prompt.md
```

Una sesión externa de IA recibe este prompt y devuelve un documento compatible con `protocolia-agent-proposal/v0.1`, con las claves `briefSha256`, `mappings`, `discoveredQuestions` y `hypotheses`.

Por ejemplo, la muestra `kiosk-agent-proposal-template.json` es **sintética** y usa un marcador `__REPLACE_WITH_ACTUAL_BRIEF_SHA256__`. Se rellena con el hash de los bytes del brief antes de evaluarla. **No es resultado de una ejecución real de Superpowers, Spec Kit o GSD.**

### 3. Admisión y compilación sin privilegios

```sh
node scripts/research/agent-intake-gateway.mjs admit <brief.json> <agent-proposal.json> <directorio-nuevo>
node scripts/research/agent-intake-gateway.mjs verify <brief.json> <agent-proposal.json> <directorio-de-admisión>
node scripts/research/intake-to-typespec.mjs generate <directorio-de-admisión>/intake.json <directorio-typespec-nuevo>
```

Luego se compila con TypeSpec y se puede ejecutar la generación real Nest/Spring, las pruebas y Project Passport, que incluye `decisions.json` y el mapeo de requisitos.

**Artefactos de admisión:** `intake.json` y `source-provenance.json`, reproducibles a partir de la fuente y propuesta. Las salidas deben estar vacías; `verify` rechaza divergencias.

## Invariantes y limitaciones

1. El agente **no puede agregar campos** para afirmar `explicit_owner`, modificar el texto original, borrar una pregunta preexistente, cambiar el conjunto de operaciones autorizado, reutilizar IDs ni producir implementación a partir de hipótesis.
2. Los requisitos agregados por la IA quedan `agent_assumption`, `deferred` y sin operaciones.
3. Una pregunta nueva con decisión provisional solo puede ser técnica y reversible. Una duda material que afecte capacidades soportadas bloquea el compilador descendente.
4. El contexto elegido por un agente podría ser incompleto o erróneo: no se verifican automáticamente la clasificación correcta de todas las dudas, la interpretación del texto, ni su exhaustividad.
5. **Aún falta un runtime de agentes aislado**. El gateway **no instala ni ejecuta Superpowers/Spec Kit/GSD**, no transmite prompts a proveedores y no otorga permisos de red, dinero, despliegue ni edición de otras fuentes.
6. No se afirma mayor productividad. Evaluar candidatos requiere ejecuciones reales, versiones de modelos y harnesses fijadas, prompts comparables, costes e independencia del oráculo; los fixtures públicos aquí son solo smoke tests.
7. No se altera el núcleo TypeSpec/IR, los generadores Spring/Nest, `main`, TL-14 ni la infraestructura productiva.

## CI y criterios de aceptación

`.github/workflows/agent-intake-gateway-r2.yml` ejecuta:
- Pruebas adversariales de suplantación, cambio de hash, omisión de fuentes, escalamiento de operaciones y protección frente a sobrescrituras.
- Prueba de integración source → propuesta sintética → TypeSpec real → Project Passport con incertidumbres persistidas.
- Compilación y pruebas de la aplicación NestJS resultante con el pipeline de conformidad existente y PostgreSQL efímero.

**Importante:** la CI valida la interfaz y la cadena determinista; no valida el rendimiento de un agente no ejecutado. La próxima prueba real deberá pasar por la misma puerta de admisión y producir evidencia independiente, sin convertir el ensayo en aprobación del negocio.

## Futuro

- Incorporar un harness externo dentro de una sandbox que solo pueda escribir la propuesta, jamás el brief de origen.
- Ejecutar las alternativas (Superpowers + OpenSpec, Spec Kit, GSD Core) con el mismo brief y presupuesto, registrando preguntas omitidas o inventadas y coste total.
- Ampliar gradualmente el perfil semántico mediante TypeSpec existente, no mediante plantillas que ignoren las reglas reales.
- Verificar Project Passport después de modificaciones manuales y ejecutar el Two-Year Handoff sin conversaciones previas.
