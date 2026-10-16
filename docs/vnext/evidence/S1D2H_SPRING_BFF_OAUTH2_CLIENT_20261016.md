# S1d.2h — Spring Security OAuth2 Client BFF, sesión HttpOnly y paridad de frontend

**Fecha:** 16 de octubre de 2026. **Estado:** ACCEPTED, validación completa en CI y regresión independiente. Perfil optativo de Spring Boot 4.1.1; no es todavía una solución OIDC productiva universal.

## Implementación automática del generador

1. **Cliente OIDC con biblioteca mantenida.** En Spring se agregó `spring-boot-starter-oauth2-client`, con `ClientRegistrationRepository` configurado desde el issuer, authorization endpoint, token endpoint, JWKS URI y client ID que el operador fijó. El proveedor se valida previamente por S1d.2e; Spring Security realiza Authorization Code, state, PKCE S256, validación del ID Token OIDC y nonce. Una validación adicional exige un único `iss` en callback con coincidencia exacta.
2. **Contratos TypeSpec intactos.** `BffSession.java` es una plantilla del generador modular Spring. No se parcheó ninguna aplicación generada. El frontend compartido utiliza el mismo modo de sesión `bff` que NestJS.
3. **OAuth en servidor y separación de credenciales.** El access token no sale al navegador. El éxito del login recupera el authorized client de Spring Security, comprueba el sujeto del ID Token contra el JWT de acceso validado por el resource server y `at_hash` si viene presente; después elimina el authorized client y destruye la sesión de login temporal.
4. **Sesión persistente.** Se genera un session ID opaco aleatorio de 256 bits; sólo su SHA-256 se guarda en PostgreSQL. El access token y el token CSRF se guardan en un payload cifrado con AES-256-GCM, mediante una clave de 32 bytes administrada fuera del repositorio. La duración está acotada por el vencimiento de los tokens y por 20 minutos.
5. **Cookies y protección CSRF.** La cookie BFF usa `HttpOnly`, `SameSite=Lax`, `Path=/` y en HTTPS `Secure` con prefijo `__Host-`. En tests HTTP exclusivamente, la cookie se llama `pia_bff_dev`. Operaciones mutantes y logout requieren un header CSRF ligado a la sesión; se rechazan orígenes distintos del origen configurado. Las solicitudes a APIs en modo BFF no aceptan bearer del cliente: el filtro del backend obtiene y valida el token del almacén antes de presentar al resource server el JWT correspondiente.
6. **Sesión y logout.** `GET /api/_protocolia/bff/session` devuelve autenticación, capacidades y token CSRF, pero jamás el access token. `POST /api/_protocolia/bff/logout` elimina la sesión PostgreSQL, expira la cookie y rechaza usos posteriores. Los permisos de dominio siguen dependiendo de JWT validado y capacidades permitidas por el contrato, no del ID Token.

## Corrección adicional en el generador de UX

Después de crear un registro exitosamente, React cierra el modal de alta, limpia el estado de descarte y restituye la interacción con la pantalla de listado. El problema se detectó mediante la regresión Chromium del modo OAuth público en Spring; se corrigió en la plantilla React compartida con NestJS.

## Evidencia real

- **Commit funcional integrado:** [1afc42bc686baf6c3c7d529097f0e85b4947c164](https://github.com/barbasmarcosi/ProtocolIA/commit/1afc42bc686baf6c3c7d529097f0e85b4947c164).
- [S1d.2h — Spring OAuth2 Client, BFF, Chromium #38943226164](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38943226164): **SUCCESS**. TypeSpec → Spring Boot + React, regresión Basic, JWT, OAuth público, BFF OIDC con PostgreSQL y Chromium, cookie HttpOnly, ausencia de bearer en navegador, CSRF, validación de origen, creación de registro real, restauración después de recarga, logout/revocación y callback falsificado rechazado.
- [Quality de implementación #38943226211](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38943226211): **SUCCESS**.
- [Bomberos — regresión independiente de integración #38943672775](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38943672775): **SUCCESS**. NestJS y Spring Boot generados desde contrato independiente, PostgreSQL, HTTP real y oráculo independiente en Chromium contra NestJS.
- [Quality integrada #38943672614](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38943672614): **SUCCESS** (Python 3.11 y 3.13 y conformance restantes).
- Durante la ejecución se corrigió el proveedor OIDC de tests para aceptar `state` Base64URL con relleno generado por Spring, se admitieron respuestas de callback inválido `4xx` equivalentes y se detectó/corrigió el modal de creación que no se cerraba. Las pruebas finales se repitieron en verde.
- El código se integró por fast-forward protegido a `independent/volunteer-evaluations` con `expected_sha=0f64a442f68b50cf932887556e991f8890f5a7b6`. Ni `main`, ni el PR #52, ni Railway/Neon persistentes se modificaron.

## Requisitos operativos y límites

- Habilitar explícitamente `PROTOCOLIA_BFF_ENABLED=true`, `PROTOCOLIA_OIDC_DISCOVERY_REQUIRED=true`, `PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED=true`, `PROTOCOLIA_AUTH_MODE=jwt`, `PROTOCOLIA_BFF_ENCRYPTION_KEY` (64 caracteres hex) y registrar `PROTOCOLIA_OIDC_BFF_REDIRECT_URI` terminado en `/api/_protocolia/bff/callback`. Mantener el issuer, JWKS y endpoints de confianza correspondientes.
- `PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true` sólo está permitido para las pruebas descartables. Producción requiere HTTPS real, seguridad del manejo de secretos, respaldo y permisos estrictos en PostgreSQL, límites de memoria y monitoreo.
- El estado transitorio `JSESSIONID` de Spring Security durante el intercambio OAuth vive en memoria de la instancia. **No se ha validado failover de login entre instancias**; requiere Spring Session JDBC o afinidad hasta completar el callback. Las sesiones BFF ya se guardan en PostgreSQL.
- No existen refresh automático, rotación de claves AES, revocación federada, logout centralizado del proveedor, política completa de CSP/XSS ni limpieza periódica de sesiones expiradas.
- Las pruebas usan un IdP descartable controlado, no un proveedor corporativo externo. No declarar conformidad universal con accesos opacos ni mapeos arbitrarios de claims.

## Siguiente prioridad

S1d.2i: reforzar operación productiva y paridad de sesiones: persistencia del state/login PKCE de Spring entre instancias, rotación y vencimiento de claves, expiración y limpieza de sesiones, cabeceras CSP/CSRF, refresh y revocación si el proveedor las soporta, además de un piloto controlado de IdP real. Mantener los contratos y las pruebas independientes como autoridad.
