# ProtocolIA vNext — Plan maestro de implementación

**Estado:** PLAN ADOPTADO / ETAPAS A0–A5 PENDIENTES. **Fecha:** 2026-10-13.  
**Precedencia:** sustituye la secuencia prospectiva A1–A5 del antiguo [North Star](../CONTRACT_TO_WORKING_APP_NORTH_STAR.md) y los próximos trabajos de `FULLSTACK_IMPLEMENTATION_PLAN.md`; no borra los resultados históricos G0–G5.  
**Referencias obligatorias:** [requisitos](00_PRODUCT_REQUIREMENTS.md), [ADR-004](01_ARCHITECTURE_ADR.md), [acceptance](03_ACCEPTANCE_MATRIX.md), [runbook](04_EXECUTION_RUNBOOK.md).

## 0. Objetivo de entrega, no proceso por el proceso

Crear una ruta real `*.tsp + config → proyecto full-stack → pruebas → aplicación funcional`, soportando operaciones de dominio explícitas. **No se mide éxito por tokens, velocidad de los agentes, commits, cantidad de checks, PRs o líneas generadas.**

Un artefacto no se declara DONE por existir en el repo. DONE = ejecutar desde checkout limpio **y** verificar comportamiento real. No repetir auditorías no relacionadas ni introducir un sistema de approvals que bloquee desarrollo local. Únicamente validaciones que previenen pérdida de datos, inconsistencias de contrato, problemas de seguridad o falsos positivos.

Los contratos se escriben/revisan antes de generar. Está permitido corregir contradicciones de requisitos en la fase de modelado; queda prohibido remendar el backend/UI por entidad después de congelar los contratos para simular automatización.

## 1. Dependency graph y estrategia de entregas

```text
A0: TypeSpec → IR → JDL; prueba JHipster y decisión go/no-go
  |
  v
A1: biblioteca de comportamiento → DB + handlers + autorización (Taller)
  |
  v
A2: UI + one-command + Docker + pruebas browser (Taller)
  |
  +-----------> A3: segundo destino NestJS (mismo contrato)
  |
  +-----------> A4: segundo dominio con 2 entidades relacionadas
                    |
                    v
                 A5: evolución/regeneración segura y empaquetado MVP
```

A3 y A4 pueden avanzar en paralelo **después** de un A2 real y estable; A5 recopila ambas evidencias. No abrir branches gigantes ni iniciar motores alternativos antes del resultado de A0.

## A0 — Spike tecnológico y contrato canónico [DECISIÓN BLOQUEANTE]

**Hipótesis.** TypeSpec representa entidades/operaciones/validaciones; nuestra biblioteca aporta comportamientos y capabilities; un emitter puede producir JDL sin alterar identidad o API; JHipster 9.4 genera un React + Spring + PostgreSQL usable.

**Entradas:** copia **inmutable** de los requisitos reales de Taller desde la rama experimental; API/HTTP/error/capability baselines; toolchains oficiales TypeSpec y JHipster; límites de identidad natural.

**Implementar:**
1. Crear espacio `packages/contracts` y `packages/compiler` TypeScript. Fijar versiones compatibles exactas `@typespec/compiler`, HTTP/REST, OpenAPI3, JSON Schema, npm; comprobar origen/licencias. Definir estructura de proyecto, `tspconfig.yaml` y primeros decoradores **reales** (entidad/identity/behavior/capability/view) con diagnóstico.
2. Escribir contrato `examples/vnext/taller/contracts/*.tsp` del Taller. Debe representar `code` como identidad pública; `quantity` nonnegative, `lastReviewedAt` nullable, operaciones/paths/status y rol lector/gestor. No modificar el oracle del demo manual.
3. Emitir `ir.json`, `openapi.json`, `jdl` temporal y manifiesto de capacidades en directorio gestionado. Añadir prueba de una entrada inválida y incompatibilidad declarativa. El JDL nunca se edita.
4. En container limpio, generar app JHipster 9.4 con React + Spring + PostgreSQL y CRUD. Probar `Tool.code`, tipos/validaciones, rutas y status HTTP reales, FK cuando corresponda. Documentar cualquier diferencia respecto al contrato.
5. Examinar extensiones/blueprints vs parche ad-hoc. Probar dos generaciones sobre misma fuente y preservación de carpeta de extensiones; registrar archivos gestionados y conflictos.
6. Probar si los comportamientos `rename` y `atomicIncrement` necesitarán un emisor adicional y definir qué superficie exacta tienen los handlers sin codificar `Tool` a mano. No se exige A1 implementado aquí.
7. Guardar informe GO/NO-GO con SHA, comandos, versiones y bloqueos, incluyendo coste operacional en Render Free y licencia.

