# ProtocolIA vNext — Runbook de ejecución y continuidad

**Estado inicial:** A0 NOT STARTED; A1–A5 NOT STARTED. Este documento es operacional, no evidencia de PASS.  
**Actualizado:** 2026-10-13. **Plan maestro:** [02](02_IMPLEMENTATION_PLAN.md). **Pruebas:** [03](03_ACCEPTANCE_MATRIX.md).

## 1. Primera instrucción al próximo implementador

**Implementar A0**, no discutir de nuevo desde cero la arquitectura ni empezar P4. Leer en orden:
1. [00_PRODUCT_REQUIREMENTS](00_PRODUCT_REQUIREMENTS.md)
2. [01_ARCHITECTURE_ADR](01_ARCHITECTURE_ADR.md)
3. [02_IMPLEMENTATION_PLAN](02_IMPLEMENTATION_PLAN.md), sección A0
4. [03_ACCEPTANCE_MATRIX](03_ACCEPTANCE_MATRIX.md), T-01, N-01, N-04, N-14
5. Este runbook.

El primer resultado útil y observable es: **contrato TypeSpec real del Taller compilado a JDL y aplicación JHipster Spring + React + PostgreSQL ejecutándose**, con identidad por `code` preservada, un CRUD real y decisión GO/NO-GO trazable.

## 2. Repositorio y ramas

