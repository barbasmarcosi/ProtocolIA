# ProtocolIA B7 — Actualizaciones atómicas de claves compuestas de 2 a 4 campos

**Fecha:** 2026-10-17  
**Resultado:** ACCEPTED en el alcance acotado que se describe abajo.  
**Commit de código y tests validado:** `5c0d5157255ffdb2807ed3a591990f567ce37fdf`.  
**CI E2E:** [vnext-b7-multicolumn-update #39055256499](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39055256499) — **SUCCESS** en NestJS y Spring Boot.  
**CI quality:** [#39055256422](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39055256422) — **SUCCESS**.

## Capacidad del producto

ProtocolIA ya declaraba claves únicas de 2–4 miembros mediante `@uniqueTogether`, pero B6 limitaba `@patchTogether` a dos cadenas. B7 permite que una operación TypeSpec cambie **todos los 2–4 campos obligatorios y editables de una única clave compuesta** en una sola llamada. La modificación no requiere código de aplicación escrito para un dominio específico.

- El compilador exige identidad pública en ruta, cuerpo con exactamente todos los miembros, constraints TypeSpec iguales a los de la entidad y los errores HTTP pertinentes. Declara rechazo antes de generar ante DTO parcial, nombres reordenados, campos de referencia/propiedad gestionados o `@uniqueWhen`.
- Los adaptadores generan una sola sentencia `UPDATE ... SET a=?,b=?,c=? ... WHERE public_id=?` (o parámetros nombrados equivalentes). No hay lecturas previas ni secuencias de PATCH parciales; PostgreSQL arbitra la unicidad `23505` con HTTP 409.
- La plantilla React construye automáticamente el formulario a partir de la lista de campos del contrato, usa labels y límites declarados, mantiene los valores ante conflictos y muestra éxito únicamente después de respuesta HTTP real. Las cadenas para 3–4 miembros dejan de decir «ambos campos». B6 conserva su mensaje de éxito específico para dos miembros.
- Fixture independiente `examples/vnext/compound-update-3`: lotes administrativos con `branch,period,department`, aislado del banco de pruebas de Bomberos.

## Evidencia reproducible

La matriz `nestjs` / `modular-spring` usa Node 24, Java 21 para Spring, TypeSpec fijado en `package-lock.json`, PostgreSQL y Chromium en runners ubuntu-24.04:

1. `npm ci`, `npm run build:vnext`.
2. `node --test tests/vnext/compound-update.test.mjs tests/vnext/compound-update-multicolumn.test.mjs` — PASS en ambos; casos negativos del compilador, aceptación de 3/4 claves y límite superior de cuatro miembros.
3. `npm run app:build -- examples/vnext/compound-update-3 --target <nestjs|modular-spring> --out <directorio>` — PASS en ambos.
4. `npm run app:test -- <directorio>` — `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS` en ambos.
5. `node scripts/vnext/probe-compound-update-3-http.mjs <directorio>` — `PROTOCOLIA_B7_ATOMIC_MULTI_FIELD_PATCH_PASS` y `PROTOCOLIA_B7_THREE_FIELD_UI_CHROMIUM_PASS` en ambos.

Cada backend verificó sobre PostgreSQL y HTTP: actualización completa con campos ajenos preservados; rollback frente a duplicados 409; cuerpo incompleto/desconocido 400, identidad inexistente 404 y usuario de solo lectura 403; **12 cambios concurrentes sobre la misma clave de tres campos: 1×200, 11×409, once filas perdedoras sin ninguna columna modificada, y 14 filas conservadas**. El navegador Chromium ejecutó edición real, error contextual, corrección y guardado; se probó vista de 390×844 y presencia del formulario en 1280×800, sin errores JavaScript.

La compilación y el smoke de ambos backends, además de la regresión B6 de contrato, pasaron en la misma ejecución de CI.

## Límites y siguientes prioridades

- Se demostró runtime/Chromium para **tres** miembros; cuatro miembros tienen validación de compilador/adaptador, pero no todavía escenario PostgreSQL/Chromium propio.
- El perfil acepta exclusivamente entre dos y cuatro **cadenas requeridas** que conformen la totalidad de una `@uniqueTogether`. No admite componentes opcionales, referencias, `@uniqueWhen`, expresiones de actualización arbitrarias, controles ETag/versionado ni migración automática de datos existentes.
- No se ejecutó un test completo con lector de pantalla ni auditoría WCAG en todas las pantallas generadas; ampliar accesibilidad real, mensajes de validación localizados y operaciones multiagregado contractuales.
- Aspectos de despliegue y seguridad productiva que ya estaban pendientes permanecen fuera del incremento. Ninguna instancia Railway/Neon ni base persistente fue modificada en B7.

**Integración:** avance de la rama de producto `independent/volunteer-evaluations` por fast-forward protegido tras verificación de CI; `main` y PR #52 no se fusionan.
