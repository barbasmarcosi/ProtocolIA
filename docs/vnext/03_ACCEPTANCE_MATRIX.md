# ProtocolIA vNext — Matriz de aceptación y conformance

**Estado:** MATRIZ NORMATIVA CON EVIDENCIAS PARCIALES REALES: A0/A1/A4/A5 PASS acotado, A3 paridad funcional Taller/Gauge PASS ([A3](evidence/A3.md)), A2 Docker Engine NOT RUN y A3 P-06 Nest evolution PASS aditivo acotado.  
**Fecha:** 2026-10-13. **Fuente de requisitos:** [00](00_PRODUCT_REQUIREMENTS.md); **plan:** [02](02_IMPLEMENTATION_PLAN.md).  
**Principio:** generar código o arrancar Spring/NestJS **no equivale** a construir el sistema declarado.

## 1. Definición de resultado y obligatoriedad

- **PASS:** prueba corrio efectivamente sobre commit y toolchain registrados; observa HTTP/DB/Browser real y comprueba expected.
- **FAIL:** ejecutó y no cumplió la aserción.
- **BLOCKED:** falta entorno, generación, compilación o capacidad; motivo preciso. Nunca equivale a PASS.
- **UNSUPPORTED:** feature expresamente fuera de la matriz declarada del destino, diagnosticada **antes** de generar; prohíbe afirmar perfil completo.
- **NOT RUN:** prueba aún no ejecutada o no existe.
- **GENERATED:** output escrito, no implica compilación.
- **LIVE:** despliegue accesible públicamente; no implica paridad funcional con contrato sin pruebas HTTP/browser pertinentes.

El `evidence.json` por ejecución debe registrar contract SHA, IR SHA, toolchain versions+digests, adapter, target, code SHA, command, exit status, case IDs, observed response/status/DB delta, environment, timestamp, links/artefactos. Secretos redacted. Publicar resumen `evidence/A*.md` con resultados reales. **No registrar estados hipotéticos como pruebas.**

## 2. Escenarios normativos — Taller C1

| ID | Preparación + acción | Observación obligatoria | Etapa |
|---|---|---|---|
| T-01 | Contrato TypeSpec compila y emit JDL/OpenAPI/IR | Mismos tipos, operaciones, schemas y `capabilities`; fuente única; diffs cero bajo toolchain fijado | A0 |
| T-02 | Campo/code vacío o nombre vacío al crear | 4xx validación, ningún registro creado | A1 |
| T-03 | Crear `{code: "T-001", name:"Multímetro", quantity:2}` | 201 + JSON coherente, fila persistida; GET por `T-001` retorna 200 | A1 |
| T-04 | Repetir `T-001` | 409 sin modificar fila previa | A1 |
| T-05 | Crear quantity negativo o input desconocido | 4xx y DB intacta; no coerción silenciosa | A1 |
| T-06 | Crear fecha opcional omitida, `null` y una fecha válida | Persistencia+roundtrip semánticamente correctos; formato/offset no alterados arbitrariamente | A1 |
| T-07 | GET código inexistente | 404 definido, sin fuga de datos | A1 |
| T-08 | Listar desde DB poblada y paginar `limit/offset` | `items`, `total`, `limit`, `offset` correctos, orden estable | A1 |
| T-09 | Renombrar herramienta | Solo name cambia; code y quantity permanecen | A1 |
| T-10 | Incrementar 3 sobre quantity=2 | Resultado persistente = 5, response refleja 5 | A1 |
| T-11 | 10 incrementos concurrentes de +1 sobre quantity=2 | Resultado final = 12, no lost updates, sin uso de locks globales de proceso | A1 |
| T-12 | Incremento negativo, cero si prohibido, o causa overflow | 4xx/409 tipado, sin actualización ni desbordamiento | A1 |
| T-13 | GET sin autenticación / con credencial inválida | 401 según perfil protegido, ninguna exposición adicional | A1 |
| T-14 | Lector GET permitido, lector POST/PATCH prohibido | GET 200, escrituras 403 incluso HTTP directo | A1 |
| T-15 | Gestor puede crear/renombrar/incrementar | Operaciones correctas sin conceder permisos anónimos | A1 |
| T-16 | Abrir UI escritorio+móvil, iniciar sesión, listar | Navegación y contenido realmente servidos desde backend | A2 |
| T-17 | Crear por formulario, detalle, incrementar y renombrar | Refresco observable de lista y detalle, formularios coherentes con schema | A2 |
| T-18 | Mostrar loading, lista vacía, invalid, 401/403 y error de red | UI recuperable, sin success falso; no request write de lector | A2 |
| T-19 | Reconstruir desde checkout limpio con TypeSpec+config | Docker/PostgreSQL/API/UI arrancan, pruebas pasan; 0 archivos por entidad creados a mano | A2 |
| T-20 | Regenerar dos veces y cambiar un input compatible | Ownership intacto, extensiones sin cambios, contrato compatible y salida coherente | A5 |

