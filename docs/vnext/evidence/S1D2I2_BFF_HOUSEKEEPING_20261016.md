# S1d.2i.2 — Limpieza y controles de seguridad de sesiones BFF en NestJS y Spring

**Fecha:** 16 de octubre de 2026. **Estado:** ACCEPTED, pruebas específicas y regresión independiente completadas. Este incremento se limita a housekeeping y protección complementaria de los BFF generados; no equivale a homologación productiva integral.

## Problema resuelto

En los incrementos S1d.2g–i se generaron sesiones BFF seguras, cifradas en PostgreSQL y con expiración validada en cada acceso, pero las filas ya vencidas permanecían en `protocolia_bff_sessions` de manera indefinida. Había además oportunidad de rechazar intentos de escritura marcados explícitamente como `cross-site` por el navegador y de aplicar encabezados defensivos a los endpoints BFF.

## Implementación compartida en los dos generadores

- **Limpieza automática y optativa:** exclusivamente cuando `PROTOCOLIA_BFF_ENABLED=true`. `PROTOCOLIA_BFF_CLEANUP_INTERVAL_MS` permite 1000 a 3600000 ms (valor por defecto: `300000`, cinco minutos); valores inválidos detienen el inicio.
- **SQL concurrente y acotado:** cada iteración elimina como máximo **200** filas vencidas. La selección `WHERE expires_at<now()`, `ORDER BY expires_at`, `LIMIT 200 FOR UPDATE SKIP LOCKED` y la sentencia `DELETE ... USING` forman una transacción atómica por ejecución. Varias réplicas pueden competir sin tomar el mismo bloqueo; la selección no afecta sesiones futuras.
- **PostgreSQL indexado:** Spring ya disponía del índice `protocolia_bff_expiration_idx` en la migración Flyway V2. NestJS crea el mismo índice de manera idempotente cuando se activa BFF.
- **Programación de tareas:** NestJS ejecuta al iniciar y mediante `setInterval(...).unref()`, registrando los fallos y sin detener el servidor. Spring Boot emplea `@Scheduled` y `@EnableScheduling` únicamente en la configuración condicional de BFF, sin requerir cron externo.
- **Controles en solicitudes:** escrituras y logout mantienen el token CSRF de sesión y la validación de `Origin`; ahora también rechazan `Sec-Fetch-Site: cross-site` aunque el cliente omita `Origin`. El header es una defensa adicional, no sustituto de CSRF.
- **Cabeceras:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y directivas CSP `base-uri 'none'; object-src 'none'; frame-ancestors 'none'`. Son **directivas CSP parciales**, no una política restrictiva completa de `default-src`/`script-src` contra XSS; en Nest se aplican al prefijo `/api` y en Spring a respuestas de BFF/API que recorren el runtime pertinente.
- **Sin parches por aplicación:** se modificaron sólo las plantillas compartidas, generadores, entornos de Compose y pruebas; ningún contrato TypeSpec ni aplicación funcional existente fue reescrito manualmente.

## Evidencia reproducible

- **Commit funcional integrado:** [633068032c119d8b235813a434116fee43e523e3](https://github.com/barbasmarcosi/ProtocolIA/commit/633068032c119d8b235813a434116fee43e523e3).
- [Conformance matriz S1d.2i.2 #38948974323](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38948974323): **SUCCESS** tanto `nestjs` como `modular-spring`. Cada generación TypeSpec→backend+React prueba demo Basic, JWT RS256/JWKS, OAuth público con Chromium, OAuth BFF con Chromium/IdP de pruebas, y SQL PostgreSQL con una sesión expirada y otra futura artificiales. El worker elimina la expirada, preserva la futura y la sesión BFF real sigue autenticada. También comprueba CSRF ausente, origen falso, Fetch Metadata cross-site y headers en `/api/_protocolia/bff/session`, más creación de datos y logout con revocación local.
- [Quality de implementación #38948973857](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38948973857): **SUCCESS**.
- [Bomberos independiente en integración #38949434259](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38949434259): **SUCCESS** en NestJS y Spring Boot generados, PostgreSQL, HTTP y Chromium independiente sobre NestJS.
- [Quality integrada #38949434133](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38949434133): **SUCCESS** en todos sus jobs, incluyendo Python 3.11/3.13.
- Fast-forward protegido a `independent/volunteer-evaluations` desde `9acfce3f7932dbec6e6dfff11b34156296556b12`. `main`, PR #52 y los servicios persistentes Railway/Neon permanecieron sin cambios.

## Limitaciones conocidas y siguientes tareas

1. Una iteración limpia máximo 200 filas; una acumulación mayor se evacúa en ejecuciones sucesivas, no en una transacción sin límites. La prueba valida eliminación/preservación de filas y sesión en el navegador; **no** demuestra todavía rendimiento bajo millones de filas ni dos réplicas simultáneas en un entorno productivo.
2. Spring Session JDBC posee su propio ciclo de vida para las transacciones OAuth temporales; esta nueva rutina limpia **solamente** `protocolia_bff_sessions`.
3. La CSP agregada es deliberadamente compatible y **parcial**. Siguen pendientes CSP fuerte basada en los recursos reales generados, protección integral contra XSS, proxy/TLS/HSTS y revocación global en el proveedor.
4. No se agregaron refresh tokens ni rotación de claves AES; el vencimiento actual continúa siendo estricto y el logout revoca sólo la sesión local.
5. La limpieza se habilita automáticamente en BFF; su intervalo bajo `2000` ms se utilizó únicamente en el entorno descartable de conformance. El default operativo es cinco minutos.

**Siguiente prioridad:** S1d.2i.3, pruebas de cookies HTTPS detrás de proxy inverso, `Sec-Fetch-Site` y CSP completa con regresiones visuales; después evaluar expiración de credenciales, rotación y logout federado mediante librerías mantenidas.
