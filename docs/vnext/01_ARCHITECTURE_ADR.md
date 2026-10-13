# ProtocolIA vNext — ADR-004: TypeSpec + IR semántico + adaptadores

**Estado:** arquitectura TypeSpec/IR RATIFICADA, A0 validado empíricamente; JHipster 9.4 NO-GO contractual, fallback modular GO inicial.  
**Fecha:** 2026-10-13. **Reemplaza para vNext:** la arquitectura objetivo de [ADR-003](../ADR-003-FULLSTACK-COMPOSITION.md); ADR-003 continúa siendo válida **históricamente** para el piloto G0–G5.  
**Normativa de producto:** [requisitos](00_PRODUCT_REQUIREMENTS.md).

## Actualización empírica A0 — 13/10/2026

**Motor inicial seleccionado:** `TypeSpec 1.17 → @protocolia/domain → IR canónico → adaptador modular Java21/Spring Boot4/JDBC/PostgreSQL16 + React declarativo`. OpenAPI3 proviene del emisor oficial TypeSpec; OpenAPI Generator 7.26 emite interfaces y DTO compilados, **pero todavía no enlazados como handlers**. La ejecución HTTP de negocio reside en un runtime semántico reutilizable, que recibe un manifiesto derivado del IR. JDL y JHipster quedan como adaptador experimental NO-GO para el contrato actual.

**Fundamento ejecutado:** JHipster generó y arrancó CRUD/React/PostgreSQL reales, pero GET por code 400, incremento y rename 404, duplicado 500, desconocidos JSON 201 y usuario de lectura pudo hacer POST 201. Corregirlo mediante blueprints exigiría sustituir controladores, frontend y autorización. El fallback generó dos aplicaciones independientes desde `Tool(code,name,quantity)` y `Gauge(serial,label,reading)`: Java/React compilados, PostgreSQL 16, HTTP/auth/concurrencia y Chromium 390×844 con mutaciones reales PASS. Ver [evidencia A0](evidence/A0.md).

**Alcance deliberadamente limitado:** un recurso por aplicación, campos string/int32/utcDateTime, identidad natural string, seis comportamientos conocidos y dos capacidades read/write. El API/cliente tipado enlazado, multi-entidad, migraciones seguras, autenticación de producción, UX de errores y CLI única son trabajo posterior; A0 aceptado **no** implica A1/A2 terminados. Las secciones de candidaturas iniciales más abajo se preservan como razonamiento histórico previo a la validación, no como motor predeterminado vigente.
## Decisión resumida

Adoptar **TypeSpec como fuente de definiciones**, crear una biblioteca semántica `@protocolia/domain` y emitir un **IR versionado ajeno al framework**. Un coordinador consume el IR y llama a **adaptadores intercambiables**. El **primer adaptador candidato** proyecta a JHipster/JDL y sus generadores para Spring Boot + React + PostgreSQL; se añaden templates de comportamiento solo para semánticas explícitas que JHipster no genere. El segundo destino previsto es JHipster Node/NestJS.

**No** convertir JDL, JPA, Nest decorators, TypeORM, JSON Schema, OpenAPI o JHipster entity JSON en fuentes editables. Son productos derivados. La semántica de dominio no se infiere de nombres de operaciones HTTP.

### Referencias upstream verificables (2026-10-13)