**Oracle:** los requisitos de C1 deben coincidir con el Taller experimental actual; se acepta variación de tecnologías o identidad DB interna, **no** alteración de API/semántica de negocio para forzar PASS.

## 3. Escenarios de portabilidad C3

| ID | Prueba | Criterio |
|---|---|---|
| P-01 | Construir Spring y Nest desde `*.tsp` con digest idéntico | Ningún contrato modificado por destino; IR semántico idéntico |
| P-02 | Ejecutar T-02…T-15 sobre ambos | Misma semántica declarada, estados y resultados, incluida concurrencia |
| P-03 | Probar endpoint desconocido, malformado y protected | Errores consistentes con contrato; no exposición extra |
| P-04 | Verificar schema database independiente | Diferente ORM/DDL interno permitido; invariantes y persistencia equivalentes |
| P-05 | Simular feature no soportada para un adaptador | `plan` rechaza con diagnóstico preciso y no genera app que mienta |
| P-06 | Regeneración sin extensiones perdidas por ambos backends | No edits manuales per-resource entre runs |

**Restricción:** un `UNSUPPORTED` explícito protege honestidad, pero no cuenta como PASS de C3. Para cerrar A3, el conjunto exacto del Taller debe pasar en NestJS.

## 4. Escenarios del dominio independiente C2

| ID | Prueba | Criterio |
|---|---|---|
| E-01 | Contrato con `Equipo` e `Inspeccion` sin código específico | Generator outputs contienen ambas entidades con FK |
| E-02 | Crear Inspección con Equipo existente | Persistencia y GET/list incluyen relación correcta |
| E-03 | Crear Inspección con Equipo inexistente | 4xx documentado + integridad DB, no huérfanos |
| E-04 | Borrar Equipo con Inspecciones | Acción de FK declarada (restrict/cascade), no pérdida accidental |
| E-05 | UI Inspección → selector Equipo | Consulta real, conserva referencia, lector sin write |
| E-06 | Listados independientes con paginación | Sin confundir `total` entre recursos o cache keys |
| E-07 | Cambiar etiquetas/orden/campo opcional en contrato | UI/DTO/DB se actualizan sin edición manual |
| E-08 | Inspeccionar source tree generado | Ningún `if (entityName === Tool/Book/Equipment)` dentro del engine genérico |

## 5. Escenarios negativos del compilador

| ID | Input inválido | Resultado esperado |
|---|---|---|
| N-01 | Uso de entidad inexistente / FK roto | Error en fichero/símbolo, no output partial |
| N-02 | `atomicIncrement` de un string / boolean | Error semántico, no código emitido |
| N-03 | `public` capability para mutación protegida | Contrato inconsistente rechazado |
| N-04 | Operation sin `behavior` vinculante | Error unsupported en lugar de stub |
| N-05 | `required` vs `nullable` incompatible con target | Error con feature/target |
| N-06 | Timestamps, límites o enum no soportados en mapeo | Error antes de ejecutar generador |
| N-07 | Campo de identidad alterado sin migration plan | Breaking; regeneración segura denegada |
| N-08 | Cambiar target conservando contrato | Capability negotiation; no reescritura de fuentes |
| N-09 | Cambiar un archivo propio generado | Rechazar overwrite no autorizado |
| N-10 | Agregar archivo ajeno en output gestionado | No eliminar ni sobrescribir, bloquear con mensaje |
| N-11 | Cambio destructivo (drop table/column) en DB con datos | Nunca ejecutar automáticamente |
| N-12 | Contrato intenta introducir comandos/shell/SQL arbitrario | Bloqueo; ninguna ejecución de contenido no confiable |
| N-13 | Múltiples tools versions incompatibles | Fallo de preflight, no baseline falsamente reproducible |
| N-14 | JHipster altera public identity `code` a `id` | Contract parity FAIL y A0 NO-GO hasta adaptador reusable |

