# S1d.2e — Descubrimiento OIDC estricto y asociación de emisor

**Fecha:** 16 de octubre de 2026. **Estado:** PASS acotado en NestJS + Spring Boot, PostgreSQL y Chromium. Este incremento **no convierte la aplicación en un cliente OpenID Connect productivo completo**.

## Alcance implementado en el generador

- La opción `PROTOCOLIA_OIDC_DISCOVERY_REQUIRED=true` activa un perfil de descubrimiento estricto para **aplicaciones generadas** con JWT y SPA OAuth2 Authorization Code + PKCE configurado. El valor predeterminado es `false` para preservar los flujos preexistentes.
- Ambos backends derivan la ubicación `/.well-known/openid-configuration` desde el issuer confiable definido por el operador; no reciben URLs de descubrimiento de peticiones o datos del usuario.
- En el arranque se descarga metadata JSON con tiempo límite, tamaño máximo 32 KiB, rechazo de redirecciones y fallas de red fail-closed.
- Se compara por igualdad exacta `issuer`, `authorization_endpoint`, `token_endpoint` y `jwks_uri` contra las variables de configuración confiables. Esto vincula el emisor y el JWKS del servidor de recursos con los endpoints del cliente SPA.
- El proveedor debe anunciar `response_types_supported` incluyendo `code`, `code_challenge_methods_supported` incluyendo `S256`, y `authorization_response_iss_parameter_supported=true`.
- En modo estricto, el frontend generado exige **exactamente un `iss` coincidente** antes de cualquier canje de authorization code; la verificación criptográfica del access token JWT RS256 sigue perteneciendo al backend.
- La configuración OIDC verificada en Spring se cachea durante la vida del proceso, evitando consultar discovery en cada petición a `/api/_protocolia/auth/config`.

## Evidencia reproducible

- **Commit funcional validado:** [d7aab7d0e8763bf9fbbd25e12ed68ad3e6e612d4](https://github.com/barbasmarcosi/ProtocolIA/commit/d7aab7d0e8763bf9fbbd25e12ed68ad3e6e612d4).
- **[S1d.2e conformance #38933822967](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38933822967): SUCCESS** — dos jobs, generación TypeSpec de NestJS y Spring Boot, autenticación demo, JWT RS256/JWKS, prueba negativa de arranque ante metadata con `issuer` falsificado, corrección del proveedor y OAuth2 PKCE real en Chromium en **ambos** backends. También se valida segundo login y rechazo de HTTP 401 perteneciente a sesión anterior.
- **[Quality de rama #38933822917](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38933822917): SUCCESS**.
- **[Regresión independiente Bomberos #38934211776](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38934211776): SUCCESS** — Spring y NestJS con PostgreSQL/HTTP y Chromium independiente (NestJS).
- **[Quality integrada #38934211773](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38934211773): SUCCESS en intento 2.** En el primer intento, `unit (3.11)` falló sólo al limpiar `.git` de un directorio temporal en una prueba P4 histórica (`OSError: Directory not empty`). Se repitió ese job, sin modificar código, y pasó; el resto de los jobs ya estaba verde.
- Integración protegida por fast-forward, con `expected_sha=457458bfaf746df9e633a4fe393c3a6c59bb9ef4`. No se tocaron `main`, PR #52 ni Railway/Neon.

## Límites

1. La funcionalidad de discovery es **optativa**, no se declara conformidad OIDC integral. La prueba de incompatibilidad deliberada con proveedores que no anuncian RFC 9207/S256 evita aceptar silenciosamente un perfil más débil.
2. No se valida criptográficamente un ID Token con `nonce`, `aud`, `azp`, etc. No hay federated logout, refresh token rotation, revocación online ni BFF con cookie HttpOnly.
3. Se continúa asumiendo un **access token JWT RS256** emitido por un emisor confiable, con audience del backend y `protocolia_capabilities` en formato esperado. Los proveedores con token opaco, scopes distintos o claims de permisos diferentes requieren un adaptador de identidad confiable.
4. Las pruebas verifican negativa de **issuer** falsificado. Las rutas de error por JWKS inconsistente, redirección, timeout y documento sobredimensionado tienen controles implementados, pero no cuentan todavía con pruebas independientes dedicadas.
5. El token permanece en memoria del frontend, por lo que XSS continúa siendo riesgo relevante.

## Próximos incrementos

- Evaluar OIDC Client/BFF de librerías maduras (con autentificación de ID Token, nonce, sesión HttpOnly/CSRF, logout, renovación y revocación) sin implementar criptografía artesanal.
- Introducir mapeo de roles/capacidades de backend confiable y políticas multi-entidad, preservando el contrato TypeSpec como fuente de verdad.
- Ampliar pruebas adversariales a metadatos alterados, rotación JWKS y proveedor caído.

Referencias normativas: OpenID Connect Discovery 1.0 y RFC 9207.