**Cierre A0:** TypeSpec compila y emite IR/JDL; app básica Spring+React con PostgreSQL **arranca y funciona** sin editar JDL generado; la identidad pública `code` puede preservarse mediante un adaptador genérico sin desfigurar contratos; al menos una prueba HTTP CRUD y un primer browser smoke sobre DB real; preservación de extensiones demostrada o plan de resolución acotado. Si el motor genera un scaffold pero no cumple API/identidad, **NO-GO para JHipster**, no para ProtocolIA.

**Fallback A0:** el mismo IR se proyecta a OpenAPI Generator 7.26 + persistencia de Spring Data/JDBC + UI React-admin/RJSF cuando sea viable. Reusar el frontend/types previos si aceleran; no escribir un fork de JHipster. Registrar comparación de cumplimiento, no economía de tokens.

**Artefactos esperados:** `packages/contracts/`, `packages/compiler/`, `packages/adapters/jhipster/`, `examples/vnext/taller/`, `docs/vnext/evidence/A0.md`. Todo PROPOSED hasta verificado.

## A1 — Reglas ejecutables, base de datos y enforcement [PRIMER VALOR CENTRAL]

**Objetivo:** el Taller deja de depender de `ToolInventory.java`, `ToolsDelegate.java`, Flyway escrito para Tool y SQL específico del experimento original. Lo genera la plataforma o el motor externo a partir de contrato/IR.

**Implementar:**
1. Normalizar `behavior` discriminado con primitives `create/get/listPage/patchFields/delete/atomicIncrement`. Especificar inputs, mappings, postcondiciones, errores, bordes y transacciones.
2. Proyectar semántica a APIs concretas del backend JHipster, respetando el owner de cada archivo. Integrar operaciones especiales sin shadow controllers y sin 501.
3. Emitir constraints en PostgreSQL y migración baseline de DB vacía. Impedir drop/cast destructivos no autorizados.
4. Mapear capacidades `inventory.read` y `inventory.write` a roles/claims del runtime: verificación en cada handler, también por HTTP directo. Credenciales de demo por variables de entorno.
5. Emitir pruebas de comportamiento de `atomicIncrement`: diez incrementos paralelos sobre el mismo recurso deben acumular exactamente; rollback/conflictos y prohibición de negativos/overflow.
6. Implementar data fixtures declarativos de demo en sandbox, no contraseñas/producción.

**Cierre A1:** crear, listar, consultar, renombrar, incrementar y validar contra PostgreSQL real; HTTP 200/201/400/401/403/404/409 según semántica congelada; 10 concurrentes sin pérdida; todo generado desde la fuente TypeSpec+ProtocolIA **sin clases Java de negocio por entidad**. El test ejecuta el sistema generado; no pasa con mocks, mocks de DB o fake HTTP.

**Archivos meta:** `packages/semantics/`, `packages/adapters/jhipster/spring/`, `tests/conformance/backend/`, `docs/vnext/evidence/A1.md`.

## A2 — UI declarativa, ensamblado único y despliegue reproducible

**Objetivo:** después de escribir contratos, sin programar `ToolsScreen`/formularios/actions/cache por entidad, el usuario puede ejecutar la aplicación completa.

