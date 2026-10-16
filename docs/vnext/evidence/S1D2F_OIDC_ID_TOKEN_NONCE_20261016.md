# S1d.2f — Validación de identidad OIDC por ID Token firmado y nonce

Fecha: 16 de octubre de 2026. **Estado: PASS acotado.** No es todavía una sesión BFF ni una solución de identidad productiva integral.

## Implementación real en el generador

- Activación optativa: `PROTOCOLIA_OIDC_ID_TOKEN_REQUIRED=true`, dependiente de `PROTOCOLIA_OIDC_DISCOVERY_REQUIRED=true`. El modo por defecto continúa admitiendo los sistemas y tests existentes.
- La plantilla React compartida genera un `nonce` de alta entropía por inicio de sesión y lo agrega a la solicitud Authorization Code + PKCE. La transacción se consume una sola vez y se elimina antes del canje.
- El ID Token de respuesta no se interpreta como autoridad en el navegador: se entrega transitoriamente, junto con el nonce y el access token, al endpoint autenticado `GET /api/_protocolia/me`. No se persiste en localStorage ni sessionStorage.
- NestJS verifica con `jose.jwtVerify` y JWKS confiable. Spring Boot verifica con `NimbusJwtDecoder` y Spring Security. Ambos comprueban firma RS256, issuer exacto, `exp`, `iat`, audiencia restringida al client ID, `azp` opcional, `nonce`, el mismo `sub` que el access token y `at_hash` cuando viene incluido.
- El ID Token solamente demuestra identidad durante el login; **no** concede capacidades de negocio. Todas las API posteriores continúan verificando el access token JWT firmado en el backend con sus permisos y propietario.
- El cambio es compartido por ambos adaptadores y no contiene parches por aplicación generada.

## Aceptación reproducible

- **Commit funcional:** [2f255a9a1bf159de386749c33171582bd9cf5178](https://github.com/barbasmarcosi/ProtocolIA/commit/2f255a9a1bf159de386749c33171582bd9cf5178).
- [Conformance S1d.2f #38936112210](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38936112210): **SUCCESS** NestJS y Spring Boot. Generación TypeSpec de dos sistemas, compatibilidad demo Basic, recurso JWT RS256/JWKS, PostgreSQL, prueba negativa de metadatos con issuer falsificado, aceptación real en Chromium; HTTP niega IDs con nonce/aud/sub/iss/at_hash/iat inválidos, firma efectivamente manipulada o prueba ausente.
- [Quality de rama #38936112045](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38936112045): **SUCCESS**.
- [Regresión independiente Bomberos #38936477860](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38936477860): **SUCCESS** NestJS y Spring Boot, PostgreSQL/HTTP y Chromium independiente en NestJS.
- [Quality integrada #38936477772](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38936477772): **SUCCESS**, Python 3.11/3.13 y las demás verificaciones.
- El primer ensayo S1d.2f (#38935754656) dio FAIL solo en un test adversarial que cambiaba bits de relleno Base64URL sin alterar la firma binaria. El commit `2f255a9` corrigió el ensayo para modificar un carácter significativo de la firma; se revalidó la matriz completa en verde.
- Integrado por fast-forward protegido (`expected_sha=060d50474c594295902d7ad6363cfd8caefe9eeb`) en `independent/volunteer-evaluations`. `main`, PR #52, Railway UX9 y Neon persistente permanecen sin cambios.

## Límites honestos

1. El access token permanece en memoria del navegador durante la sesión; XSS aún podría usarlo. Tampoco hay cookie `HttpOnly`, BFF, protección CSRF de cookie ni rotación de refresh tokens.
2. Esta prueba certifica ID Token firmado ligado al token de acceso, pero **no** agrega revocación remota, logout federado, introspección de access tokens opacos ni soporte de proveedores que no emitan JWT RS256 con capacidades `protocolia_capabilities`.
3. La comprobación de `nonce` ocurre en `/me` antes de activar la sesión del frontend y depende de la transacción PKCE del navegador. Una futura opción BFF debería almacenar el estado del login y las credenciales exclusivamente del lado servidor y rechazar CSRF.
4. Este perfil limita las audiencias del ID Token al client ID configurado; múltiples audiencias requieren una política revisada antes de habilitarse.
5. El siguiente incremento recomendado es un BFF de servidor con sesiones cookie seguras, protección CSRF explícita, tokens fuera de JavaScript, logout e integración con un proveedor OIDC real mediante bibliotecas mantenidas.

Referencia: [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html), sección 3.1.3.7.
