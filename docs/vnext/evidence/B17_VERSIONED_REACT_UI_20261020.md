# B17.4 — UI React generada con concurrencia documental, edición y conflicto recuperable

**Fecha:** 2026-10-20  
**Base:** [B17.3a: versión optimista](B17_VERSIONED_DETAILS_20261020.md) y [B17.3b: DELETE auditado](B17_VERSIONED_DETAIL_DELETE_20261020.md).  
**Commit de frontend+oráculo verificado:** `368d04332dc35e26acda40127827ee80705133d8`.  
**Matriz funcional:** [GitHub Actions #39475649046](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39475649046) — **SUCCESS** (`nestjs` y `modular-spring`).  
**Quality:** [#39475649079](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39475649079) — **SUCCESS**.

## Objetivo

Transportar las capacidades del contrato TypeSpec `@versionedDetails` hasta los formularios reales **generados automáticamente por ProtocolIA**. Una API con versionado y auditoría no basta si un usuario no puede modificar renglones desde la interfaz o reintentar adecuadamente cuando otra sesión cambia el documento.

La implementación se encuentra en el **componente genérico** `packages/adapters/modular/templates/web/src/App.jsx`. Ambos generadores Spring/NestJS copian y compilan esa misma plantilla. No se incorporó una pantalla específica de `PurchaseOrder` ni se reprodujeron manualmente los componentes por backend.

## Flujo autogenerado

El manifiesto de UI propaga `operations.create.behavior.createDetails.versioned` desde TypeSpec.

Si es `true` y existe una consulta por FK explícita, la vista de cabecera:

1. Carga los renglones mediante `queryPage` filtrada por la FK de la orden, **nunca consultando una lista sin restricciones**, y consulta por GET la cabecera con autenticación. Comprueba que `documentVersion` sea un entero positivo y que coincida con `ETag: "N"`.
2. Muestra la versión de la orden y el número de renglones (1–20), con totales SQL reales en el componente de agregado preexistente.
3. Las **ediciones inline** conservan el CAS `expected` del campo y añaden `If-Match: "N"` a PATCH. Un éxito recarga la página de hijos, versión de la cabecera y total.
4. El formulario **Agregar renglón** se genera con los campos escribibles declarados del hijo y las validaciones TypeSpec existentes. La FK de la orden se asigna desde la cabecera activa, no a elección del usuario. POST utiliza `If-Match` y, tras commit, recarga los datos. El formulario se deshabilita al alcanzar `maxRows`.
5. **Eliminar** exige confirmación en el mismo renglón, llama al DELETE auditado con `If-Match`, ajusta la paginación si se elimina la última fila de la página y recarga los totales. Se deshabilita si queda un solo renglón.
6. Ante **409 Conflict**, la UI muestra un mensaje accesible con `role="alert"`, bloquea nuevas escrituras con la versión vieja y presenta **Actualizar orden**. La actualización recarga la versión del servidor y las filas; no se realiza un reintento automático potencialmente peligroso ni se oculta el borrador en curso.
7. El frontend **oculta las acciones de alta y baja** a quien no posee escritura tanto sobre cabecera como sobre hijo; el backend mantiene la comprobación definitiva.
8. Los contratos sin `@versionedDetails` continúan con el flujo B16, sin exigencia de `If-Match` ni nuevos controles de alta/baja en esta vista.

La presentación móvil incorpora clases `.document-version`, `.document-conflict`, `.detail-append` y `.detail-delete-confirm` con controles explícitos, enfoque semántico y zonas de acción adaptadas a pantallas pequeñas.

## Evidencia real: contratos, Docker, PostgreSQL y Chromium

El oráculo `scripts/vnext/probe-versioned-order-http.mjs` prueba una aplicación generada de cada adapter contra PostgreSQL real, utilizando Chromium a **390 × 844 px**. Se emplean entradas generadas desde el contrato TypeSpec, nunca HTML específico escrito para el caso de prueba.

Ejecución final [#39475649046](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39475649046): ambas matrices completaron `SUCCESS` y publicaron en sus logs:

```
PROTOCOLIA_B17_VERSIONED_REACT_PASS {"mobileViewport390":true,"stalePatch409":true,"conflictRecoveryRefresh":true,"generatedPatch":true,"generatedAppend":true,"generatedDelete":true,"strongIfMatchForwarded":true,"totalsUpdated":true,"lastRowDeleteDisabled":true,"capabilityActionsHidden":true,"consoleErrorsNone":true}
```

Además siguieron pasando `PROTOCOLIA_B17_VERSIONED_DETAILS_PASS` y `PROTOCOLIA_B17_VERSIONED_DELETE_PASS`.

### Escenarios de navegador validados

- Inicio de sesión de gerente desde React; navegación a **Órdenes**, apertura de un documento recién creado con 2 hijos y visualización de la versión 1.
- Apertura de edición del producto desde la UI; otro cliente agrega un hijo con versión 1. La UI envía PATCH con `If-Match: "1"`, recibe 409 y muestra el conflicto.
- El usuario activa **Actualizar orden**; la UI muestra versión 2 y libera las acciones. Guarda el cambio mediante PATCH con `If-Match: "2"`, recibe 200 y confirma versión 3.
- El usuario crea un renglón desde el formulario generado, verificando POST 201 y `If-Match: "3"`; la UI confirma versión 4.
- El usuario confirma la baja de un renglón desde React. DELETE 204 con `If-Match: "4"`; el hijo deja de existir, versión 5 y total SQL del documento correcto.
- Al abrir un documento con un solo renglón, el botón de eliminación se encuentra efectivamente **deshabilitado**.
- Tras cerrar sesión y acceder como un usuario con `lines.write` pero sin `orders.write`, la UI **no expone** los botones de alta y baja de renglones.
- No hay excepciones JavaScript de página durante estas operaciones.

### Capturas conservadas por CI

Los dos jobs cargan una captura de navegador **del frontend realmente generado**, retenida por GitHub Actions durante 7 días:

- [Captura 390 px — NestJS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39475649046/artifacts/12288753600).
- [Captura 390 px — Spring Boot](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39475649046/artifacts/12289805890).

Las capturas no contienen datos de producción; se capturan escenarios sintéticos. Tener una captura almacenada **no equivale** a una auditoría humana completa de diseño o accesibilidad.

## Limitaciones conocidas y trabajo pendiente

- La recopilación de cabecera y renglones utiliza dos GET autenticados en paralelo, no un snapshot de lectura atómico entre ambos. Si cambia el documento durante la carga, el servidor impide escrituras antiguas mediante 409 y la UI ofrece refrescar, pero el estado mostrado puede requerir actualización.
- No se ha ejecutado una matriz exhaustiva de accesibilidad (teclado/lector de pantalla), visual regression multiresolución ni pruebas completas de usuarios finales. El ensayo de navegador de este hito se centra en **390 px**.
- No existe reemplazo en bloque de una colección, ni cierre de orden, ni propiedad por instancia. La conformance genérica del CLI sigue siendo anterior al protocolo `If-Match`.
- No hay migración controlada de SQL de una aplicación ya desplegada: la evidencia corresponde a sistemas generados con esquemas limpios.
- El conflicto 409 exige que el usuario actualice y reevalúe el borrador: **no se fusionan automáticamente ediciones concurrentes**.
- El borrado sigue auditándose en la base antes del commit, pero la interfaz de auditoría por hijo depende de que el contrato incluya y autorice una operación `auditPage` específica. B17.4 no genera un explorador histórico universal.

**Próximo hito:** B17.5, especificación y validación de reemplazo acotado de colecciones / ciclo de vida de cabeceras y migraciones duraderas, además de adaptar la conformance genérica a If-Match. Mantener el PR #53 en Draft, main intacta.
