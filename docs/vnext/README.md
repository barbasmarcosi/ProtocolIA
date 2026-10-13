# ProtocolIA vNext — Documentación de implementación

**Estado verificado 2026-10-13:** A0 y A1 PASS en perfil modular mononentidad; A2 en ejecución (CLI y React+PostgreSQL+Chromium comprobados), A3–A5 abiertos.  
**Objetivo:** obtener aplicaciones funcionales desde contratos TypeSpec, sin programar backend/SQL/React por entidad para las capacidades declaradas como soportadas. **Tokens ahorrados no son el criterio de éxito.**

## Orden de lectura para implementar

1. [00 — Requisitos de producto](00_PRODUCT_REQUIREMENTS.md) — qué debe hacer, límites, comportamiento y definición de éxito.
2. [01 — ADR-004: arquitectura](01_ARCHITECTURE_ADR.md) — TypeSpec, IR, adaptadores, JHipster-first y fallback.
3. [02 — Plan maestro A0–A5](02_IMPLEMENTATION_PLAN.md) — dependencias, entregables, tareas y cierre de etapas.
4. [03 — Matriz de aceptación](03_ACCEPTANCE_MATRIX.md) — pruebas HTTP/DB/auth/browser, portabilidad y casos negativos.
5. [04 — Runbook de ejecución](04_EXECUTION_RUNBOOK.md) — primera acción concreta, ramas, reportes y continuidad.

## Arquitectura y decisión vigentes

```text
Requerimientos → contratos TypeSpec + @protocolia/domain
   → IR semántico canónico y OpenAPI 3.1 oficial
   → adaptador modular Spring Boot 4.1.1/JDBC
   → PostgreSQL 16 (migración Flyway generada)
   → React/Vite declarativos, con capacidades desde backend
   → aplicación ejecutable
```

JHipster 9.4 fue ejecutado con Spring/React/PostgreSQL reales, pero no cumplió identidad pública, rutas especiales ni autorización contractual: **NO-GO** como motor principal. El IR se conservó y el fallback pasó HTTP, DB y Chromium con **dos contratos independientes** (Taller y Gauge). OpenAPI Generator 7.26 produce interfaces/DTO Java compilados; el controlador HTTP operativo es todavía el runtime semántico común, sin delegates tipados.

## Construir una aplicación desde contratos

Con Node 24, Java 21, Maven y las dependencias del repositorio instaladas (`npm ci`):

```bash
npm run app:build -- examples/vnext/taller --target modular-spring --out dist/taller
# Alternativa con el mismo motor:
npm run app:build -- examples/vnext/gauge --target modular-spring --out dist/gauge
```

La CLI realiza TypeSpec → IR → validación de capacidades → generación Spring/React → OpenAPI Generator 7.26 → compilación Maven y produce `protocolia-build.json` con hashes de origen. Rechaza sobrescribir directorios con archivos previos o generar dentro del árbol del contrato. No escribe código Java/SQL/React por entidad.

Cada proyecto generado incluye `Dockerfile`, `compose.yaml` y `.env.example`. Para un **ensayo local exclusivamente**:

```bash
cd dist/taller
cp .env.example .env
# Editar .env: contraseñas únicas y no vacías;
# activar PROTOCOLIA_ALLOW_DEMO_AUTH=true SOLO para la demo local
docker compose up --build
```

El puerto predeterminado sólo escucha en `127.0.0.1:8080` y PostgreSQL utiliza un volumen local. El comando Compose está preparado pero **no se ejecutó mediante docker compose en la evidencia remota**; la conformance HTTP/PostgreSQL/Chromium sí se ejecutó en contenedores aislados. Las credenciales no se distribuyen precargadas, y la autenticación Basic de prueba requiere opt-in. No usar este perfil públicamente ni considerarlo seguridad de producción.

## Estado por etapa

| Etapa | Estado | Evidencia |
| --- | --- | --- |
| A0 — Tecnología y contrato canónico | PASS acotado | [A0](evidence/A0.md), JHipster NO-GO contractual, fallback GO |
| A1 — Persistencia/operaciones/capacidades | PASS acotado | [A1](evidence/A1.md), migración Flyway + HTTP/DB/roles/atomicidad |
| A2 — CLI/UI/empaquetado | PARCIAL | Una CLI compila ambas apps; browser real prueba gestor y lector; Compose todavía no verificado en runtime |
| A3 — Segundo backend NestJS | NOT STARTED | Misma suite con contrato idéntico |
| A4 — Dos entidades y relaciones FK | NOT STARTED | Integridad y UI relacional |
| A5 — Regeneración/evolución segura | NOT STARTED | Migraciones V2, ownership y preservación |

**Límites actuales:** un recurso por aplicación, operaciones declaradas conocidas, sin OIDC/JWT de producción ni migraciones compatibles automáticas. Hay avisos npm por revisar antes de distribuir.

## Historial preservado

- [G0–G5, Books](../G5_CONTRACT_EVOLUTION_PROGRESS.md) — piloto completo dentro de su alcance, no general.
- [Taller manual](https://github.com/barbasmarcosi/ProtocolIA/blob/experiments/p5-taller-real-requirements-v1/experiments/taller-requirements-v1/EVIDENCE.md) — app real + PostgreSQL + Render, con dominio/UI manuales.
- [ROADMAP P0–P6](../ROADMAP.md) — track histórico y otros ámbitos de investigación.
- [Execution state](../EXECUTION_STATE.md) — estado global.
