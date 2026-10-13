# P5 — Taller de herramientas: evidencia de una prueba independiente

**Estado:** demo funcional verificada; **no** es un generador genérico ni un lanzamiento productivo.
**Fecha:** 2026-10-13 UTC.
**Fuente ejecutable ensayada:** `6481d3ef052979cc478c42a52b6cc2ccf4d4c2fe`.
**Render Free:** service `srv-db6r17ou01pc73b8grf0`, deploy `dep-db6r542j9qps73a78rn0`, estado **LIVE**.
**[Abrir aplicación](https://protocolia-taller-v1-20261013.onrender.com)**.
**Rama:** `experiments/p5-taller-real-requirements-v1`. `main` y candidatos congelados P4 intactos.

## Requerimientos fijados

Administración de herramientas con código obligatorio/único, nombre obligatorio,
existencias enteras >= 0 y fecha de última revisión opcional/nula. Registrar,
consultar por código, listar con paginación, incrementar existencias de forma
atómica, renombrar y separar lectura/escritura. PostgreSQL inicializa cuatro
herramientas reales mediante migración Flyway.

## Origen real de cada pieza

| Pieza | Generación / responsabilidad |
| --- | --- |
| `contract.json`, `resources.json`, `http-errors.json` | **Manual**: 223 + 70 + 15 líneas de contratos y reglas |
| OpenAPI 3.1, JSON Schema 2020-12, capabilities y UI manifests | **ProtocolIA `compile-bundle`** |
| Interfaz Java y modelos DTO | **OpenAPI Generator 7.26.0**, repetido con diff cero |
| Hooks/cliente TS | **Orval 8.41.0**, generados del OpenAPI |
| Formularios y listas | Validaciones/esquemas RJSF desde contrato; **React visual y adaptadores manuales** reutilizados desde G5 |
| Reglas, transacciones, SQL y migraciones | **Human-owned** Java/JDBC + Flyway; no son generación automática |
| Seguridad HTTP Basic y permisos | **Manual** con capacidades declaradas en el contrato |
| Docker/Render, PostgreSQL single-container | **Manual** |

**Importante:** en este experimento se ejecutó la secuencia
`compile-bundle` + OpenAPI Generator + Orval en Docker, **no**
el comando integrado `regenerate-fullstack` cerrado en G5.

## Resultados comprobados

- `TALLER_CANONICAL_COMPILER_DETERMINISTIC`: dos bundles idénticos.
- `TALLER_JAVA_CODEGEN_REPRODUCIBLE`: dos generaciones Java idénticas.
- `TALLER_CONTRACT_CAPABILITIES_PASS`: operaciones, rutas de capacidad e invalidaciones verificadas.
- `TALLER_ORVAL_RJSF_TYPESCRIPT_BUILD_SUCCESS`: npm ci, Orval, TypeScript y Vite.
- `TALLER_SPRING_GENERATED_DOMAIN_BUILD_SUCCESS`: Java 21, Spring Boot 4.1.1, Maven.
- `TALLER_REAL_HTTP_POSTGRES_AUTH_SMOKE_PASS`: aplicación ejecutada con
  PostgreSQL 16.10 real en contenedor descartable. Se comprobaron
  códigos HTTP **200, 201, 400, 401, 403, 404, 409**, alta, búsqueda,
  listado, duplicados, fechas, validación, modificación de nombre,
  lector sin escritura y **10 incrementos concurrentes** que pasaron
  de 2 a 12 unidades sin perder actualizaciones.
- Render reportó la imagen final **LIVE**, incluyendo el certificado del smoke
  obligatorio. Un servicio externo recuperó la página de login React y
  `/health` **`{"status":"UP"}`** desde la URL pública.
- **No se hizo en esta sesión un browser E2E remoto autenticado**; el login
  de la instancia pública se configuró mediante variables en Render.
  Las contraseñas no se agregaron al repositorio.

## Fallos reales y reparaciones

1. La adaptación mecánica React convirtió `View.title` en `View.name`
   y `restock` en `requantity`, impidiendo compilar. Se corrigió.
2. Una clase de dominio `final` con `@Transactional` no permitía el
   proxy CGLIB. Se quitó `final`; el backend inició con Flyway.
3. Un test de HTML enviaba `Accept: application/json` a `/`, causando
   406 Not Acceptable. Se corrigió el test y se dejó la política de
   permisos fail-closed.
4. Docker BuildKit intentaba recorrer un directorio temporal de Tomcat
   desaparecido al copiar un marcador en `/tmp`. Se movió el marcador
   a `/app`, y la imagen pudo empaquetarse.

Render Free tardó más de un minuto en iniciar Spring, aunque el build
smoke tardó aproximadamente 7 s. Los datos son efímeros y pueden
reiniciarse. Solo usar datos de prueba.

## Resultado para la estrategia ProtocolIA

La rama difiere de `main` en **29 archivos nuevos y 5.527 líneas**
antes de este informe; **4.257 son el lockfile npm reutilizado**.
Las piezas Java/TS generadas no se versionan: se producen en el build.
Hay una cantidad significativa de código propio: dominio, SQL, permisos,
frontend, Docker y tests. Esta evidencia demuestra **viabilidad en un
recurso distinto de Books**, pero **no demuestra todavía ahorro de tiempo,
tokens o trabajo** respecto de construirlo directamente con las mismas
herramientas sin ProtocolIA. Esta conclusión se reserva a un experimento
comparativo controlado.

No se utilizaron APIs pagas de modelos ni minutos de GitHub Actions.