## 6. Matriz requisitos → etapas → evidencia

| Requisitos | A0 | A1 | A2 | A3 | A4 | A5 |
|---|---|---|---|---|---|---|
| FN-01/02/03/17/18 | Modelo+IR | Extender semántica | CLI | Paridad | Relación | Diff |
| FN-04 | Modelar relación | FK support | UI lookup | Donde soportado | Prueba real | Evolution |
| FN-05/06/07/08/09/12 | Delimitar soporte | **DB/HTTP/auth PASS** | Integración | **Paridad** | Segundo dominio | Regenerar |
| FN-10/11 | UI/manifest decisión | Forms mapping | **Browser PASS** | Browser donde aplique | Referencias | UI evolution |
| FN-13/14/15 | Toolchain/ownership | Generate behavior | **One command** | Segundo adapter | Clean-room | **Safe regeneration** |
| FN-16/19 | Interfaz adapter | Capability set | Primer target | **Segundo target** | Generalidad | Release contract |
| FN-20/21/22 | Diagnostics/fixture | Auth+concurrencia | Browser/docker | Same suite | Independent suite | Evidence |

## 7. Reglas de cierre de etapa

- A0 PASS exige una app JHipster real con al menos CRUD del Taller verificable y decisión GO/NO-GO. `IR generado` aislado no basta.
- A1 PASS exige backend del Taller en PostgreSQL, transacciones y permisos, sin dominio handwritten.
- A2 PASS exige app completa mediante un comando y browser E2E, sin pantallas por recurso.
- A3 PASS exige *mismo contrato* operativo en Spring y NestJS y misma suite T-02…T-15.
- A4 PASS exige segundo dominio multi-entidad independiente, FK, UI y tests de relación.
- A5 PASS exige compatibilidad/regeneración sin pérdida y tutorial en limpio. Completar docs sin ejecutar tests no cierra etapa.

**Importante:** no hay medición de tokens como puerta de cierre. La evidencia puede ser mínima pero debe ser verdadera y suficiente; no agregar 10 pruebas decorativas cuando 1 prueba real demuestra una condición.

## 8. Resultado real del target NestJS (2026-10-13)

- **P-01 PASS:** TypeSpec/IR/OpenAPI hashes idénticos Nest/Spring para Taller y Gauge.
- **P-02 PASS:** T-02–T-15 observados en NestJS y Spring con HTTP y PostgreSQL real, 10 incrementos concurrentes, auth y errores.
- **P-03 PASS acotado:** JSON desconocido, validaciones, protegido 401/403; fuzzing HTTP no incluido.
- **P-04 PASS acotado:** PostgreSQL real, tablas y semántica persistente equivalente; Nest usa su propio historial de esquema, no Flyway.
- **P-05 PASS:** preflight NestJS rechaza operaciones, tipos, rutas, identidad y permisos incoherentes.
- **P-06 PASS aditivo acotado:** Nest `app:plan/evolve` aplica V2 sobre base poblada; comprueba baseline, historial SHA-256, filas y extensions conservados, drift rechazado. No implica migraciones destructivas/productivas.
- Build `dep-db79nmq5b2lc73f3cnq0`, código fuente `e1f004c0576a41b5fb5b2008368fa2bb283c58d9`, Render Free marker-only; 31/31 tests Node, POST/GET/PATCH/DELETE del Taller/Gauge, React Chromium y regresiones Spring/A4/A5 PASS. Véase [A3](evidence/A3.md).

