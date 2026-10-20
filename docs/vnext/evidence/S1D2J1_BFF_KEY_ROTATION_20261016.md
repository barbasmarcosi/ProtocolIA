# S1d.2j.1 — Rotación de claves BFF y revocación entre réplicas

**Fecha:** 16 de octubre de 2026. **Resultado:** ACCEPTED — pruebas reales sobre NestJS y Spring Boot, PostgreSQL, proxy HTTPS y Chromium, más regresión independiente Bomberos. **Alcance:** AES-256-GCM keyring y revocación local distribuida; la revocación federada ante el proveedor OIDC permanece pendiente.

## Arquitectura incorporada

El generador entrega `BffKeyring.ts` para NestJS y `BffKeyring.java` para Spring Boot. El código se genera desde plantillas, **no** se parchean aplicaciones producidas ni se modifica el contrato TypeSpec.

- Clave **activa** (`PROTOCOLIA_BFF_ENCRYPTION_KEY`): 32 bytes hexadecimales para **toda escritura nueva**.
- Claves **retiradas sólo de lectura** (`PROTOCOLIA_BFF_DECRYPTION_KEYS`): opcionales, separadas por comas, hasta tres claves AES-256-GCM anteriores. Una clave retirada no puede cifrar un token nuevo.
- Todas las claves se validan durante el arranque; un valor corto, inválido o duplicado provoca fallo de inicialización (fail-closed).
- Cada payload nuevo usa `v1:<kid>:<ciphertext>`. `kid` son 16 caracteres hexadecimales de un SHA-256 de los 32 bytes de clave; **no** contiene la clave. El cifrado conserva el formato AES-GCM anterior de cada backend: IV aleatorio de 96 bits, tag autenticado de 128 bits y ciphertext. Un `kid` ausente, desconocido o manipulado nunca habilita una clave de respaldo.
- Se reconocen ciphertexts previos a S1d.2j, sin prefijo; la lectura intenta la clave activa y las retiradas bajo la autenticación GCM. Si no verifica ninguna, se rechaza la sesión. No se hace reinterpretación en claro.
- Los tokens de acceso y CSRF permanecen exclusivamente en el payload cifrado de PostgreSQL. Las cookies continúan siendo identificadores opacos HttpOnly/Secure, y los permisos siguen sujetos a JWT firmado y al contrato.
- En NestJS, el keyring también protege las cookies de transacción OAuth temporal; Spring conserva Spring Security OAuth2 Client y Spring Session JDBC.

## Ensayo de rotación y dos instancias vivas

`scripts/vnext/probe-bff-https-proxy.mjs --rotate-keyring` genera un sistema completo TypeSpec→React+backend, un IdP temporal, PostgreSQL y un proxy HTTPS con certificado descartable:

1. Inicia sesión con la clave A y verifica payload versionado `v1`.
2. Transforma deliberadamente ese payload a formato legacy sin prefijo para comprobar migración real, no únicamente un test unitario.
3. Reinicia el backend con clave activa **B** y clave **A retirada**, preservando la base. Verifica que la sesión legacy siga autenticada sin nuevo login.
4. Abre una sesión nueva y verifica que el payload esté etiquetado con el `kid` de B: ninguna escritura nueva utiliza A.
5. Arranca una **segunda réplica activa** del mismo backend conectada a PostgreSQL; valida lectura de sesiones antiguas y nuevas desde el segundo proxy HTTPS.
6. Ejecuta logout con CSRF válido mediante la segunda réplica. Comprueba eliminación de la sesión en la tabla compartida, de modo que la revocación sea visible globalmente en las réplicas.
7. Reinicia el backend con B activa **sin** A y verifica que la sesión legacy de A sea rechazada, y que una nueva sesión B siga pudiendo autenticarse.
8. Conservar el resto de adversariales: OAuth2 PKCE, OIDC firmado, `HttpOnly`, `Secure`, `__Host-`, CSP, CSRF, origen, Fetch Metadata, ausencia de bearer en JavaScript, expiración, creación real de entidad, restauración y logout.

