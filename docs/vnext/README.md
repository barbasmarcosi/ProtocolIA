# ProtocolIA vNext — Documentación de implementación

**Estado verificado 2026-10-13:** A0 y A1 PASS en perfil modular mononentidad; A2 en ejecución (CLI y React+PostgreSQL+Chromium comprobados), A3 paridad NestJS/Spring y P-06 evolución aditiva PASS acotado; A5 Spring+Nest V1→V2 PASS aditivo; A4 relacional PASS acotado; A6 transiciones de estado PASS HTTP/PostgreSQL; A7 reserva, A8 cancelación/reintegro y A9 upgrade A7→A8 con filas persistidas + React Chromium PASS acotados en Spring+Nest con PostgreSQL real.  
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
# Lógica de negocio: draft -> approved -> closed sin código por entidad:
npm run app:build -- examples/vnext/work-orders --target nestjs --out dist/work-orders
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
| A2 — CLI/UI/empaquetado | PARCIAL | CLI compila Taller, Gauge y app multientidad; navegador/DB y conformance genérica PASS; Compose `config` PASS, arranque Compose sin Docker Engine sigue pendiente |
| A3 — Segundo backend NestJS | PASS funcional acotado | [A3](evidence/A3.md): Taller/Gauge+Equipment/Inspection HTTP/PG/Chromium; P-06 Nest V1→V2 aditivo verificado |
| A4 — Dos entidades y relaciones FK | PASS acotado | [A4](evidence/A4.md): 2 entidades/FK, selector React y evolución de contrato regenerada y ejecutada en DB nueva |
| A5 — Regeneración/evolución segura | PASS aditivo acotado Spring+Nest | [A5](evidence/A5.md): Flyway y migraciones Nest checksummed V1→V2 en DB poblada; baseline, ownership y datos preservados |

| A6 — Operaciones de negocio por contrato | PASS HTTP/PG acotado | [A6](evidence/A6.md): estado inicial + transiciones PostgreSQL atómicas, 10 carreras concurrentes por destino, React manifest generado; botones Chromium específicos pendientes |
| A7 — Reserva transaccional multi-entidad | PASS HTTP/PostgreSQL acotado | [A7](evidence/A7.md): stock debit+insert atómicos Spring/Nest, 7 éxitos+3 conflictos concurrentes, rollback de duplicados y conformance genérica; UI E2E específica pendiente |
| A8 — Cancelación/reintegro compensatorio | PASS PostgreSQL acotado Spring+Nest | [A8](evidence/A8.md): `@release` sobre `@transition` original, una sola devolución en 10 cancelaciones concurrentes, rechazo por overflow con rollback, reintento y conformance genérica; Chromium A8 específico pendiente |
| A9 — Migración A7→A8 y UI Chromium | PASS HTTP/PG/browser acotado Spring+Nest | [A9](evidence/A9.md): backfill V2 `active` sobre DB con reservas existentes, V1 intacta, DTO antiguo compatible, dos reinicios, diario Flyway/Nest y cancelación UI de registros históricos |
| A10 — Auditoría contractual de mutaciones | Código+41 unitarios PASS; PostgreSQL funcional en verificación | [A10](evidence/A10.md): `@audit` con campos permitidos en create/transitions, actor y before/after, journal transaccional Spring+Nest; rollback provocado mediante trigger PostgreSQL |
| A11 — Historial auditable HTTP/React | **PASS acotado Spring+Nest PostgreSQL/Chromium** | [A11](evidence/A11.md): nueva operación `auditPage` con capacidad independiente, paginación/404/400, reader 403 y pantalla historial React móvil; aún sin upgrade A10→A11 in-place |

**Límites actuales:** máximo 8 entidades por aplicación en el perfil probado, relaciones `restrict`, operaciones semánticas conocidas y transiciones de estado de cadena; sin OIDC/JWT de producción ni migraciones complejas automáticas. Hay avisos npm por revisar antes de distribuir.

## A6 — Estado y operaciones de negocio declarativas

El contrato `examples/vnext/work-orders/contracts/main.tsp` expresa una propiedad `@initial("draft")` y operaciones de transición como:

