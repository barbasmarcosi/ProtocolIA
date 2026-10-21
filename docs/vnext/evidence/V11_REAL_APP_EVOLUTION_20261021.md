# ProtocolIA v1.1 — evolución real y preservación del PostgreSQL existente

**Fecha:** 2026-10-21  
**Alcance:** prueba de aplicación completa en **proyecto Compose efímero**, NO despliegue productivo.  
**PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), rama `feature/v1.1-generic-if-match-conformance-20261020` (**Draft**).  
**Commit funcional:** `90eb09fdf30b14f26edcee30d396d5f1c0c0e952`  
**CI funcional y regresiones:** [GitHub Actions #39546957519](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39546957519) — **SUCCESS**, Spring Boot y NestJS.  
**Quality:** [#39546960344](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39546960344) y [#39546957575](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39546957575) — **SUCCESS**.

## Qué se demostró

La entrega anterior [V11_DATABASE_CHECKPOINT_RESTORE_20261021.md](V11_DATABASE_CHECKPOINT_RESTORE_20261021.md) prueba una copia física restaurable de PostgreSQL. El siguiente [preflight offline](V11_DATABASE_PREFLIGHT_20261021.md) valida el SQL derivado de TypeSpec sobre una copia aislada.

Este incremento añade la prueba faltante: **regeneración y arranque de la aplicación con el nuevo contrato contra el volumen PostgreSQL ya poblado**.

Oráculo: `scripts/vnext/probe-db-checkpoint.mjs`, integrado en el workflow `.github/workflows/v11-generic-if-match.yml`.

1. Genera una aplicación real desde `examples/vnext/dynamic-order-versioned` para **NestJS** y, de forma independiente, **modular-spring**. Levanta un proyecto Compose temporal con un volumen persistente dentro de ese proyecto.
2. Crea la orden `RETAINED` con dos renglones y agrega un tercero vía `If-Match: "1"`: el documento termina en versión 2; se constatan sus datos, relaciones y eventos de auditoría.
3. Genera un checkpoint `pg_dump -Fc`, valida su hash, ejecuta el preflight del contrato `examples/vnext/dynamic-order-versioned-additive` dentro de un PostgreSQL separado `--network none` y verifica que los datos históricos no cambien.
4. Rechaza un contrato incompatible y un respaldo asociado a un contrato distinto; **no** acepta sobrescribir reportes anteriores.
5. Ejecuta el **CLI real** `protocolia evolve`, usando la misma aplicación generada. Verifica que el `contractSha256` de la salida cambie y que aparezca un archivo de migración adicional, conservando las versiones anteriores.
6. Regenera la imagen y recrea **exclusivamente el contenedor app** mediante `docker compose up -d --no-deps --build --force-recreate app`, dentro del proyecto de prueba. Comprueba que el ID del contenedor PostgreSQL permanezca idéntico; no se recrea el volumen ni se ejecuta `down -v` antes de la comprobación.
7. Tras la inicialización del nuevo backend y la migración de esquema, compara **exactamente** cabecera histórica, renglones y conteos de auditoría anteriores. Verifica que la columna opcional `note` exista.
8. Comprueba el historial de migraciones: NestJS conserva el baseline y registra `V2__protocolia_additive.sql`; Spring conserva `V1__contract_baseline.sql` y el contenido exacto de `V2__protocolia_bff_http_session.sql`, y registra `V3__protocolia_additive.sql` en Flyway.
9. Crea una orden con `note` y confirma que el nuevo backend **persiste** ese campo. Agrega un cuarto renglón al documento anterior con `If-Match: "2"`: obtiene 201, el documento pasa a versión 3 y la auditoría aumenta.
10. Restaura el checkpoint inicial en **otra** base de prueba, prueba un cambio aditivo y uno incompatible con rollback transaccional, y verifica que nada de ese ensayo altere el estado ya actualizado de la base principal del proyecto temporal.
11. Por último, elimina el proyecto Compose y todos sus volúmenes **exclusivamente de pruebas**, utilizando el nombre generado aleatoriamente por el propio script.

## Matriz y evidencia

| Aserción sobre aplicación real | NestJS | Spring Boot |
|---|---|---|
| Backup validado por SHA-256 y restauración en copia | PASS | PASS |
| Preflight TypeSpec SQL con datos antiguos | PASS | PASS |
| Contrato incompatible y respaldo de otra fuente rechazados | PASS | PASS |
| `app:evolve` produce migración aditiva | V2 | V3 |
| Versiones históricas inalteradas | PASS | PASS, incluyendo V2 BFF |
| PostgreSQL original sigue en el mismo contenedor | PASS | PASS |
| Arranque del backend regenerado | PASS | PASS |
| Datos y auditoría históricos intactos | PASS | PASS |
| Nuevo campo `note` persistido | PASS | PASS |
| Alta auditada posterior con CAS `If-Match` | PASS | PASS |
| Regresiones HTTP, React/Chromium y contrato no versionado | PASS | PASS |

**Marcador emitido por ambos jobs:** `PROTOCOLIA_V11_APP_EVOLUTION_PASS`, con `databaseContainerUnchanged`, `preexistingRowsPreserved`, `preexistingJournalPreserved`, `newFieldPersisted`, `postUpgradeAuditedWrite` y `versionEtagsContinue` a `true`.

## Procedimiento humano sugerido (no automático en instalaciones reales)

```sh
# 1. Revisar que el contrato nuevo sea compatible y el SQL derivado.
npm run app:plan -- /ruta/contratos-nuevos /ruta/aplicacion-existente

# 2. Tomar un backup fuera del directorio generado; guardarlo además fuera del servidor.
npm run app:db:checkpoint -- /ruta/aplicacion-existente \
  --project proyecto_compose_existente \
  --env-file /ruta/credenciales/compose.env \
  --out /ruta/segura/checkpoint.dump

# 3. Ensayar el SQL real sobre una copia aislada del backup.
npm run app:db:preflight -- /ruta/contratos-nuevos /ruta/aplicacion-existente \
  --checkpoint /ruta/segura/checkpoint.dump \
  --report /ruta/segura/preflight.json

# 4. Tras revisión humana, mantenimiento y ensayo de recuperación:
npm run app:evolve -- /ruta/contratos-nuevos /ruta/aplicacion-existente

# 5. Desplegar, observar logs y validar datos y operaciones del backend actualizado.
# No utilizar 'docker compose down --volumes' sobre una instalación con datos.
```

## Restricciones y riesgos no eliminados

- El incremento **no actualiza instalaciones externas por sí mismo**. Solo los datos de una base efímera creada por el test se migraron realmente.
- El preflight SQL verifica conteos y sumas acotadas de hashes sobre columnas originales. No constituye una prueba criptográfica fila a fila ni cubre toda la semántica de negocio o carga real de producción.
- No existe aún una aprobación firmada, identidad fuerte de instancia o enforcement que haga obligatorio un reporte de preflight válido en `app:evolve`; no se debe considerar un gate de producción infalible.
- `app:evolve` conserva un snapshot de **archivos de aplicación**, no una recuperación automática del PostgreSQL. Una aplicación antigua puede ser incompatible con un esquema ya actualizado.
- Se han probado cambios **aditivos** en el perfil descrito, no transformaciones destructivas, cambios de FK/tipo/identidad, reescritura de datos, rollback de migraciones ni upgrades con escrituras concurrentes.
- Una operación real requiere ventana de mantenimiento, plan de reversión con pérdida de cambios evaluada, respaldo cifrado externo, control de acceso, monitoreo y revisión de DBA.
- El tag `v1.0.0` y `main` siguen inalterados. El trabajo permanece en Draft para evolución de v1.1.

## Próximo incremento recomendado

Fortalecer el **vínculo verificable** entre el reporte de preflight y el SQL que instalará `app:evolve`; impedir uso inadvertido de reportes antiguos, de otra aplicación o de migraciones modificadas, y sumar un ensayo de startup fallido con rollback transaccional del esquema.
