# S1d.2i.3 — BFF seguro detrás de proxy HTTPS y CSP restrictiva

**Fecha:** 16-10-2026. **Estado:** ACCEPTED. Pruebas funcionales de TLS proxy, navegador y regresión independiente completas para ambos targets. No equivale a homologación productiva universal.

## Objetivo y falla real resuelta

Los BFF generados para NestJS y Spring Boot conservaban tokens en sesiones cifradas de PostgreSQL, pero requerían probar explícitamente la experiencia de navegador detrás de un **proxy que termina HTTPS** mientras el backend recibe HTTP. En el primer ensayo, NestJS pasó y Spring falló porque `HttpServletResponse.sendRedirect("/oauth2/authorization/protocolia")` transformó la ruta relativa en una redirección absoluta **HTTP** al origen público, enviando al navegador al puerto TLS usando HTTP (`net::ERR_EMPTY_RESPONSE`). Se corrigió generando una redirección con el origen HTTPS derivado del callback BFF que el operador registró y validó, **sin confiar ciegamente en `X-Forwarded-Host`/`X-Forwarded-Proto`**.

## Cambios en el generador

1. **NestJS:** `installBffSecurityHeaders` agrega cabeceras **antes del middleware de recursos estáticos**; así CSP, HSTS y demás protecciones alcanzan `/`, HTML/React/JS y APIs, no sólo `/api`. El callback BFF sigue usando OAuth2 Authorization Code + PKCE y un IdP validado previamente.
2. **Spring Boot:** la configuración condicional `BffHttpSessionConfig` agrega un filtro global para esas cabeceras. La respuesta `/api` ya no sobrescribe la CSP global con una política parcial. Spring Session JDBC emplea `DefaultCookieSerializer` con `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` para callback HTTPS, incluso cuando la conexión Tomcat↔proxy es HTTP.
3. **Cookies BFF en ambos:** se determina el modo seguro a partir del esquema de `PROTOCOLIA_OIDC_BFF_REDIRECT_URI` **fijado por el operador**, no del protocolo interno ni del encabezado arbitrario de un cliente. HTTPS produce las cookies `__Host-pia_bff` y, en Nest, `__Host-pia_login`, con `Secure; HttpOnly; SameSite=Lax; Path=/`. HTTP se admite exclusivamente bajo `PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true` y utiliza nombres de cookies de desarrollo distintos. Los endpoints públicos no cambian los privilegios JWT/capabilities.
4. **CSP:** `default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`, más `upgrade-insecure-requests` cuando el callback externo es HTTPS. Los scripts **no** permiten `unsafe-inline`; `style-src-attr 'unsafe-inline'` se conserva por las propiedades `style={...}` que generan componentes React actuales.
5. **Encabezados:** `Strict-Transport-Security: max-age=31536000` en modo HTTPS; `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y `Referrer-Policy: no-referrer`.
6. **No hay parches por sistema:** todo se cambió en las plantillas compartidas y en el test/proceso de generación; los contratos TypeSpec siguen intactos.

## Aceptación real reproducible

- **Commit funcional integrado:** [8fc12c995140d66904604334c7455d457e5564ac](https://github.com/barbasmarcosi/ProtocolIA/commit/8fc12c995140d66904604334c7455d457e5564ac).
- [HTTPS/CSP matriz #38951879011](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38951879011): **SUCCESS** en `nestjs` y `modular-spring`. Genera desde TypeSpec, valida demo Basic y JWT RS256/JWKS, ejecuta OAuth público en Chromium y luego instala proxy inverso HTTPS de pruebas (certificado autocreado mediante OpenSSL) delante de cada BFF, cuyo HTTP interno queda oculto al navegador. Verifica CSP/HSTS del **documento HTML** y API, cookies `Secure`/`__Host-`/`HttpOnly`, acceso controlado, CSRF, sesiones expiradas, ausencia de bearer en React, creación real, restauración y logout.
- [Quality de rama #38951879124](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38951879124): **SUCCESS**.
- [Bomberos independiente #38952283180](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38952283180): **SUCCESS** en NestJS y Spring Boot autogenerados; PostgreSQL/HTTP y Chromium independiente en NestJS.
- [Quality integrada #38952283084](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38952283084): **SUCCESS**, todas las matrices incluido Python 3.11 y 3.13.
- El primer intento HTTPS (#38950884252) y la repetición de diagnóstico (#38951402943) fallaron **sólo en Spring** por la redirección HTTP interna. Los logs saneados de Chromium revelaron `https://127.0.0.1:<puerto>/api/_protocolia/bff/login` → HTTP en el mismo puerto TLS. Se corrigió el bug del generador, se repitieron **ambos** targets, y terminaron en verde.
- Integración por fast-forward protegido con `expected_sha=c1155c7355ea3f56564e2e8845538e3c215aa273`. `main`, PR #52 y los despliegues persistentes Railway/Neon no se modificaron.

## Seguridad y límites aún presentes

- El ensayo **sí realiza TLS extremo navegador→proxy** con certificado descartable y HTTP sólo desde proxy al backend. **No** valida un certificado de CA público, configuración concreta de Nginx/Traefik, WAF, red privada ni un proveedor OIDC corporativo externo.
- El IdP de pruebas es descartable y usa HTTP internamente bajo `PROTOCOLIA_JWT_ALLOW_TEST_HTTP=true`; esa bandera **no debe activarse en producción**. El test prueba cookies HTTPS reales independientemente del mock IdP, pero no representa una sesión completa con todos los endpoints OIDC bajo CA pública.
- Para operar con proxy real, aislar físicamente el puerto HTTP del backend: sólo el proxy confiable debe poder alcanzarlo, debe borrar y reconstruir `Forwarded`/`X-Forwarded-*` desde el borde, usar HTTPS público y configurar secretos mediante gestor seguro. El código no valida todas las topologías posibles de proxy.
- La CSP protege scripts de origen externo e inline, pero por compatibilidad con el React generado permite aún **estilos inline**, y por sí sola no elimina todas las posibilidades de XSS. El siguiente endurecimiento puede extraer esos estilos a clases generadas y entonces quitar `unsafe-inline` de `style-src-attr`.
- Faltan refresh/rotación de access/refresh tokens, rotación de claves AES BFF, logout federado/OIDC RP-initiated logout, pruebas de balanceo activo y certificados de producción y auditoría operativa.

## Siguiente prioridad

S1d.2j: endurecer semántica de las sesiones sobre múltiples réplicas, gestión y rotación de claves cifradas, revocación federada con un IdP real, y políticas de seguridad que cubran los estilos de React sin excepciones. Mantener comparaciones independientes y contratos TypeSpec como autoridad.