```typespec
@route("/api/work-orders/{code}/approve")
@post
@behavior("transition", "WorkOrder", "status")
@transition("draft", "approved")
@capability("orders.write")
op approveWorkOrder(@path code: string): WorkOrder | Conflict | NotFound | Unauthorized | Forbidden;
```

La fuente de verdad es TypeSpec → IR; ambos adaptadores emiten una actualización PostgreSQL condicionada por el estado original, con resultado HTTP 409 cuando la precondición falla. El frontend deriva botones desde el manifiesto `transitions[]`, sin lógica por nombre de entidad. El perfil actual es deliberadamente finito: cadenas de estado y guardas por igualdad; no orquesta flujos externos ni integra un proveedor IAM. [Evidencia A6](evidence/A6.md).

## A7 — Reservas atómicas entre entidades

El contrato `examples/vnext/inventory-reservations/contracts/main.tsp` describe stock y asignaciones, incluyendo `@reserve("Part", "available", "partSku", "units")` sobre la operación `create Allocation`. El mismo TypeSpec genera Spring Boot/JDBC o NestJS/`pg`, y ambos realizan una actualización de stock condicionada y la inserción de la reserva en **una única transacción**, con rollback y HTTP 409 si falta disponibilidad. El frontend compartido conserva el selector de relación y la creación de recursos; este ejemplo todavía no tiene prueba Chromium específica.

```bash
npm run app:build -- examples/vnext/inventory-reservations --target modular-spring --out dist/reservation-spring
npm run app:build -- examples/vnext/inventory-reservations --target nestjs --out dist/reservation-nest
```

[Resultados y limitaciones A7](evidence/A7.md): verificación con PostgreSQL real, rollback por duplicado, diez solicitudes concurrentes y conformance genérica sin hardcodes de dominio. El perfil todavía no contempla cancelar/restaurar stock, multi-línea ni flujos distribuidos.

## A8 — Cancelación transaccional y devolución única

`examples/vnext/inventory-reservations/contracts/main.tsp` vincula la creación con `@reserve("Part","available","partSku","units")` y una nueva ruta `cancelAllocation` con `@transition("active","cancelled")` y `@release("Part","available","partSku","units")`.

En ambos targets, una sola transacción cambia el estado de la reserva **solo si sigue activa** y devuelve las unidades al stock, con comprobación de overflow. Una segunda cancelación responde 409, no devuelve unidades. La precondición fallida revierte también el cambio de estado. Se rechazan las transiciones de vuelta al estado inicial o sin reserva original compatible. [Evidencia A8](evidence/A8.md).

**Importante:** el ejemplo A8 se prueba en bases nuevas. El campo de estado obligatorio añadido no es compatible con el perfil actual de migración aditiva A5; no afirmar que una aplicación A7 previamente desplegada pueda actualizarse in place sin una migración/backfill controlados.

## A9 — Evolucionar aplicaciones con reservas persistidas

El generador puede realizar un cambio **estrictamente acotado** desde el perfil A7 a A8 sobre una base PostgreSQL no vacía. Antes de aplicarlo, `app:plan` verifica que solamente se agrega un campo de estado inicial con `@initial` y una operación `@release` terminal asociada a un `@reserve` existente. Una versión V2 añade `status` con `DEFAULT 'active' NOT NULL` y CHECK; no se destruyen reservas ni se reescribe V1.

```bash
# Para una app creada originalmente desde inventory-reservations-v1:
npm run app:plan -- examples/vnext/inventory-reservations dist/inventory-app
npm run app:evolve -- examples/vnext/inventory-reservations dist/inventory-app
```

Los clientes A7 pueden seguir creando reservas sin enviar `status`; Spring y Nest aplican el estado inicial de forma segura. El flujo generado React permite cancelar y reintegrar el stock de registros históricos, verificado en Chromium a ancho móvil. Es una migración *forward-only*, no un esquema general de migraciones arbitrarias ni un procedimiento probado de despliegue sin downtime. **Hacer backup de una DB real antes de cualquier evolución.** [Evidencia A9](evidence/A9.md).

## A10 — Auditoría de operaciones de negocio

