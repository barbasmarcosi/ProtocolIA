# S1d.2d — Ciclo de vida de la sesión React generada

**Fecha:** 16 de octubre de 2026. **Estado:** PASS acotado con suite independiente NestJS/Spring Boot/PostgreSQL/Chromium. No equivale a identidad/OIDC productiva completa.

## Alcance implementado en el generador

- Módulo fuente compartido AuthSession.js, copiado por los adaptadores modular-spring y nestjs. Ningún parche en aplicaciones generadas.
- Cada llamada HTTP autenticada de las vistas principales, bandejas de notificaciones y selectores de relaciones transmite HTTP 401 con **la credencial exacta que realizó la petición**.
- La SPA invalida su estado de sesión y permisos y muestra un error accesible de reautenticación, sólo cuando la credencial rechazada coincide con la identidad actual. Respuestas en vuelo de otra sesión no la terminan.
- Para Bearer JWT, exp se decodifica exclusivamente como **indicador anticipado de UX**, sin confiar en ese valor para identidad o permisos. El backend sigue validando firma RS256/JWKS, audiencia, issuer y capacidades. Basic demo no usa expiración client-side.
- No se usan refresh tokens ni almacenamiento persistente del JWT. El logout sigue siendo **local** (sin revocación federada).

## Evidencia reproducible

Código con pruebas: [74e3a36b6f88e3d720f2c277ac6dea8caa1c2094](https://github.com/barbasmarcosi/ProtocolIA/commit/74e3a36b6f88e3d720f2c277ac6dea8caa1c2094), integrado por fast-forward con expected_sha desde 7989cf22d61f1cb856f75e35e647cc17fad7842a.

- [S1d.2d #38931700683](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38931700683): SUCCESS, dos jobs (NestJS y Spring Boot). Tests de PKCE y sesión, generación TypeSpec, compatibilidad demo Basic y servidor JWT RS256/JWKS en ambos. Chromium en NestJS verificó 401 en solicitud protegida, cierre local, segundo OAuth2 PKCE real y aislamiento de eventos 401 de credenciales anteriores.
- [Quality de rama #38931700626](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38931700626): SUCCESS.
- [Regresión independiente de Bomberos #38932091639](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38932091639): SUCCESS para NestJS y Spring Boot con PostgreSQL/HTTP real y Chromium independiente en NestJS.
- [Quality integrada #38932091709](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38932091709): SUCCESS.

## Límites y siguientes prioridades

1. HTTP 401 no revoca un token aún válido ante el proveedor; sólo borra la sesión del navegador. Se mantiene la dependencia de JWT de acceso RS256 con capacidades emitidas por el servidor confiable.
2. Un access token en memoria sigue expuesto a XSS durante su vida útil. No se introdujeron BFF, cookies HttpOnly, refresh token rotation ni logout federado.
3. Falta OIDC integral: discovery verificado, nonce e ID token autenticado, mix-up multi-proveedor, logout de proveedor, política de refresh y revocación.
4. La prueba de navegador OAuth2 y la regresión de Bomberos se realizaron con NestJS; Spring pasó generación y servidor JWT/PostgreSQL/HTTP, pero no se ejecutó la misma redirección OAuth2 en Chromium contra Spring.
5. No hubo cambios en main, PR #52, despliegues persistentes Railway/Neon ni políticas de RLS.

**Siguiente incremento recomendado:** discovery OIDC del lado del servidor y binding estricto entre issuer, metadatos y endpoints, evaluando BFF frente a SPA pública con PKCE antes de declarar identidad productiva.