## 9. Validación complementaria Nest A3 multientidad / A5 (2026-10-13)

Build **`dep-db7do367bikc73agk63g` LIVE**, fuente **`47379090898e2f16e9a1533ae5d42e61a03124a7`** en Render Free `srv-db6t203rjlhs7395vjn0`: Nest Equipment/Inspection PostgreSQL 400/409/204, roles/paginación y selector React Chromium más conformance genérica PASS; Nest V1→V2 con registros existentes, `checkedAt`, historia/checksum V2, sello/extension preservados y manipulación de SQL aplicada rechazada PASS. Regresiones Spring A4/A5 y Taller/Gauge PASS. `docker compose up` Docker Engine, backup real e IAM de producción permanecen NOT RUN.

## 10. A6 — Finite-state business behavior from TypeSpec (additional profile)

| ID | Acceptance scenario | Expected |
| --- | --- | --- |
| B-01 | Entity field `@initial("draft")` and operations `@transition(from,to)` | Canonical IR preserved, same TypeSpec/IR/OpenAPI digest for both adapters |
| B-02 | Create WorkOrder in `approved` or unknown state | HTTP 400; cannot skip contract transition via create |
| B-03 | Approve from draft; then close from approved | HTTP 200 with persisted state and correct subsequent GET |
| B-04 | Wrong source state, repeated approve/close or close before approve | HTTP 409, persisted state unchanged |
| B-05 | Ten simultaneous approvals of same draft row | Exactly one HTTP 200 and nine HTTP 409, final persisted state approved |
| B-06 | Anonymous read/reader mutation and invalid body | 401, 403, 400 as appropriate |
| B-07 | Mutated TypeSpec same-state transition, orphan source field, public write | Compile rejects; no supported false success |
| B-08 | Generate shared React state-action controls | Manifest/UI bundle PASS; targeted Chromium action test **NOT RUN** |

**A6 B-01–B-07 verified** on `86684c9e1db5af88097dff1718805967a92a58e3`, Render `dep-db7e4rbbc2fs73es6ab0` **LIVE**, both real Spring and Nest servers against disposable PostgreSQL. Generic suite `PROTOCOLIA_STATEFUL_CONFORMANCE_PASS` also passed separately in both. B-08 UI browser portion remains explicitly NOT RUN. See [A6](evidence/A6.md).

## 11. A7 — Atomic cross-entity inventory reservation (bounded)

| ID | Acceptance scenario | Actual |
| --- | --- | --- |
| C-01 | One TypeSpec contract + `@reserve` into Spring and Nest with identical IR hashes | PASS |
| C-02 | Create Part and Allocation: decrement matching stock atomically and persist FK child | PASS in both, PostgreSQL |
| C-03 | Unknown FK, quantity 0, unknown JSON properties | HTTP 400; no inventory debit |
| C-04 | Insufficient available stock | HTTP 409; no child creation |
| C-05 | Duplicate Allocation identity after conditional debit | HTTP 409; entire transaction rolled back, stock unchanged |
| C-06 | Ten independent 1-unit allocations competing for 7 remaining units | Exactly 7×201 + 3×409, stock 0, 8 total allocations |
| C-07 | Anonymous/reader unauthorized writes | 401/403, no state changes |
| C-08 | Generic conformance derived from UI resource/IR metadata, independently of entity name | `PROTOCOLIA_TRANSACTIONAL_CONFORMANCE_PASS` on both |
| C-09 | Invalid reserve adapter metadata and safe identifiers | Unit negative tests PASS |
| C-10 | A7 Chrome frontend relation selector and stock changes from UI | **NOT RUN specifically for A7** |

**C-01–C-09 PASS bounded** using source `ad34b7f2d33c123cfd404d30e12fe18d58ab4a97`, deploy `dep-db7eck8473hc73d32jjg` **LIVE**, service `srv-db6t203rjlhs7395vjn0`. See [A7](evidence/A7.md). This is one transaction with one stock debit + one child insert, not arbitrary multi-entity business rule generation.
