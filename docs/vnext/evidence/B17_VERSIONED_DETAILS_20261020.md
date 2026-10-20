# B17.3a — Versionado transaccional de órdenes con renglones dinámicos

**Fecha:** 2026-10-20  
**Base:** B17.1 + B17.2 del PR #53, `independent/volunteer-evaluations` (B16).  
**Commit funcional completo verificado:** `d22b2c8c42b8bc951ad82cb73fab69b8a8771fb2`  
**Matriz:** [GitHub Actions #39469150010](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39469150010) — **SUCCESS** (`nestjs` y `modular-spring`).  
**Quality:** [#39469149879](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39469149879) — **SUCCESS**.

## Motivación y contrato

B17.1 ya impedía desbordar las 20 filas de `@createDetails`; B17.2 sumó autorización conjunta para altas y auditoría transaccional. Sin embargo, múltiples escrituras a un mismo documento todavía podían ser válidas localmente usando una imagen vieja de la colección, y dos editores podían alterar campos diferentes sin una expectativa común sobre la orden.

B17.3a añade la anotación optativa `@versionedDetails` a la operación TypeSpec `@createDetails`. Una aplicación generada desde ese contrato crea `document_version INTEGER NOT NULL DEFAULT 1 CHECK (document_version >= 1)` en la tabla SQL de la cabecera, sin convertirlo en campo escribible por el cliente.

**Contrato de ejemplo separado:** `examples/vnext/dynamic-order-versioned/contracts/main.tsp`.

- GET de cabecera y respuesta de creación de cabecera incluyen `documentVersion` (entero) y `ETag: "1"`, `ETag: "2"`, etc. El modelo TypeSpec de respuesta incluye explícitamente `documentVersion`.
- POST directo de renglón y los dos PATCH auditados del hijo declaran `@header("If-Match")` en el contrato HTTP. Para estos endpoints, el valor esperado es un ETag fuerte en formato `"N"`, con `N` entero entre 1 y 2.147.483.647. Valores ausentes, débiles, comodines o malformados devuelven 400; una expectativa obsoleta devuelve **409**.
- La cabecera se bloquea `SELECT ... FOR UPDATE` antes de modificar cualquier hijo. El motor comprueba la versión bajo ese bloqueo y solo incrementa `document_version` si la mutación y su auditoría tienen éxito dentro de la transacción. Se impide el desbordamiento `int32`.
- Los PATCH conservan la validación `expected` específica del campo y la capacidad de edición independiente de B16; además de ese CAS local, ahora usan un CAS compartido del documento.
- Las altas iniciales anidadas de 1–20 hijos son **una** creación del documento: dejan versión 1. Los POST posteriores de hijos incrementan la versión por cada alta completa.
- El compilador rechaza `@versionedDetails` sin `@createDetails`, colisiones con nombres de versión, creación de hijos sin auditoría que incluya el FK y eliminación directa de la cabecera.
- La capacidad requiere opt-in. El fixture original sin versionado y su matriz B17.2 continúan inalterados.

## Evidencia ejecutada y observada

Se compilaron TypeSpec e IR, se ejecutaron pruebas del contrato y se generaron **dos aplicaciones separadas**, una para `nestjs` y otra para `modular-spring`, cada una contra PostgreSQL bajo Docker Compose.

El oráculo `scripts/vnext/probe-versioned-order-http.mjs` observó en **ambos**:
1. Alta de orden nueva con versión 1 y ETag `"1"`, con GET de la misma versión.
2. Faltante, `W/"1"`, `*`, `1`, `"0"` y desbordamiento de If-Match: HTTP 400.
3. Falta de permiso de escritura de cabecera: HTTP 403, aun si el usuario posee `lines.write`.
4. Alta legítima con `"1"`: HTTP 201 y versión 2; repetición con `"1"`: HTTP 409.
5. Dos POST con `"2"` en carrera: **uno 201 y uno 409**, versión final 3.
6. PATCH de cantidad con If-Match obsoleto: HTTP 409; con versión correcta y valor previo correcto: HTTP 200, versión final 4. PATCH del producto después: versión 5.
7. Carrera POST frente a PATCH, ambos con `"5"`: **exactamente un éxito y un 409**, versión final 6.
8. Consulta SQL directa corrobora versión 6 y conteo real de hijos. GET y ETag coinciden.
9. Trigger temporal PostgreSQL provoca excepción al insertar la auditoría de `AUDIT-ROLLBACK`: HTTP 500, GET del hijo 404, cero eventos y **versión continúa en 6**. Se elimina el trigger y el mismo `If-Match: "6"` permite una creación posterior con HTTP 201 y versión 7.

Marcador de ambas ejecuciones:
`PROTOCOLIA_B17_VERSIONED_DETAILS_PASS {"persisted":true,"strongIfMatch":true,"staleAppendConflict":true,"concurrentAppendOneWinner":true,"auditedPatchVersioned":true,"appendVsPatchOneWinner":true,"versionEtag":true,"parentPermission":true,"failedAuditRollsBackVersion":true}`

El escenario versionado usa un **oráculo especializado** en vez de `npm run app:test`: el conformance genérico B16 intenta hacer POST/PATCH sin `If-Match`, que ahora está prohibido por este contrato. El CI B17 sin versión sigue ejecutando la conformance clásica y las regresiones Chromium.

## Límites pendientes

1. **No hay baja/remoción ni reemplazo atómico de renglones** dentro de una colección versionada. Sigue pendiente una operación formal, con permisos y auditoría de eliminación. No afirmamos que B17 completo esté terminado.
2. La **UI autogenerada** aún no conserva ETag ni envía If-Match. La API/contrato versionados tienen conformance HTTP real; el flujo de edición por interfaz todavía no está habilitado correctamente para este modo.
3. No existe cierre/finalización de la orden con prohibición transaccional de nuevas modificaciones ni versionado transversal de otros tipos de operaciones en un documento.
4. No se implementó control de propiedad por orden: permisos de cabecera e hijo siguen siendo capacidades de negocio del recurso, no reglas de acceso por instancia.
5. No existe una migración automática in-place de bases desplegadas con un esquema anterior. Se validó **generación limpia** de la base para el nuevo contrato.
6. La conformance genérica del CLI debe evolucionar para leer ETag/If-Match. Hasta ese cambio, la prueba de versión vive en su workflow separado y obligatorio para este contrato.
7. No existe despliegue productivo asociado a esta evidencia.

## Siguiente tramo técnico

**B17.3b** debe introducir remoción auditada, con autorización de cabecera/filas y bloqueo de versión; **B17.4** debe generar una UI que descubra ETag, lo mande al mutar y resuelva conflictos 409. Además, mejorar la conformance genérica para no repetir lógica en distintos oráculos y cubrir una migración controlada de esquema.

Mantener este PR en **Draft** y `main` intacta hasta validar los flujos de colección completos.
