# ProtocolIA vNext — Documentación de implementación

**Estado verificado 2026-10-13:** A0 y A1 PASS en perfil modular mononentidad; A2 en ejecución (CLI y React+PostgreSQL+Chromium comprobados), A3 pendiente; A5 evolución aditiva PASS acotado; A4 relacional PASS acotado (E-01..E-08 sobre base nueva).  
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
# Entidades relacionadas, clave foránea restrict y selector React:
npm run app:build -- examples/vnext/equipment-inspections --target modular-spring --out dist/relations
```

La CLI realiza TypeSpec → IR → validación de capacidades → generación Spring/React → OpenAPI Generator 7.26 → compilación Maven y produce `protocolia-build.json` con hashes de origen. Rechaza sobrescribir directorios con archivos previos o generar dentro del árbol del contrato. No escribe código Java/SQL/React por entidad.

Cada proyecto generado incluye `Dockerfile`, `compose.yaml` y `.env.example`.

### Ejecutar o verificar el proyecto generado

Después de `app:build`, desde la raíz del repositorio:

```bash
# Levanta la app del usuario usando el .env del proyecto generado.
npm run app:run -- dist/taller

# Ensayo aislado: DB/credenciales/puerto efímeros y limpieza al salir.
npm run app:test -- dist/taller
```

`app:test` necesita Docker Engine y Docker Compose disponibles. Crea un proyecto Compose aleatorio independiente, guarda contraseñas temporales en un archivo privado del directorio temporal del sistema, comprueba `/health`, ejecuta una suite HTTP derivada del manifiesto del contrato (CRUD, identidad natural, 401/403, concurrencia y borrado cuando exista) y ejecuta `compose down --volumes` sobre **ese proyecto de prueba**, incluso ante fallos. Rechaza una URL remota para conformance y no usa los datos persistentes de `app:run`.

**Verificación real en Render:** el mismo ensayo HTTP genérico pasó con Taller y Gauge, y Docker Compose v2.39.4 validó la sintaxis de los dos `compose.yaml` generados; esto **no** demuestra `docker compose up` porque el build aislado no ofrece Docker Engine anidado. El propio `app:test` completo todavía requiere ejecutarse donde haya un daemon Docker.

Para un **ensayo local exclusivamente**:

```bash
cd dist/taller
cp .env.example .env
# Editar .env: contraseñas únicas y no vacías;
# activar PROTOCOLIA_ALLOW_DEMO_AUTH=true SOLO para la demo local
docker compose up --build
```

El puerto predeterminado sólo escucha en `127.0.0.1:8080` y PostgreSQL utiliza un volumen local. El comando Compose fue validado con `config --quiet`, pero **no se ejecutó mediante `docker compose up` en la evidencia remota**; la conformance HTTP/PostgreSQL/Chromium sí se ejecutó en contenedores aislados. Las credenciales no se distribuyen precargadas, y la autenticación Basic de prueba requiere opt-in. No usar este perfil públicamente ni considerarlo seguridad de producción.

## Estado por etapa

| Etapa | Estado | Evidencia |
| --- | --- | --- |
| A0 — Tecnología y contrato canónico | PASS acotado | [A0](evidence/A0.md), JHipster NO-GO contractual, fallback GO |
| A1 — Persistencia/operaciones/capacidades | PASS acotado | [A1](evidence/A1.md), migración Flyway + HTTP/DB/roles/atomicidad |
| A2 — CLI/UI/empaquetado | PARCIAL | Una CLI compila ambas apps; browser real prueba gestor y lector; Compose todavía no verificado en runtime |
| A3 — Segundo backend NestJS | NOT STARTED | Misma suite con contrato idéntico |
| A4 — Dos entidades y relaciones FK | PASS acotado | [A4](evidence/A4.md): 2 entidades/FK, selector React y evolución de contrato regenerada y ejecutada en DB nueva |
| A5 — Regeneración/evolución segura | PASS núcleo aditivo acotado | [A5](evidence/A5.md): Flyway V1→V2 sobre DB poblada, ownership y extensiones preservados; API drift/checks adicionales en verificación |

**Límites actuales:** un recurso por aplicación, operaciones declaradas conocidas, sin OIDC/JWT de producción ni migraciones compatibles automáticas. Hay avisos npm por revisar antes de distribuir.

## Historial preservado

- [G0–G5, Books](../G5_CONTRACT_EVOLUTION_PROGRESS.md) — piloto completo dentro de su alcance, no general.
- [Taller manual](https://github.com/barbasmarcosi/ProtocolIA/blob/experiments/p5-taller-real-requirements-v1/experiments/taller-requirements-v1/EVIDENCE.md) — app real + PostgreSQL + Render, con dominio/UI manuales.
- [ROADMAP P0–P6](../ROADMAP.md) — track histórico y otros ámbitos de investigación.
- [Execution state](../EXECUTION_STATE.md) — estado global.

## Evolucionar una aplicación generada (A5, perfil seguro acotado)

La primera compilación de `app:build` crea `protocolia-contract-ir.json`, `protocolia-contract-openapi.json` y `protocolia-ownership.json` dentro del output. Esto permite detectar cambios en los archivos gestionados antes de intentar reemplazarlos. Los archivos de personalización deben mantenerse **exclusivamente** en `extensions/`; la configuración local se conserva en `.env`.

```bash
# Inicialmente, contrato v1:
npm run app:build -- examples/vnext/equipment-inspections --target modular-spring --out dist/relations

# Una vez editado el TypeSpec (por ejemplo, nuevo campo opcional nullable):
npm run app:plan -- examples/vnext/equipment-inspections dist/relations
npm run app:evolve -- examples/vnext/equipment-inspections dist/relations
```

`plan` devuelve cambios y blockers sin tocar la base de datos. `evolve` rechaza campos eliminados, tipos/identidades alterados y cambios de rutas/permisos; genera en staging, restaura las migraciones V1/V2 previas, añade una migración nueva por columnas opcionales compatibles y empaqueta nuevamente el JAR. Tras la sustitución conserva una copia del proyecto anterior en `.protocolia-backup-...`. **La migración SQL se aplica al siguiente inicio de la aplicación, no durante `evolve`.**

El ensayo [A5](evidence/A5.md) conservó las filas originales y comprobó Flyway V1→V2 en PostgreSQL real. Este mecanismo **no es un respaldo de base de datos, una herramienta de rollback SQL ni un generador de migraciones destructivas**. Antes de apuntarlo a una DB persistente importante, hacer backup externo y validar las migraciones en un clon. Las aplicaciones construidas por versiones anteriores sin sello de ownership requieren una nueva compilación limpia desde sus contratos; no se adoptan automáticamente.