- Repo principal: `barbasmarcosi/ProtocolIA`.
- Baseline vigente: `main`; no modificar artefactos científicos congelados ni repos externos sin necesidad.
- Demo manual oracle: rama `experiments/p5-taller-real-requirements-v1`, [evidencia](https://github.com/barbasmarcosi/ProtocolIA/blob/experiments/p5-taller-real-requirements-v1/experiments/taller-requirements-v1/EVIDENCE.md). **No sobrescribir su fuente ni su Render LIVE**.
- Rama sugerida de implementación A0: `feature/vnext-a0-typespec-jhipster-spike`. Crear desde la última `main`, no desde el experimento manual. Copiar los contratos/evidencia del Taller como fixtures versionados, sin copiar implementaciones manuales al nuevo generador.
- En cada etapa, commits y PR con alcance acotado; no exigir aprobaciones del usuario para cada cambio interno salvo acciones externas/destructivas o coste potencial. Probar local/container cuando Actions no tiene minutos.
- Mantener el `README` apuntando a estos documentos; el estado real se declara aquí o en `docs/EXECUTION_STATE.md` al cerrar un gate.

## 3. Estructura objetivo (se crea progresivamente)

```text
packages/
  contracts/                     # TypeSpec decorators/library
  compiler/                      # canonical semantic IR + validators
  semantics/                     # behavior discriminated union
  adapters/
    jhipster/
      common/                    # IR -> JDL, JHipster orchestration
      spring/                    # Java domain behavior/permission binding
      nestjs/                    # NestJS behavior binding (A3)
    modular/                     # fallback if JHipster A0 NO-GO
  cli/                           # app validate|plan|build|test|run
examples/vnext/
  taller/
    contracts/                   # editable *.tsp, source of truth
    tspconfig.yaml
    protocolia.project.yaml      # target/infrastructure only
  equipment-inspections/
    contracts/
templates/
  deployment/
tests/
  conformance/
    compiler/
    backend/
    browser/
    targets/
docs/vnext/
  00_PRODUCT_REQUIREMENTS.md
  01_ARCHITECTURE_ADR.md
  02_IMPLEMENTATION_PLAN.md
  03_ACCEPTANCE_MATRIX.md
  04_EXECUTION_RUNBOOK.md
  evidence/
    A0.md ... A5.md              # only after actual execution
```

No crear carpetas vacías ni archivos de evidencia PASS de manera anticipada.

## 4. Invocaciones deseadas — no implementadas

```bash
# Objetivo CLI futuro. NO es comando actualmente disponible.
protocolia app validate ./examples/vnext/taller
protocolia app plan ./examples/vnext/taller --target jhipster-spring
protocolia app build ./examples/vnext/taller --target jhipster-spring --out ./dist/taller
protocolia app test ./dist/taller
protocolia app run ./dist/taller

# Después de validar NestJS A3:
protocolia app build ./examples/vnext/taller --target jhipster-nestjs --out ./dist/taller-nest
```

A0 puede exponer comandos de bajo nivel `npm run` / `tsp compile` / generador JHipster para experimentar, pero A2 debe integrarlos bajo la CLI única. No documentar flags definitivos sin haber implementado y probado sus parsers.

## 5. Ciclo por tarea — operativo y sencillo

1. Leer estado y contrato; fijar problema observable (por ejemplo, T-03 POST crea fila y GET por `code` la devuelve).
2. Realizar cambio mínimo orientado a cerrar ese caso y sus casos negativos; preferir herramientas upstream mantenidas frente a código duplicado.
3. Ejecutar compilación y prueba real más cercana. Registrar error observado y reparación, sin loops artificiales o límites de pasos arbitrarios.
4. Si una herramienta no soporta un contrato, registrar incompatibilidad y adaptador/fallback. No alterar el contrato del negocio para ocultar incompatibilidad.
5. Sólo cuando el resultado sea reproducible, commit, actualizar evidencia y pasar al siguiente caso.
6. Al final de la etapa, ejecutar suite pertinente en contenedor aislado; no gastar minutos de Actions si no hay disponibles.

## 6. Reportes de progreso y honestidad

Formato de `docs/vnext/evidence/Ax.md` después de ejecutar:

```text
Stage: A0/A1/...
Source commit:
Contract digest:
IR digest:
Toolchain versions:
Target:
Commands run:
Observed PASS cases:
Observed FAIL/BLOCKED/UNSUPPORTED:
Logs/artifact links:
Files authored per-resource AFTER contracts:
Remaining blockers:
Next reproducible action:
```

Estados permitidos: NOT STARTED, IN PROGRESS, BLOCKED, VERIFIED. Un test que falló antes de corregir se conserva como nota; el PASS posterior debe incluir el SHA del nuevo build. El ejecutor no se declara en estado VERIFIED porque exista un informe no contrastado.

## 7. Preflight de A0

- Confirmar Node compatible con JHipster 9.4/TypeSpec; instalar versiones **exactas** según `package-lock`/imagen; Java/DB según el target generado.
- Verificar TypeSpec `@typespec/compiler`, `@typespec/http`, `@typespec/openapi3` y emisor JSON Schema compatibles, junto a licencias. Documentar los pins reales en `docs/vnext/evidence/A0.md`.
- Preparar PostgreSQL descartable en Docker, sin credenciales productivas.
- Reconstruir manualmente contrato original Taller: key `code`, `name`, `quantity`, `lastReviewedAt`, listPage/create/get/rename/increment, roles. **No copiar implementación manual**.
- Primero obtener IR/JDL; comparar con JHipster-generated HTTP/API/UI; verificar comportamiento del `id` interno.
- Evaluar cómo insertar behavior handlers mediante mecanismo de blueprint o código gestionado propio; siempre reusable para otras entidades.
- Probar dependencia `generator-jhipster-nodejs` sólo tras cerrar camino Spring, salvo un diagnóstico que pueda bloquear de inmediato la estrategia (por ejemplo, incompatibilidad de versiones); no demorar el primer vertical funcional.

## 8. Reglas de descarte rápido

**Cambiar de herramienta, no de meta de producto**, si:
- TypeSpec decorator añade metadata pero no puede transportar el comportamiento necesario al IR sin hacks imposibles de validar; rediseñar biblioteca/declaración.
- JHipster obliga a cambiar identidad pública, API contractual o status HTTP y no hay adaptador general sencillo.
- JHipster destruye extensiones durante regeneración y no se puede aislar el árbol.
- Node blueprint no respeta el contrato y requiere mantener un fork gigante; declarar destino no soportado hasta contar con otro adaptador.

El fallback modular es concreto: TypeSpec → IR → OpenAPI → OpenAPI Generator Spring + templates de persistencia Spring Data/JDBC + frontend basado en recursos/React-admin/RJSF, reutilizando los componentes G5. **No** construir otro JHipster ni ORM propio.

## 9. No confundir con otros tracks

- G0–G5: compilación/React/Java demostrada solo en Books; no cumple contrato-sistema genérico.
- Taller manual: demo funcional con app-specific Java+SQL+React; es oracle, no A1/A2.
- P3: runtime de acciones de agentes y privilegios, no necesita intervenir.
- P4: economía/benchmarks de agentes, no es prioridad ni aceptación.
- Un `Render LIVE` solo verifica desplegado; las pruebas de operación deben estar vinculadas a esa build.

## 10. Regla de cierre de plan

Finalizar tareas pendientes hasta alcanzar la definición de éxito o presentar un blocker técnico verificable con fallback. No sugerir “100%” sin evidencias reales por gate. No trabajar en secreto ni prometer ejecución posterior. No crear costos o efectos externos fuera del alcance autorizado.