- TypeSpec: [instalación](https://typespec.io/docs/), [decoradores](https://typespec.io/docs/language-basics/decorators/), [biblioteca TypeSpec](https://typespec.io/docs/extending-typespec/basics/), [emisores](https://typespec.io/docs/extending-typespec/emitters-basics/).
- JHipster: [9.4.0, 2026-09-17](https://www.jhipster.tech/2026/09/17/jhipster-release-9.4.0.html), [blueprints oficiales](https://www.jhipster.tech/modules/official-blueprints/).
- JHipster NestJS: [repositorio](https://github.com/jhipster/generator-jhipster-nodejs), [changelog 4.2.0](https://github.com/jhipster/generator-jhipster-nodejs/blob/main/CHANGELOG.md) (NestJS 12, TypeORM 1, JHipster 9.4.0). JHipster .NET [4.5.0](https://github.com/jhipster/jhipster-dotnetcore) requiere generator-jhipster 8.11.0; **no** asumir compatibilidad v9.
- JHipster JDL: [limitación y propuesta de claves compuestas](https://github.com/jhipster/generator-jhipster/issues/33341); no asumir que se puede establecer cualquier clave primaria natural como identity interna. **A0 prueba esto con `Tool.code`**.

Las versiones son candidatas; fijar el **patch exacto y digest de imagen** en los lockfiles al completar A0. Un número indicado aquí no confirma build real.

## 1. Arquitectura de referencia

```text
Requerimientos aceptados
       |
       v
  *.tsp + tspconfig.yaml                      protocolia.project.yaml
  (MODELOS + OPERACIONES +                   (destino, runtime, entornos,
   COMPORTAMIENTOS + CAPABILITIES + UI)       políticas no semánticas)
       |                                                |
       +---------------------+--------------------------+
                             |
             TypeSpec compiler + @protocolia/domain
                             |
                validation + canonical IR vNext
                 |            |             |
           Schema/API       Domain        UI/capabilities
           projection       semantics     projection
                 |            |             |
                 +------------+-------------+
                              |
                 adapter capability negotiation
                        /             \
                jhipster-spring   jhipster-nestjs
                   (A0/A1)          (A3)
                        \             /
                    generated application
       Spring/Nest + DB + React + Security + Tests + Docker
                              |
                    independent conformance
```

**Regla fundamental:** `protocolia.project.yaml` solo contiene `target`, versión seleccionada, parámetros de ejecución, configuración de infraestructura y perfiles explícitos. No puede redefinir entidad, tipo, permisos ni behavior. La API y el JDL se generan desde un único modelo TypeSpec+ProtocolIA.

## 2. Modelo de datos semántico (IR vNext)

El IR es un formato de datos canónico de ProtocolIA, no una serialización directa de objetos internos TypeSpec, ni un AST de JDL. Debe poder validarse aisladamente y versionarse sin TypeSpec instalado.

Conceptos normativos:

| Concepto | Propiedades mínimas |
|---|---|
| Application | `irVersion`, stable namespace, app ID, supported profile, contract digest |
| Entity | symbol ID estable, external identity, fields, persisted mapping, unique/index/check, lifecycle |
| Field | stable ID, scalar type, required, nullable, default, min/max, length, precision, exposure |
| Relationship | source/target, cardinalidad, FK, delete policy, optionality, permitted lookup |
| Operation | symbol ID, request/response, URI/method, effects, success/error statuses, capability |
| Behavior | `kind` discriminado, input→field mapping, pre/post conditions, transaction/isolation, concurrency/error outcomes |
| View | resource, kind (list/detail/create/edit/action), field order, labels, widgets, visibility/read-only |
| Capability | stable business action permission; source-of-principal claims separately configured/trusted |
| Projection metadata | provenance from file/symbol/line, source digest, generator ownership and capability map |

**Semántica no negociable:**
- `required` y `nullable` son ejes distintos; diferenciar valor omitido de `null`.
- Fecha/hora con timezone tiene mapeo explícito y prueba roundtrip; nunca asignar un tipo temporal por conjetura.
- Unicidad e identidad de recursos son cosas distintas. Un surrogate interno no altera la identidad HTTP pública.
- `atomicIncrement` significa sumar a estado persistente dentro de una transacción, preservar escrituras concurrentes, comprobar precondiciones y overflow, devolver nuevo estado confirmado. No equivale a read→modify→write.
- `patchFields` solo modifica los campos declarados y conserva los demás. `null`, ausente y valor deben cumplir contrato.
- Los errores no son decorativos. Un generador no puede declarar 409 sin implementar el conflicto o adoptar un status alternativo.
- Todo handler generado incluye imposición server-side de capabilities; la UI únicamente oculta/inhabilita controles.

### Comportamientos vNext-0

`create`, `get`, `listPage`, `patchFields`, `delete`, `atomicIncrement`.
Campos obligatorios por `kind`, versión semántica y tabla de excepciones. Estados y workflows arbitrarios, efectos externos, saldo financiero, operaciones entre múltiples agregados y colas **fuera de alcance** hasta diseñar su semántica.

### Gramática TypeSpec

Desarrollar una biblioteca de decoradores y reglas TypeSpec: entidad, identidad, persistencia, relación, política, view, operación y comportamiento. La firma exacta de los decoradores es entregable de A0. **No publicar una sintaxis inventada como si compilara hoy.**

Modelo **ilustrativo de intención**, no código TypeSpec válido ni API existente:

```yaml
entity: Tool
identity:
  public: code
fields:
  code: { type: string, required: true, unique: true }
  name: { type: string, required: true }
  quantity: { type: integer, minimum: 0 }
operations:
  addQuantity:
    http: { method: PATCH, path: /api/tools/{code}/quantity }
    behavior:
      kind: atomicIncrement
      field: quantity
      input: amount
      minInput: 1
      maxResult: 2147483647
    capability: inventory.write
```

Los ejemplos definitivos serán **fixtures `.tsp` que pasan el compilador real**, con snapshot IR y pruebas negativas. Evitar un segundo YAML declarativo editable como el de arriba.

## 3. API pública del adaptador

Se define una interfaz lógica `GeneratorAdapter`; A0 fijará su forma TypeScript exacta.

```text
describe() -> { name, version, supportedIrVersions, supportedCapabilities }
probe(environment, pinnedToolchain) -> validated ToolchainReport
plan(ir, targetConfig) -> GenerationPlan | UnsupportedDiagnostic[]
generate(plan, stagingDir) -> GeneratedTree + OwnershipManifest
verify(stagingDir, conformanceFixture) -> EvidenceReport
```

- `plan` **no escribe** artefactos; verifica exhaustivamente soporte y campos/behaviors; un target no puede ignorar silenciosamente una anotación.
- `generate` invoca generadores externos únicamente con argumentos construidos por adaptador, desde plantilla/copia controlada de insumos validados; **no ejecuta comandos arbitrarios recibidos del contrato**.
- `verify` puede reutilizar suites estándar; el resultado por target y capacidad se almacena separadamente.
- La versión de IR se negocia explícitamente. Operación sin implementación soportada implica FAIL/UNSUPPORTED, nunca stub 501 ni HTTP 200 falso.
- Para evitar lock-in, las capacidades se nombran semánticamente (`entity.unique`, `behavior.atomicIncrement`, `ui.referenceLookup`), no por nombres de clases JHipster.

## 4. Ownership, regeneración y migración

**Tres superficies distintas:**

1. **Fuente del consumidor:** contratos `.tsp`, `protocolia.project.yaml`, secretos en entorno. No se escribe sobre ellas.
2. **Archivos gestionados:** outputs TypeSpec/JDL, código del generador, SQL/migraciones baseline, UI, tests, manifests, Docker. Cada archivo lleva digest/owner/adapter/version y se regenera en staging aislado.
3. **Extensiones explícitas del consumidor:** carpeta y APIs de hooks definidas, fuera del árbol gestionado. Se conservan byte a byte. Las extensiones no pueden eludir reglas contractuales/seguridad.

**Regeneración:** snapshot anterior → diff IR (compatible/breaking) → plan de migración → generación en staging → construir/probar → swap atómico o abortar. Si existen archivos no gestionados o cambios en gestionados, bloquear sin borrar. No aplicar migraciones a DB externa por accidente.

**Persistencia:** durante A1 se genera baseline para DB vacía. Después, migraciones **aditivas** verificadas (nuevo campo opcional, nueva tabla, nuevo índice); cambios destructivos, rename ambiguo y cambios de key exigen propuesta explícita y revisión humana. No asumir que Liquibase/TypeORM producirán SQL seguro sin política propia. Mantener el mismo contrato independientemente de si el destino usa Liquibase o migraciones TypeORM.

## 5. JHipster como adaptador — límites y condición de descarte

**A favor:** generador de aplicación completa, entidades+relaciones+UI+persistencia+seguridad; usa React/Vite, incorpora Playwright; el blueprint Node aporta NestJS/TypeORM.

**No garantiza:** total fidelidad a identity natural, rutas personalizadas, firma exacta API, behaviors atómicos, migraciones seguras en DB poblada, auth profiles equivalentes entre lenguajes, output byte a byte determinista. JDL no cubre toda la semántica; un emitter propio debe conservar operaciones especializadas y conectar puntos de extensión sin forks grandes.

**A0 es un spike de decisión, no una aprobación por documentación.** JHipster se acepta como default solo cuando:
- C1 `Tool.code` se conserva públicamente; no filtrar identificador surrogate por accidente.
- `create/get/list/rename/increment` mantienen path/status/input/output/capability originales.
- Se obtiene React navegable y persistencia real con el generador, sin parches por entidad.
- Regenerar no destruye código personalizado ni modifica contrato; no se mantiene un fork invasivo.
- Docker build y HTTP/DB/Playwright pasan.
- Los errores de compatibilidad se registran y pueden corregirse mediante **adaptador reusable**, no un parche ad-hoc de `Tool`.

Si falla cualquiera de las condiciones materiales y no existe solución reusable acotada, cambiar a adaptador modular (OpenAPI Generator + Spring Data/JDBC + React-admin/RJSF u otro stack probado). El IR **no cambia**.

## 6. Restricciones tecnológicas y perfiles

| Elemento | Selección inicial | Estado |
|---|---|---|
| Contratos | TypeSpec + `@protocolia/domain` | PROPOSED; construir en A0 |
| Implementación compiler/CLI | TypeScript sobre TypeSpec Compiler; Python histórico aislado | PROPOSED |
| Emisor OpenAPI | `@typespec/openapi3` y JSON Schema según perfil | TO VERIFY exact OpenAPI 3.1 / nullability mapping |
| Motor fullstack | generator-jhipster 9.4.0 | CANDIDATE A0 |
| Primer backend | Java 21 / Spring Boot target generador JHipster | CANDIDATE A0; **no dar por supuesto Boot 4 exacto** |
| Segundo backend | generator-jhipster-nodejs 4.2.0 / NestJS 12 / TypeORM 1 | CANDIDATE A3 |
| .NET | JHipster dotnetcore 4.5.0 → JHipster 8.11.0 | DEFERRED; sin compatibilidad v9 demostrada |
| DB | PostgreSQL 16+ | TARGET; comprobar versiones soportadas upstream |
| Migraciones | Liquibase Spring; migraciones del blueprint Node | TARGET por adaptador |
| UI | JHipster-generated React/Vite + extension renderers | TARGET A0; fallback UI genérica |
| Tests | HTTP, Testcontainers/PostgreSQL, Playwright | REQUIRED |
| Runtime deployment | Docker + optional Render Free | TARGET; perfil ephemeral opt-in |

**Versión de TypeSpec:** fijar una única versión exacta con sus paquetes compañeros una vez A0 arranque. No mezclar paquetes incompatibles. No referenciar `TypeSpec 1.x` como si fijara el toolchain.

## 7. Seguridad y límites de confianza

Contrato y dependencias no son código arbitrario con autorización ilimitada: procesar TypeSpec/paquetes de confianza fijados, limitar dependencias, compilar en sandbox sin secretos ni acceso a repos privados. Los decoradores TypeSpec se implementan en JavaScript ejecutable: **no compilar paquetes de terceros no verificados** como contenido seguro. Generadores JHipster son herramientas ejecutables: lockfiles, origen auditable, sin pasarles credenciales productivas.

`capability` es la intención de negocio; identidad y roles reales provienen de config/claims firmados en runtime. Reutilizar seguridad generada sólo si su enforcement exacto está verificado por pruebas HTTP negativas. Operaciones que requieran APIs pagas o privilegios exteriores quedan fuera del perfil.

## 8. Por qué se rechazan otras arquitecturas como camino principal

- **JDL-first:** acopla la semántica a limitaciones de JHipster; deja sin independencia al contrato.
- **OpenAPI-first:** especifica rutas y modelos, no persistencia ni transacciones.
- **Construir ORM/UI/Auth propios completos:** trabajo duplicado e innecesario; mayores riesgos de seguridad/mantenimiento.
- **Wasp como base única:** acelera Node/React, pero no cumple el objetivo multibackend con contratos agnósticos.
- **Un generador propio por cada lenguaje desde día cero:** demasiada superficie; primero cerrar un sistema verificable, después probar portabilidad.
- **Mantener permanentemente 2 motores frontend:** elegir una ruta por target; fallback si falla, no dos stacks duplicados.
- **Aceptar outputs parciales:** un cliente compilado sin backend real o UI dummy no es sistema generado.

## 9. ADRs y documentación histórica

- [ADR-003](../ADR-003-FULLSTACK-COMPOSITION.md): composición G5 limitada, sigue históricamente aceptada.
- [G5 evidencias](../G5_CONTRACT_EVOLUTION_PROGRESS.md): no trasladar sus PASS a vNext.
- [Plan ejecución vNext](02_IMPLEMENTATION_PLAN.md) y [matriz](03_ACCEPTANCE_MATRIX.md): fuente para implementar esta decisión sin inferencias.
