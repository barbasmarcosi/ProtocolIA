# B17.1 — Límite transaccional de renglones al agregar después de crear una orden

**Fecha:** 2026-10-20  
**Base preservada:** `independent/volunteer-evaluations` B16, commit `c2692927f5424c52f2e39e4badbb97603c40e5c9`  
**HEAD funcional probado:** `7b88893de25a1c9b98dcfd0974d6f15a00fed93b`  
**Matriz:** [GitHub Actions #39363921593](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39363921593) — **SUCCESS** en `nestjs` y `modular-spring`  
**Quality:** [GitHub Actions #39363921549](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39363921549) — **SUCCESS**

## Problema resuelto

El perfil B12–B16 deriva de TypeSpec una colección hija `@createDetails` de máximo 20 filas, pero el endpoint de creación directa del recurso hijo seguía disponible después del alta del documento. Hasta ahora ese POST podía incrementar la colección por encima del máximo 20, y dos altas simultáneas no competían por un límite serializado en la cabecera.

## Implementación verificable

- **Spring Boot:** en `DomainRuntime.create`, si la entidad tiene un creador `@createDetails`, obtiene de `Manifest.OPS` la declaración, bloquea con `SELECT ... FOR UPDATE` la cabecera existente y ejecuta `COUNT(*)` de los hijos dentro de `dispatch()` `@Transactional`. Solo inserta si hay espacio; un documento lleno devuelve HTTP **409**, una cabecera inexistente **400**.
- **NestJS:** determina la misma vinculación desde el manifiesto compilado y habilita una conexión dedicada con `BEGIN/COMMIT/ROLLBACK` para el POST directo, `SELECT ... FOR UPDATE` del documento y `COUNT(*)` antes de `INSERT`. Los POST anidados originales mantienen su transacción y su comprobación previa de 1..20 entradas.
- **Sin hardcode de dominio:** el runtime usa nombres de entidades, claves, relaciones y límites ya emitidos por el compilador del contrato, no conocimiento específico de órdenes ni productos.
- El límite se verifica por **documento**, no mediante un contador global de filas.

## Evidencia de ejecución

El workflow `vnext-b17-bounded-detail-append.yml` genera por separado las apps completas de Spring y NestJS desde el **mismo TypeSpec B16**, compila/verifica la app con PostgreSQL y ejecuta el oráculo HTTP/Chromium real.

En **ambos backends**:
- `PROTOCOLIA_GENERATED_COMPOSE_TEST_PASS` — PASS.
- `PROTOCOLIA_B16_MULTI_FIELD_CHROMIUM_PASS` — PASS; preserva la interfaz y la edición anterior.
- `PROTOCOLIA_B17_BOUNDED_APPEND_PASS` — PASS, con `directAppendAllowedBelowLimit:true`, `twentyFirstRejected:true`, `finalSlotRaceOneWinner:true`, `fullDocumentSumFromSql:true`, `noOrphans:true`.
- `PROTOCOLIA_B16_TWO_FIELD_CAS_PASS` — PASS; se preservan los cambios auditados por campo, el rechazo de ediciones obsoletas y los permisos existentes.

El ensayo incluye documento completo con 20 hijos y rechazo de la fila 21, alta correcta por POST directo sobre documento con lugar, rechazo de padre inexistente y dos POST simultáneos sobre un documento con 19 hijos (**uno 201, otro 409**), terminando con 20 filas contadas en PostgreSQL.

## Limitaciones expresas: B17 todavía no está completo

Este cambio garantiza el **límite de cantidad** bajo concurrencia y la integridad FK para alta directa, no una semántica empresarial completa de modificación de documentos.

- **NO** implementa control optimista `expectedVersion` sobre la cabecera.
- **NO** audita los POST directos de hijos, ni añade DELETE/reemplazo de renglones.
- **NO** valida el permiso de escritura de la cabecera para el POST de un hijo (conserva el contrato actual de permisos del hijo).
- **NO** protege una edición de un renglón existente con una versión global del documento; B16 continúa haciendo CAS por campo.
- **NO** implementa estados/confirmación, cálculos monetarios decimales ni bloqueo por propietario.

**Próxima fase:** incorporar un contrato explícito de mutación de la colección con `expectedVersion` y versionado persistido; un único protocolo de bloqueo, permisos sobre cabecera e hijo, auditoría transaccional para altas y bajas, casos de concurrencia entre agregar/quitar/editar y UI generada que recargue conflictos. Una vez completado, evaluar contra requisitos independientes congelados en un dominio nuevo.

No fusionar a `main` sin autorización.
