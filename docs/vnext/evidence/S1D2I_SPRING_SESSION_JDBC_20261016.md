# S1d.2i — Persistencia JDBC del estado OAuth2/PKCE de Spring

**Fecha:** 16-10-2026 · **Resultado:** ACCEPTED — CI específica, Chromium con reinicio real, Quality y regresión independiente de Bomberos en ambos backends. Este incremento completa el **estado temporal de login**: no agrega refresh tokens ni logout federado.

## Problema resuelto

El BFF Spring S1d.2h guardaba la transacción Authorization Code + PKCE de Spring Security en una `HttpSession` local. Si el proceso se reiniciaba después de redirigir al IdP pero antes de recibir el callback, se perdían el estado y el verificador, y el usuario no podía completar el ingreso.

Desde S1d.2i, Spring Session JDBC guarda el estado temporal de login en **PostgreSQL**, con expiración de cinco minutos. Tras un reinicio, Spring Security puede resolver el mismo `state` y completar el callback conservando la cookie de sesión temporal. La prueba usa un IdP descartable real, un navegador Chromium y reinicia el contenedor de aplicación mientras persiste la base de datos.

## Implementación

- **Librería oficial:** `org.springframework.session:spring-session-jdbc`, administrada por Spring Boot 4.1.1.
- **Aislamiento:** `BffHttpSessionConfig.java` sólo se habilita con `PROTOCOLIA_BFF_ENABLED=true`, mediante `@EnableJdbcHttpSession(maxInactiveIntervalInSeconds=300)`. Se excluye la autoconfiguración general de Spring Session JDBC para mantener los modos demo/JWT existentes sin crear automáticamente sesiones HTTP.
- **Migración versionada:** `V2__protocolia_bff_http_session.sql` es producida por el generador modular Spring y registrada por Flyway. Crea `SPRING_SESSION`, `SPRING_SESSION_ATTRIBUTES` e índices de expiración, así como la tabla persistente de sesiones BFF cifradas. La creación de tablas se eliminó del constructor Java: Flyway es ahora el responsable del esquema.
- **Separación de almacenes:** las transacciones temporales OAuth2 usan Spring Session JDBC y cookie HttpOnly `SESSION`; las sesiones BFF posteriores continúan como identificadores opacos asociados a payload AES-256-GCM en `protocolia_bff_sessions`.
- **Generación real:** se modificaron exclusivamente plantillas, generador y prueba de integración; no hubo arreglos particulares en las aplicaciones generadas.

## Evidencia reproducible

- **Commit de código integrado:** [51b237dd57519b476e3d58fd23cdc7d61a8bfdc8](https://github.com/barbasmarcosi/ProtocolIA/commit/51b237dd57519b476e3d58fd23cdc7d61a8bfdc8).
- [Conformance Spring Session JDBC #38947044423](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38947044423): **SUCCESS.** Generación TypeSpec→Spring Boot+React, regresión demo Basic, JWT RS256/JWKS, OAuth2 público anterior y BFF en Chromium. La prueba detiene el salto al proveedor después de emitir la cookie temporal, **verifica filas en `SPRING_SESSION`**, reinicia el contenedor Spring con PostgreSQL intacto y retoma el callback OIDC. Comprueba PKCE, cookie HttpOnly, CSRF, no bearer en JavaScript, creación real, restauración tras recarga y logout.
- [Quality de rama #38947044691](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38947044691): **SUCCESS**.
- [Bomberos independiente #38947453390](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38947453390): **SUCCESS** — NestJS y Spring Boot autogenerados, PostgreSQL/HTTP y oráculo independiente de Chromium en NestJS.
- [Quality integrada #38947453589](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38947453589): **SUCCESS** en todas sus variantes, incluidas Python 3.11 y 3.13.
- La primera CI aislada (#38946607306) falló al buscar la cookie servlet `JSESSIONID`; Spring Session utiliza la cookie `SESSION`. Se corrigió esa aserción en el ensayo sin debilitar la comprobación de persistencia: sigue requiriendo fila en PostgreSQL y continuidad del callback tras el reinicio.
- Fast-forward a `independent/volunteer-evaluations` con comparación de ascendencia y `expected_sha=e50fc3ad369af3d78d089119e0f9f8f1b8b4f360`. `main`, PR #52 y Railway/Neon existentes no se tocaron.

## Riesgos pendientes

1. El ensayo valida **reinicio de una instancia**, compartiendo PostgreSQL, no una prueba exhaustiva de dos instancias activas y balanceador con fallas simultáneas.
2. Los atributos de `SPRING_SESSION_ATTRIBUTES` incluyen material sensible del flujo transitorio (estado PKCE y posiblemente datos OAuth2 temporales). Deben protegerse mediante permisos de base de datos, cifrado en reposo, backups protegidos y políticas de retención; **no** se afirma que estén cifrados por AES-256-GCM del BFF principal.
3. Siguen pendientes limpieza coordinada de filas expiradas de `protocolia_bff_sessions`, rotación de claves del cifrado, configuración explícita de cookies temporales en entornos con reverse proxy, política CSP y pruebas de multirréplica bajo carga.
4. No se implementaron refresh token rotation, token introspection, revocación ante el IdP ni logout federado. El proyecto aún no puede declararse productivo universal.

## Siguiente incremento recomendado

**S1d.2i.2:** housekeeping y hardening comunes a NestJS/Spring: borrar de manera acotada y concurrente sesiones BFF vencidas; índices y métricas útiles; encabezados CSP y protección de los endpoints; test adversarial contra sesiones expiradas y diferencias proxy/origin.