`@audit("campo1,campo2")` permite seleccionar de forma explícita campos de una operación `create`, o el estado auditado de una `transition`. ProtocolIA agrega un diario PostgreSQL que registra usuario autenticado, entidad, identificador, operación, campo, valor anterior/nuevo y momento de commit. En Spring y Nest la escritura ocurre dentro de la transacción de negocio: si no se puede escribir la auditoría, la operación falla y se revierte.

El ejemplo `examples/vnext/work-orders/contracts/main.tsp` lo ejerce sin crear servicios particulares por dominio. **Límites:** no se almacenan cuerpos completos por defecto; el autor debe evitar seleccionar secretos, no hay endpoint ni UI de consulta todavía y los administradores de base pueden alterar registros. [Evidencia A10](evidence/A10.md).

## A11 — Historial de cambios generado desde el contrato

Al definir `@behavior("auditPage", "Entidad") @capability("entidad.audit")` sobre una operación GET TypeSpec con ruta por identidad pública y consulta paginada, ProtocolIA genera una vista del diario de eventos ya declarado en A10. La operación se autoriza con un **permiso distinto** del usado para leer o modificar el recurso. Un lector convencional no ve el historial en React y recibe 403 al llamar directamente a su URL.

Spring y Nest devuelven un historial `{items,total,limit,offset}` con usuario, operación, campo, valor anterior/nuevo y fecha UTC. Ambas implementaciones filtran por entidad + clave, respetan límites, rechazan parámetros desconocidos y devuelven 404 para recursos inexistentes después de comprobar la autorización. React genera una tabla en el detalle del recurso a partir del manifiesto contractual, verificada en Chromium móvil con ambos backends.

**Evidencia:** [A11](evidence/A11.md). Perfil acotado: generación sobre base nueva, historial no criptográficamente inmutable, autenticación demo Basic, y sin garantías de evolución in-place A10→A11 todavía.

## A12 — Evolución del historial auditado sin reinicializar PostgreSQL

A partir de una aplicación A10 ya poblada, el comando `protocolia plan` permite declarar una **única lectura de auditoría nueva** desde TypeSpec (operación `auditPage`, con capacidad independiente). `protocolia evolve` conserva exactamente los contratos de escritura, las migraciones V1 existentes, los eventos auditados y las extensiones propias, mientras reemplaza el código generado y la interfaz con respaldo y sellado de integridad.

La evolución es **sin SQL nuevo**, porque A10 ya creó `protocolia_audit_event`; no es una migración de datos. El validador OpenAPI admite solamente los esquemas de respuesta alcanzables desde la nueva lectura, sin permitir cambios ocultos de los DTO existentes. La prueba de aceptación usa PostgreSQL persistente antes/después y Chrome móvil en Spring y NestJS. [Detalle y evidencia A12](evidence/A12.md). **Estado: en validación empírica.**

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

## Segundo destino NestJS — contratos idénticos, sin Java

Desde la misma raíz de ProtocolIA, con Node.js 24 y `npm ci`:

```bash
npm run app:build -- examples/vnext/taller --target nestjs --out dist/nest-taller
npm run app:build -- examples/vnext/gauge --target nestjs --out dist/nest-gauge
```

El target NestJS crea controladores Nest a partir de operaciones del IR, servidor de PostgreSQL con consultas parametrizadas, SQL DDL, verificación de huella de esquema al iniciar, la misma React/Vite generada, Compose local y snapshot del contrato/OpenAPI con ownership. **No exige Java ni Maven.** La conformance genérica detecta automáticamente dónde está el manifiesto según el backend. Contrato, IR y OpenAPI conservan hashes iguales al target Spring.

[Ver evidencia A3](evidence/A3.md) para HTTP, Postgres y Chromium ejecutados en ambos sistemas. **Límite:** `app:evolve` permite adiciones opcionales no destructivas sobre PostgreSQL poblada tanto en Spring (Flyway) como en Nest (migraciones SQL con checksum, transacción y advisory lock). Otros cambios se rechazan. La prueba real de `docker compose up` sigue pendiente en ambos destinos porque falta Docker Engine.
