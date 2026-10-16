# S1d.2b/c — JWT firmado + OAuth2 Authorization Code/PKCE en sistemas generados

**Fecha:** 16 de octubre de 2026. **Estado:** PASS de generación real, PostgreSQL y oráculos independientes con NestJS y Spring Boot. No es aún cierre productivo de identidad.

## Contrato y arquitectura

Los dos generadores traducen el mismo TypeSpec a backend con una frontera entre:

- **Autenticación demo:** `PROTOCOLIA_AUTH_MODE=demo` + `PROTOCOLIA_ALLOW_DEMO_AUTH=true`, cuentas de prueba Basic y capacidades del manifiesto.
- **Servidor de recursos:** `PROTOCOLIA_AUTH_MODE=jwt`, Basic demo prohibido, `PROTOCOLIA_JWT_ISSUER`, `PROTOCOLIA_JWT_AUDIENCE`, `PROTOCOLIA_JWT_JWKS_URI`. Firma RS256 con JWKS externo confiable, `iss`, `aud`, `exp`, `iat` y `sub`; `protocolia_capabilities` debe ser un array sin duplicados, con máximo 16 permisos reales del contrato y sin `public`.
- **Cliente SPA opcional:** autoriza desde el navegador si están configuradas las cuatro variables `PROTOCOLIA_OIDC_AUTHORIZATION_ENDPOINT`, `PROTOCOLIA_OIDC_TOKEN_ENDPOINT`, `PROTOCOLIA_OIDC_CLIENT_ID`, `PROTOCOLIA_OIDC_REDIRECT_URI`; `PROTOCOLIA_OIDC_SCOPE` es opcional (`openid profile`). Los cuatro valores faltantes habilitan sólo API JWT; una configuración parcial falla el arranque.

El recurso público `GET /api/_protocolia/auth/config` entrega exclusivamente **mode**, `enabled`, `issuer`, `authorizationEndpoint`, `tokenEndpoint`, `clientId`, `redirectUri` y `scope`, todos derivados de la configuración confiable. No incluye contraseñas, claves privadas ni tokens.

El navegador realiza el Authorization Code flow con PKCE `S256` aleatorio, `state` por transacción y comparación del emisor cuando el proveedor devuelve `iss`. Guarda el verificador en `sessionStorage` sólo durante la redirección (vencimiento: cinco minutos), borra la transacción antes del canje y elimina código y estado de la URL. Canjea un código de un solo uso con el `tokenEndpoint` público habilitado para CORS. Conserva el access token **exclusivamente en memoria de React**, y luego consulta `/api/_protocolia/me` para que el backend valide firma, identidad y capacidades. Todas las operaciones API usan la misma cabecera `Authorization` completa, Basic o Bearer, incluidos selectores de referencias y bandeja.

En producción los endpoints de emisor, JWKS, autorización, token y callback requieren HTTPS. `PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true` sólo se utilizó para el emisor desechable de CI en HTTP loopback.

## Evidencia exacta

### S1d.2b — JWT