`tests/vnext/bff-keyring.test.mjs` agrega pruebas directas: versión, transición, lectura legacy, GCM alterado, `kid` falso/desconocido, clave duplicada, lista excesiva y fallos cerrados.

## Evidencia verificada

- **Commit funcional:** [0315f31f55eab6d82e8fbe77ff96ed5ef1627953](https://github.com/barbasmarcosi/ProtocolIA/commit/0315f31f55eab6d82e8fbe77ff96ed5ef1627953).
- [S1d.2j.1 CI #38957391021](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38957391021): **SUCCESS** en `nestjs` y `modular-spring`, con Chromium, Postgres y dos réplicas reales por target.
- [Quality de la feature #38957390921](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38957390921): **SUCCESS**.
- [Regresión independiente Bomberos integrada #38957976394](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38957976394): **SUCCESS**, Spring Boot+PostgreSQL y NestJS+PostgreSQL+Chromium, aplicaciones autogeneradas desde contratos independientes.
- [Quality integrada #38957976375](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38957976375): **SUCCESS**, matrices Python 3.11/3.13 y conformance.
- Fast-forward protegido a `independent/volunteer-evaluations` desde `ad4d8337680cc2d0bbca23f1ec063ef1a6846e57`; `main`, PR #52 y servicios Railway/Neon no se modificaron.

## Runbook de rotación sin perder compatibilidad

**Importante:** cambiar A→B en todas las instancias de golpe no equivale a demostrar un *rolling deploy* mixto, aunque dos réplicas simultáneas con la misma configuración sí fueron validadas. Para un rollout gradual de aplicaciones antiguas y nuevas:

1. Preparar B nueva de 32 bytes, guardarla en el gestor de secretos; distribuir a **todas** las instancias con `PROTOCOLIA_BFF_ENCRYPTION_KEY=A` y `PROTOCOLIA_BFF_DECRYPTION_KEYS=B`. Verificar que todas estén listas; todavía escriben A, pero ahora pueden leer B.
2. Actualizar progresivamente a `PROTOCOLIA_BFF_ENCRYPTION_KEY=B` y `PROTOCOLIA_BFF_DECRYPTION_KEYS=A`. Durante el tránsito las dos variantes pueden descifrar ambas claves.
3. Mantener A sólo para lectura hasta que venza cualquier sesión y transacción emitida con A (límite actual 20 minutos para BFF más margen de despliegue, reloj y reintentos).
4. Finalmente eliminar A de `PROTOCOLIA_BFF_DECRYPTION_KEYS` y comprobar que las sesiones antiguas ya no se puedan leer. Un rollback debe conservar el par de claves mientras puedan existir sesiones con B.

No copiar claves a archivos versionados ni registrarlas en logs, mantener backups protegidos, sincronizar configuración entre réplicas y auditar periódicamente retiros. El mecanismo no re-cifra sesiones antiguas en segundo plano; expiran o se invalidan al retirar su clave.

## Pendientes no cubiertos

- **Federated/RP-Initiated Logout:** no está implementado; el logout probado es local pero sí revoca en **todas las réplicas** gracias al almacén PostgreSQL compartido. Implementar logout OIDC exige validar `end_session_endpoint` de discovery y una transición iniciada por el usuario sin entregar access tokens a JavaScript.
- **Refresh y rotación de refresh tokens:** ausentes. Las sesiones BFF mantienen vencimiento estricto y no se prolongan silenciosamente.
- **Rolling deployment mixto A/B, carga y fallos simultáneos:** se demostró dos réplicas activas con configuración idéntica más reinicios con rotación; falta stress/failover sostenido con balanceador real.
- **IdP real corporativo, secretos gestionados, auditoría y SLO:** fuera de esta CI de IdP descartable.

**Próximo incremento recomendado:** S1d.2j.2 logout federado optativo con contrato OIDC validado y ticket de redirección de un solo uso; después refresh seguro y despliegue multiinstancia continuo.
