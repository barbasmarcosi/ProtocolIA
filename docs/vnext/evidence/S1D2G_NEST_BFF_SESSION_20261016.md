# S1d.2g — Primer BFF de sesión segura generado para NestJS

**Fecha:** 16 de octubre de 2026. **Resultado:** ACCEPTED, perfil BFF optativo **sólo para NestJS**. Se validó con un proveedor OIDC descartable y con pruebas independientes sobre aplicaciones generadas. No es aún una solución OIDC universal ni un despliegue productivo.

## Objetivo y frontera de confianza

En el modo público SPA anterior, React retenía el access token en memoria. En el nuevo perfil BFF, el código del navegador **no recibe ni almacena access tokens o ID Tokens**: el backend realiza el canje OAuth2 Authorization Code + PKCE, valida criptográficamente la identidad OIDC y almacena el token en una sesión cifrada del servidor.

La activación es **optativa** y exige:

- `PROTOCOLIA_AUTH_MODE=jwt`
- `PROTOCOLIA_OIDC_DISCOVERY_REQUIRED=true`
- `PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED=true`
- `PROTOCOLIA_BFF_ENABLED=true`
- `PROTOCOLIA_BFF_ENCRYPTION_KEY`: 32 bytes hexadecimales (64 caracteres).
- `PROTOCOLIA_OIDC_BFF_REDIRECT_URI`: callback registrado en el proveedor, terminado en `/api/_protocolia/bff/callback`.
- Issuer, JWKS, endpoints OIDC, client ID y scope del proveedor configurados como en S1d.2e–f.

**Atención:** `PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true` es sólo para los ensayos descartables en HTTP. No habilitarlo en producción.

## Implementación

1. **Inicio y callback en el servidor:** `GET /api/_protocolia/bff/login` crea state, nonce y verifier criptográficamente aleatorios. Los conserva cifrados con AES-256-GCM en una cookie de transacción HttpOnly con vigencia de cinco minutos. El callback verifica state e issuer y canjea el código desde Node, sin exponer el verifier al frontend.
2. **Identidad verificada:** JOSE comprueba firma RS256, issuer, audiencia, sujeto, nonce, vencimiento, fecha de emisión, `azp` y `at_hash` cuando está presente. El access token, por separado, se valida contra issuer, audience y permisos del servidor de recursos. La identidad no crea permisos nuevos.
3. **Sesión persistente:** se emite un identificador opaco aleatorio de 256 bits; PostgreSQL almacena sólo su hash SHA-256 y un payload de sesión cifrado mediante AES-256-GCM. La expiración queda acotada por ambos tokens y un máximo de veinte minutos; no hay extensión silenciosa ni refresh.
4. **Cookie segura:** `HttpOnly`, `SameSite=Lax`, `Path=/` y, fuera del HTTP de pruebas, `Secure` y prefijo `__Host-`. En modo BFF se rechazan los headers Authorization enviados por clientes; el backend inserta internamente un bearer firmado sólo después de validar la cookie.
5. **CSRF:** el backend exige `X-ProtocolIA-CSRF` ligado a la sesión en operaciones de escritura y logout, y rechaza orígenes declarados diferentes. React sólo retiene el token CSRF —nunca credenciales OAuth— en memoria.
6. **Restauración y cierre:** `GET /api/_protocolia/bff/session` permite restaurar capacidades y CSRF después de una recarga. `POST /api/_protocolia/bff/logout` revoca el registro de sesión en PostgreSQL, borra la cookie y rechaza los usos posteriores.

La implementación es generada automáticamente: `packages/adapters/nest/templates/BffSession.ts`, integración en `main.ts`, adaptación del generador y cambios compartidos de React. Spring Boot mantiene el perfil SPA/JWT y **no** admite el BFF NestJS.

## Evidencia de aceptación

- **Commit funcional verificado:** [94df997b2ecbd83235a2f3e23578ff8d0a50e721](https://github.com/barbasmarcosi/ProtocolIA/commit/94df997b2ecbd83235a2f3e23578ff8d0a50e721).
- **[S1d.2g CI #38939553002](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38939553002): SUCCESS.** Generó NestJS+React desde TypeSpec, probó Basic demo, JWT RS256/JWKS, OAuth SPA preexistente, y nuevo flujo BFF en Chromium con PostgreSQL, sesión HttpOnly, CSRF sin/sobre origen, ausencia de credenciales en JavaScript, bearer directo rechazado, creación funcional, restauración después de recargar, logout y callback falsificado rechazado.
- **[Quality de la rama #38939552869](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38939552869): SUCCESS.**
- **[Regresión independiente Bomberos #38939940882](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38939940882): SUCCESS.** NestJS y Spring Boot, PostgreSQL/HTTP; prueba independiente en Chromium sobre NestJS.
- **[Quality integrada #38939940871](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38939940871): SUCCESS.**
- Integración de código por fast-forward protegido en `independent/volunteer-evaluations`, desde `d2f98a256e27896ef751dd9136d5d952cba8c4f6`. `main`, PR #52 y los despliegues Railway/Neon persistentes no se modificaron.

## Límites y riesgos para producción

- **NestJS únicamente** en este incremento; próxima prioridad es la paridad BFF Spring Boot aprovechando Spring Security OAuth2 Client.
- No hay refresh token rotation, expiración deslizante, revocación ante el proveedor ni logout federado. El logout actual revoca la sesión **local** de la aplicación.
- Se requiere una clave AES-256-GCM secreta estable y gestionada fuera del repositorio, HTTPS real, respaldos adecuados, un proceso de rotación de claves, y limpieza programada de sesiones expiradas.
- Los ataques XSS aún pueden realizar acciones mientras se ejecutan dentro del origen válido, aunque ya no pueden leer el access token guardado en el servidor. Continuar con CSP y endurecimiento de respuestas HTTP.
- La implementación incluye ensayos contra un proveedor OIDC descartable, **no** aún homologación con un proveedor comercial o corporativo real, múltiples instancias y failover ni pruebas de carga.
- El cliente BFF no soporta por ahora access tokens opacos ni mapeos arbitrarios de claims. Requiere los JWT y capacidades que reconoce el runtime ProtocolIA.

## Siguientes pasos

S1d.2h: paridad BFF en Spring usando bibliotecas maduras (OAuth2 Client/Security), consolidación del contrato de sesión entre backends, rotación/revocación de refresh si el proveedor lo soporta, hardening CSP/CSRF y pruebas multiinstancia. No fusionar automáticamente `main` ni modificar los despliegues actuales.
