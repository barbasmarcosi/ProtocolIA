# ProtocolIA vNext — Documentación de implementación

**Última definición:** 2026-10-13. **Estado del producto:** PLANIFICADO; A0–A5 sin implementar.  
**Objetivo:** obtener aplicaciones funcionales desde contratos TypeSpec, sin programar backend/SQL/React por entidad para las capacidades declaradas como soportadas. **Tokens ahorrados no son el criterio de éxito.**

## Orden de lectura para implementar

1. [00 — Requisitos de producto](00_PRODUCT_REQUIREMENTS.md) — qué debe hacer, límites, comportamiento y definición de éxito.
2. [01 — ADR-004: arquitectura](01_ARCHITECTURE_ADR.md) — TypeSpec, IR, adaptadores, JHipster-first y fallback.
3. [02 — Plan maestro A0–A5](02_IMPLEMENTATION_PLAN.md) — dependencias, entregables, tareas y cierre de etapas.
4. [03 — Matriz de aceptación](03_ACCEPTANCE_MATRIX.md) — pruebas HTTP/DB/auth/browser, portabilidad y casos negativos.
5. [04 — Runbook de ejecución](04_EXECUTION_RUNBOOK.md) — primera acción concreta, ramas, reportes y continuidad.

## Decisión vigente

```text
Requerimientos revisados
   -> *.tsp + @protocolia/domain
   -> TypeSpec Compiler + canonical semantic IR
   -> adapter negotiation
   -> JHipster 9.4 / Spring Boot / React / PostgreSQL (A0 candidate)
   -> NestJS blueprint (A3 second target)
   -> real conformance + safe regeneration
```

JHipster es **candidato, no requisito irreversible**. Solo se adopta como motor inicial tras A0 si respeta identidad pública, HTTP/errores, seguridad y regeneración. El mismo IR sirve para un adaptador modular alternativo. El conjunto limitado de comportamientos iniciales es `create/get/listPage/patchFields/delete/atomicIncrement`.

## Estado por etapa

| Etapa | Estado actual | Próxima evidencia requerida |
| --- | --- | --- |
| A0 — TypeSpec + JHipster GO/NO-GO | NOT STARTED | App Taller JHipster generada y CRUD real, `Tool.code` preservado |
| A1 — Backend/semántica | NOT STARTED | Taller sin Java/SQL escritos por entidad y con incrementos atómicos |
| A2 — Web+CLI+Docker | NOT STARTED | App completa y Playwright desde un comando |
| A3 — NestJS | NOT STARTED | Paridad contractual del Taller en segundo backend |
| A4 — Nuevo dominio | NOT STARTED | Equipos + Inspecciones, FK, UI, permisos |
| A5 — Evolution/MVP | NOT STARTED | Regeneración segura y evolución con datos |

**Iniciar por A0.** Se conservan los experimentos existentes sin atribuirles capacidades de vNext; no hay tests nuevos ejecutados por el mero hecho de aprobar este plan.

## Historial preservado

- [G0–G5, Books](../G5_CONTRACT_EVOLUTION_PROGRESS.md) — piloto completo dentro de su alcance, no general.
- [Taller manual](https://github.com/barbasmarcosi/ProtocolIA/blob/experiments/p5-taller-real-requirements-v1/experiments/taller-requirements-v1/EVIDENCE.md) — app real + PostgreSQL + Render, con dominio/UI manuales.
- [ROADMAP P0–P6](../ROADMAP.md) — track histórico y otros ámbitos de investigación.
- [Execution state](../EXECUTION_STATE.md) — estado global.
