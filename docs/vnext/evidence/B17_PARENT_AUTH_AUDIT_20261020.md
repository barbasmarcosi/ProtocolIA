# B17.2 — Autorización de cabecera y auditoría atómica de altas directas

**Fecha:** 2026-10-20  
**Base:** [B17.1](B17_BOUNDED_APPEND_20261020.md), heredada de `independent/volunteer-evaluations` (B16)  
**Fuente funcional verificada:** `38e20991ee81a216e1a4959fa92c32be95f83b89`  
**CI funcional:** [GitHub Actions #39432965800](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39432965800) — **SUCCESS** en `nestjs` y `modular-spring`  
**Quality:** [#39432965837](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39432965837) — **SUCCESS**

## Problema real

B17.1 reparó el límite concurrente de la colección, pero el POST directo de un recurso hijo seguía condicionado exclusivamente al permiso de escritura del hijo. Un actor autorizado a crear líneas pero sin permiso para modificar órdenes podía agregar registros a cualquier cabecera existente.

Adicionalmente, las altas de hijos posteriores a la creación del documento no disponían de una prueba específica de auditoría declarativa y de rollback ante un fallo al registrar el evento.

## Implementación

1. **Permisos sobre dos límites de negocio.** En el caso de un hijo vinculado a un `@createDetails`, ambos runtimes exigen el permiso específico del POST de hijo **y** la capacidad del POST de creación de su cabecera (`boundedCreator.capability`). Una cuenta con `lines.write`, pero sin `orders.write`, recibe 403. El requisito se evalúa en el servidor, no solo ocultando controles UI.
2. **Fixture independiente de B16:** `examples/vnext/dynamic-order-audited-append/contracts/main.tsp` conserva el perfil de órdenes dinámicas, pero añade `@audit("orderCode,product,units")` al POST del hijo. No se altera el fixture congelado B16, sus contratos ni su evidencia.
3. **Compilación segura:** el verificador de `@createDetails` permite una selección auditada de campos del alta independiente siempre que sea explícita, no incluya la identidad pública, esté acotada a 1–8 campos declarados sin duplicados e incluya la FK que identifica su cabecera. Las auditorías ausentes de fixtures anteriores siguen siendo válidas.
4. **Una transacción:** la auditoría declarada del POST hijo ya utiliza el mismo límite transaccional de creación. Spring usa `dispatch @Transactional`, NestJS conserva el `pg` client de `BEGIN` a `COMMIT`. Un error en el INSERT de auditoría revierte también el INSERT del hijo.

## Matriz ejecutada, sin simulaciones

`vnext-b17-bounded-detail-append.yml` compila TypeSpec, ejecuta pruebas de contrato/IR y negativos, genera separadamente las aplicaciones Spring y NestJS, construye Docker Compose sobre PostgreSQL y ejecuta el oráculo HTTP y Chromium real con pantalla de 390 px.

En **ambos backends** se observaron:
- `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS` y `PROTOCOLIA_B16_MULTI_FIELD_CHROMIUM_PASS`.
- `PROTOCOLIA_B17_BOUNDED_APPEND_PASS`: 21ª fila rechazada, último lugar disponible con 1×201 / 1×409, SQL global consistente y cero huérfanos.
- `PROTOCOLIA_B17_PARENT_AUTH_AUDIT_PASS`: alta legítima con tres campos auditable, perdedor de la carrera sin eventos, usuario con capacidad `lines.write` pero no `orders.write` denegado con 403.
- **Fallo provocado de auditoría:** trigger PostgreSQL temporal genera una excepción ante la inserción de un evento para `AUDIT-FAIL`. Se exige HTTP 500, GET del hijo 404, total global sin cambios y 0 eventos de ese intento. El trigger se retira luego; la operación no deja datos parciales. Marcador `failedAuditRollsBackChild:true`.
- Regresión B16: edición de dos campos con CAS y autoridad independiente, totales SQL y navegador React.

La prueba reinicia solamente el contenedor de la aplicación, preserva PostgreSQL y configura un usuario de integración con `orders.read,lines.read,lines.write` sin permiso sobre la cabecera. Esto evita confundir el control de cabecera con la protección previa del permiso del hijo.

## Límites que siguen abiertos

- **No** existe `expectedVersion` global de la orden ni protocolo de conflicto entre agregar/editar/borrar filas.
- **No** hay operación DELETE auditada y autorizada para retirar un hijo de la colección, ni reemplazo atómico de un conjunto de líneas.
- `@audit` en el POST hijo es **declarativo y opt-in**. No se añadieron automáticamente eventos por los hijos iniciales creados anidados bajo el POST de cabecera.
- Las operaciones siguen usando capacidades declaradas: no hay IAM de producción ni autorización por propietario de cada cabecera; un permiso de escritura de cabecera es todavía global dentro del recurso.
- El error forzado de auditoría se traduce a 500 durante el ensayo; no equivale a una política pública de tratamiento de errores de producción.
- No hay despliegue durable de una app de cliente con datos de producción.

## Próximo incremento

**B17.3:** contrato explícito de versión de cabecera y mutación auditada de colecciones, `expectedVersion` requerido, regla de bloqueo/ordenación común entre POST/PATCH/DELETE, nueva versión persistida solo tras commit, 409 por expectativa obsoleta, y política de autorización por orden. Validarlo con carreras entre distintas operaciones en ambos backends antes de afirmar cierre documental.

**No fusionar en `main` sin decisión explícita.**