**Implementar:**
1. Traducir `View` y recursos IR a UI React de JHipster. Generar lista/crear/detalle/edición/acción, estados loading/empty/error/forbidden, labels, validación, paginación; implementar genéricamente lo que JHipster no cubra.
2. Resolver relación form/query para actions desde metadata, invalidación correcta tras escritura y 401/403 del backend sin false-success UI.
3. CLI única planeada: `protocolia app build ./examples/vnext/taller --target jhipster-spring --out ./dist/taller`; `test` y `run` (sintaxis se fija en A2). Debe invocar `validate → IR → plan → generate → compile → conformance` e informar PASS/FAIL con IDs.
4. Emitir Dockerfile y compose/perfiles de DB, configuración de app, `.env.example` sin secretos y log/health útil. Java/React compilados desde cero en container.
5. E2E Playwright sobre servidor/DB reales: login, lista, alta, detalle, renombrado, incremento, errores, actualización de caché y lector bloqueado.
6. Desplegar opcionalmente al Render Free existente/nuevo con datos efímeros **solo por acción autorizada**. No hacer claim de persistencia administrada.

**Cierre A2:** un checkout limpio del compilador y `taller/*.tsp`, `tspconfig.yaml`, `protocolia.project.yaml` bastan para construir e iniciar app full-stack. No edits manuales postgeneración. Tests browser + HTTP + DB + auth exitosos. La UI posee funcionalidad real, no mock screens.

**Archivos meta:** `packages/cli/`, `packages/adapters/jhipster/web/`, `templates/deployment/`, `tests/conformance/browser/`, `docs/vnext/evidence/A2.md`.

## A3 — Segundo backend, mismo contrato, mismas pruebas

**Objetivo:** portabilidad **demostrada**, no declarada.

**Implementar:**
1. Registrar adaptador JHipster Node **4.2.0**, JHipster **9.4.0**, NestJS 12 y TypeORM 1, con pins completos y probe de soporte. No suponer paridad de Spring.
2. Generar Taller desde exactamente el **mismo digest TypeSpec/IR** de A2, sin editar nombres/tipos/status/path para “conformar” el blueprint.
3. Mapear identity, constraints, transacciones y capabilities a NestJS/TypeORM. Prohibido sustituir incremento atómico por lectura+escritura vulnerable.
4. Ejecutar la misma conformance suite (HTTP, DB, auth, concurrent updates, browser donde aplica). Reportar soporte por capability y fallos exactos.
5. Definir matriz contract feature × destination con PASS/UNSUPPORTED/BLOCKED. En vNext se puede publicar un target parcial, **solo** si rechaza y señala cada operación no implementada.

**Cierre A3:** Taller con Spring y NestJS, contrato idéntico, operaciones del perfil verificadas en ambas plataformas. Ninguna clase/servicio manual por recurso. Si Nest no cumple, registrar BLOCKED y mantener un solo backend verificado; no llamar al proyecto “multilenguaje funcional” todavía.

**Archivos meta:** `packages/adapters/jhipster/nestjs/`, `tests/conformance/targets/`, `docs/vnext/evidence/A3.md`.

## A4 — Generalización independiente multientidad

**Objetivo:** demostrar que ProtocolIA no es un generador de Taller/Books hardcodeado.

**Entradas:** nuevos requerimientos `Equipos` + `Inspecciones` formalizados como `.tsp`, una FK, campos obligatorios y opcionales, rol lector/gestor, paginación/acciones.

**Implementar:**
1. Crear fixture desde cero sin copiar contrato Taller con simples reemplazos de nombres. Fijar casos de verificación **antes** de generar.
2. Generar base de datos con FK e índices, operaciones reales, selectores de referencia, vistas y permisos.
3. Validar integridad FK, eliminar referenciado/depuración de errores, unicidad, errores, auth, browser y paginación.
4. Repetir con el segundo backend donde sus capabilities lo permitan, respetando el mismo contrato.
5. Documentar qué características del IR se debieron generalizar; nuevas primitivas solo con semántica explícita.

**Cierre A4:** segunda app independiente con dos entidades y relación, generada y comprobada sin Java, SQL, JS de dominio escrito a mano. Ningún target necesita hardcode de nombres de entidades. Si falta FK/UI lookup, A4 sigue OPEN.

**Archivos meta:** `examples/vnext/equipment-inspections/`, `tests/conformance/multiresource/`, `docs/vnext/evidence/A4.md`.

## A5 — Evolución contractual, seguridad de regeneración y MVP

**Objetivo:** el consumidor puede mantener una aplicación generada sin perder extensiones o datos accidentalmente.