Código primero validado [`db31919dfa54b3c56b843b3d0a084e505ad8e100`](https://github.com/barbasmarcosi/ProtocolIA/commit/db31919dfa54b3c56b843b3d0a084e505ad8e100).

- [Conformance JWT #38921605540](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38921605540), SUCCESS Nest/Spring/PostgreSQL, prueba independiente de RSA/JWKS. Ambos imprimen `PROTOCOLIA_S1D2B_JWT_PASS`.
- Tokens expirados o no vigentes, emisor/audiencia incorrectos, ausencia de claims, claves desconocidas, firma alterada, `alg=none`, permisos falsificados, repetidos o inexistentes: 401. Se demuestra `owner` derivado del `sub`, lectura privada sólo con permiso, escrituras prohibidas 403 y acceso a filas ajenas 404. Basic rechazado en modo JWT y rechazo de startup de dos mecanismos simultáneos.
- [Quality #38921605332](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38921605332) SUCCESS.
- Promoción protegida tras un rechazo transitorio del conector: desde `1697487ada00cdd64b4604ac66ca1957a08ad351` a `db31919dfa54b3c56b843b3d0a084e505ad8e100` por fast-forward verificado.
- [Regresión Bomberos #38922598615](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38922598615), SUCCESS Spring/Nest/PostgreSQL/Chromium y [quality #38922598637](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38922598637), SUCCESS.

### S1d.2c — SPA con PKCE

Código funcional [`2699dba740b6917a451933ae286efa5af2d0c040`](https://github.com/barbasmarcosi/ProtocolIA/commit/2699dba740b6917a451933ae286efa5af2d0c040).

- [Conformance PKCE #38924723616](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38924723616), SUCCESS en matriz de generación Nest/Spring, compatibilidad Basic y JWT; unit tests para `state` y `S256`. En Nest, Chromium realmente navega a un emisor OAuth2 descartable, recibe el authorization code, vuelve a React, canjea con `code_verifier`, obtiene token RS256 firmado, valida `/me` y crea un registro que persiste en PostgreSQL. Log `PROTOCOLIA_S1D2C_PKCE_BROWSER_PASS`.
- El mismo navegador comprueba que Basic no aparece en modo JWT, que el token no está en `localStorage` ni `sessionStorage`, que se limpia la URL, que el callback falso sin transacción falla sin canje y que el formulario React genera un registro con propietario verificado.
- Spring aprobó generación, Basic y JWT con su configuración; la prueba de redirección Chromium se ejecutó sólo en Nest, compartiendo el código fuente del frontend.
- [Quality específica #38924724286](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38924724286), SUCCESS; promoción fast-forward de `db31919dfa54b3c56b843b3d0a084e505ad8e100` a `2699dba740b6917a451933ae286efa5af2d0c040`.
- [Regresión independiente Bomberos #38925110858](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38925110858), SUCCESS con Nest/Spring/PostgreSQL/Chromium y [quality integrada #38925110741](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38925110741), SUCCESS.

## Límites que impiden declarar identidad 100 % productiva

1. **No es un cliente OIDC completo.** No se inspecciona criptográficamente un `id_token` ni se valida su `nonce` ni metadata discovery OIDC; se usa OAuth2 Authorization Code + PKCE con un proveedor compatible y la identidad del access token se valida en el backend. El servidor de recursos sí verifica firma RS256. Evitar confundir el flujo con cumplimiento integral OpenID Connect.
2. El access token sigue en memoria JavaScript: XSS puede usarlo hasta expirar. No hay BFF, cookie `HttpOnly`, CSRF de sesión BFF ni refresh/rotación de tokens. Recargar la SPA obliga a iniciar sesión de nuevo. La expiración sólo está garantizada por API, no hay logout federado ni revocación en tiempo real.
3. La API presupone que el proveedor emite un **access token JWT RS256** con audiencia del backend, sujeto y claim de capacidades `protocolia_capabilities`. Un proveedor que entrega tokens opacos o únicamente scopes estándar necesita un adaptador específico o mapeo confiable de roles del servidor.
4. El intercambio de código se hace por navegador contra endpoint público CORS del proveedor. Sólo funcionan proveedores que acepten clientes SPA públicos con PKCE y callback registrado exactamente. No se admite un secreto de cliente en JS.
5. Las cuentas demo Basic no son usuarios productivos; el esquema de propietariedad sigue atado a `sub` sin multi-tenant compartido. No hay RLS en PostgreSQL, revocación JWT, límites de acceso a joins arbitrarios ni mitigación de 409 que revele claves ajenas.
6. No hubo deploy ni migración en Railway o Neon. `main` y PR #52 permanecen sin cambios. Los tests no cierran los 16 requisitos congelados de Bomberos.

**Siguiente:** S1e, aislamiento de identidades públicas por sujeto, acceso a recursos relacionados más complejos, y evaluación de BFF/OIDC de cliente completo.

Referencias: OAuth2 Security BCP RFC 9700, y OAuth 2.0 for Browser-Based Applications RFC 10017.
