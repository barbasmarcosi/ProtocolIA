# ProtocolIA v1.1 — Editor React de reemplazo íntegro de renglones

**Fecha:** 2026-10-21 (Argentina)  
**Rama:** `feature/v1.1-generic-if-match-conformance-20261020`  
**PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55) (Draft; `main` y el tag `v1.0.0` permanecen sin cambios).  
**Commit funcional verificado:** `b2ea2f5635d9881eb2c4d942a66e833d2ce7ab49`  
**Integración PostgreSQL + Chromium:** [GitHub Actions #39540625431](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39540625431) — **SUCCESS**, NestJS y modular Spring.  
**Quality:** [#39540629417](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39540629417) y [#39540625463](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39540625463) — **SUCCESS**.

## Qué se genera

Una aplicación cuyo TypeSpec declara `@createDetails`, `@versionedDetails` y el comportamiento `@replaceDetails` presenta un editor visual genérico para reemplazar **la colección entera de renglones**. Reutiliza la misma plantilla React de ambos targets, en `packages/adapters/modular/templates/web/src/App.jsx`. No se creó una implementación específica para PurchaseOrder, OrderLine o sus rutas.

La opción **Editar colección completa** se muestra solamente cuando el usuario está autorizado para la consulta del detalle y para **escribir cabecera, crear hijo, eliminar hijo y ejecutar el reemplazo**. En documentos cerrados permanece visible pero deshabilitada. Todo rechazo de autorización se valida de nuevo en el backend; ocultar el control no constituye autorización.

Al entrar en edición:

1. Se obtiene y comprueba `documentVersion` y el `ETag` fuerte desde la cabecera.
2. Se consulta la lista completa mediante `queryPage` filtrada por la FK obligatoria, con límite `maxRows` del contrato. Se valida longitud, conteo, identidad y pertenencia de todos los elementos; **no se rellena el borrador con una página parcial**.
3. Se obtiene nuevamente el ETag de cabecera y se compara con el primero y con la versión mostrada. Si cambió, el editor rechaza crear un snapshot silenciosamente incorrecto.
4. El formulario de los `1..maxRows` renglones reutiliza `FormField`, `validateCreate` y `normalizePayload` para respetar tipos, identidad, restricciones y campos editables. Se detectan identidades repetidas y se impide eliminar la última fila.
5. **Revisar reemplazo** no ejecuta escrituras. Presenta una confirmación explícita advirtiendo que se eliminará y sustituirá **toda** la colección y no solo los campos tocados.
6. **Confirmar reemplazo** emite un único PUT JSON por el endpoint derivado de `replaceDetails`, con `If-Match: "N"` de la versión original del borrador.
7. En éxito se descarta el borrador, se refrescan detalles, versión, resumen SQL y paginación. En **409 Conflict** se preserva el borrador, se impiden nuevas escrituras obsoletas y se pide actualizar el documento. El refresco **no rebasa automáticamente** el borrador sobre una nueva versión; se exige descartarlo y volver a cargar para reintentar conscientemente.
8. CSS responsive genérico para la edición y confirmación, con anuncios `role="alert"` de errores y estados de operaciones.

## Pruebas automatizadas que pasaron

El workflow `.github/workflows/v11-generic-if-match.yml` ejecutó con éxito, para **ambos** targets:

- Generación real TypeSpec → backend + frontend.
- `npm run app:test` contra PostgreSQL efímero para contrato versionado.
- Suite HTTP de B17 sobre PostgreSQL real que comprueba auditoría, límites, conflictos, rollback y cierre.
- Chromium a 390 × 844 px interactuando con el editor **generado** desde React.
- Generación adicional de contrato **no versionado** y ejecución del mismo `app:test`.

Marcador reproducible emitido por ambos jobs:

```json
PROTOCOLIA_V11_BULK_REACT_PASS {
  "completeBeyondPage": true,
  "explicitReview": true,
  "putStrongETag": true,
  "replacesAtomically": true,
  "stalePut409": true,
  "refreshNeverRebases": true,
  "draftPreservedOnConflict": true,
  "manualReloadAndRetry": true,
  "serverAggregateCorrect": true
}
```

Escenario Browser:
- Cabecera con nueve renglones frente a página de lectura de siete: se editan los nueve, se elimina uno y se agrega uno nuevo.
- **Antes de confirmar** la fila anterior todavía existe en la base.
- Confirmación produce un solo PUT 200 `If-Match: "1"`; se audita el reemplazo, la nueva fila existe, la eliminada devuelve 404 y el total SQL es **12**.
- Otro cliente agrega un renglón y cambia la versión a 3. Un PUT con versión 2 devuelve **409**; el borrador sigue visible.
- Tras actualizar la versión, la UI conserva el texto del borrador pero **no permite confirmar** su contenido antiguo. Se descarta y carga la nueva colección, ya de diez filas, y un nuevo PUT 200 versiona a 4. El total SQL es **13**.
- Al iniciar sesión como usuario con escritura del hijo pero no de la cabecera, el editor por lotes **no aparece**.
- Al cerrar una orden con transición terminal, el editor por lotes queda **deshabilitado**.
- La suite base sigue publicando `PROTOCOLIA_B17_VERSIONED_REACT_PASS` y `PROTOCOLIA_B17_BOUNDED_REPLACE_PASS` en ambos backends.

## Límites

- El PUT realiza reemplazo **físico y total** según contrato; no es una operación de diff inteligente ni de combinación de cambios. Si hay referencias externas con restricciones, el backend puede rechazar y revertir íntegramente la operación.
- El frontend presenta una captura consistente mediante comparación doble del ETag; esa captura no implica transacción de lectura multi-GET, pero se rechaza todo cambio entre las dos lecturas y el PUT usa CAS documental.
- La prueba del navegador cubre 390px y acciones funcionales. No es una auditoría de accesibilidad completa ni una revisión humana de todas las resoluciones.
- Borradores son estado React en memoria, sin persistencia local entre cierres de la pantalla o recargas.
- **No se realizaron aún migraciones in-place ni backups de bases existentes.** En producción esta funcionalidad debe evaluarse junto a las garantías operativas y de seguridad.

## Próximo bloque

Desarrollar migraciones de esquema verificables en dos fases (inspección/dry-run y aplicación segura con respaldo comprobable) y expandir la conformance genérica sin duplicar las pruebas exhaustivas de B17. No modificar el tag `v1.0.0`; mantener el PR #55 en Draft mientras v1.1 siga en desarrollo.