**Implementar:**
1. Validar cambios additive (campo opcional, índice, nueva entidad, nueva operación) y breaking (key, required, tipo incompatible, permisos restrictivos, delete).
2. Emitir `plan diff` readable y migraciones seguras. Fail-closed para destructivas; rollback de generación/staging.
3. Preservar extensiones byte-identical y detectar cambios en outputs gestionados.
4. Probar generar v1, introducir datos, evolucionar a v2 y comprobar conservación de datos y comportamiento; volver a compilar desde cero.
5. Publicar comandos, tutorial Taller y segunda app, notas de toolchains/licencias, matriz de soporte y resultados exactos. No prometer production IAM/backup si no existe.

**Cierre A5:** ambos fixtures generan limpio; cambios compatibles conservan DB de prueba, extensiones y comportamiento; breaking requiere aprobación explícita y no se aplica automáticamente; documentación mínima suficiente para tercero ejecutar sin asistencia. Versión MVP solo para **perfil soportado**, nunca generalización universal.

## 2. Prueba de decisión: JHipster GO vs NO-GO

| Pregunta A0 | GO | NO-GO o bloqueo |
|---|---|---|
| ¿Un JDL derivado puede recrearse automáticamente? | Byte-identical o equivalencia reproducible, sin editar JDL | Cambios manuales de JDL necesarios |
| ¿Respeta identidad pública `Tool.code`? | API/UI/DB comprueban sin fugas del surrogate | API exige `id` externo y no hay adaptador reusable |
| ¿Respeta HTTP/status/validación? | Test contrato pasa; diferencias arreglables genéricamente | Cambiar contrato para satisfacer la herramienta |
| ¿Genera UI y datos reales? | POST→DB→GET→vista verificados | Stub, mock o screens no funcionales |
| ¿Regeneración segura? | Extensiones preservadas y árboles propios reemplazables | Fork grande, ediciones destructivas |
| ¿Costo de mantenimiento? | Blueprint/reusable extension acotada y actualizable | Parches dispersos dentro de archivos de JHipster |

**Acción NO-GO:** documentar fallo mínimo reproducible, cerrar spike, implementar `adapter/openapi-modular` con el mismo IR; no retomar benchmarking de tokens. Si TypeSpec mismo no representa con fidelidad las semánticas requeridas, conservar provisionalmente IR/contrato v0.4 e implementar un transformador, pero resolver primero el modelo; no mantener dos fuentes de verdad indefinidamente.

## 3. Riesgos priorizados

| Riesgo | Impacto | Mitigación |
|---|---|---|
| TypeSpec/API-first no expresa reglas de negocio | Alto | Biblioteca `@protocolia/domain`, semántica declarativa canónica y fixtures de comportamiento |
| JHipster no soporta public natural ID / status HTTP exactos | Crítico | A0 hard gate, adapter reusable o fallback |
| Node blueprint no es paridad real | Alto | A3 independiente, capability negotiation |
| Re-generación rompe código/datos | Crítico | staging, ownership, diff IR y negativa ante breaking |
| Seguridad UI ≠ seguridad real | Crítico | tests de HTTP directo por cada permiso |
| Dos frameworks duplican trabajo | Medio | finalizar Taller Spring antes de segunda implementación |
| TypeSpec/JHipster dependencias enormes | Medio | pins en contenedores; medir build/runtime; mantener fallback |
| Pruebas excesivas frenan trabajo | Medio | suite pequeña de conformance reusada, no repetir ceremonias, registrar resultados concretos |
| P4/P3 contaminan alcance | Medio | tracks separados sin depender de pagos ni actuadores |

## 4. Orden práctico para continuar ahora

La **primera tarea de código** es A0: escribir contrato TypeSpec del Taller, generar IR+JDL, generar un proyecto JHipster Spring+React+PostgreSQL y verificar la primera operación HTTP real **incluida la identidad por code**. No iniciar A1 sin decidir si JHipster se comporta como adaptador fiel.

Mantener el servicio Render manual actual operativo como comparación; preservar main actual y abrir feature branches pequeñas basadas en esta decisión. Para mayor detalle de operación y evidencia ver [runbook](04_EXECUTION_RUNBOOK.md).
