# v1.1 — Checkpoints PostgreSQL y evolución aditiva respaldada

**Fecha:** 2026-10-21  
**Estado:** rama `feature/v1.1-generic-if-match-conformance-20261020`, [PR #55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), **Draft**. El tag `v1.0.0` y `main` no se modificaron.

## Contexto

ProtocolIA ya incorporaba `app:plan` y `app:evolve` para cambios **estrictamente aditivos**. El motor `packages/cli/regeneration.mjs` impide eliminación de entidades/campos, alteración de rutas/capacidades, cambio de identidad, modificación arbitraria de tipos, y cambios OpenAPI no declarados. Una evolución compatible genera una migración con versión nueva, preservando V1 y las anteriores:

- **Spring:** migraciones SQL Flyway `V1__`, `V2__`, etc.
- **Nest:** esquema inicial `src/schema.sql`, diario `protocolia_schema_history`, migraciones `src/migrations/V2__...` con checksums en `protocolia_nest_migration_history`, transacción y advisory lock.

El problema residual era **operativo**: poder producir y verificar un backup antes de desplegar la nueva versión, y ensayar su restauración sin alterar la base original.

## Nuevos comandos

Desde el repositorio donde se desarrolla v1.1:

```sh
# Vista previa del cambio TypeSpec -> SQL; NO ejecuta DDL.
npm run app:plan -- /ruta/proyecto-TypeSpec /ruta/app-generada

# Se apunta exclusivamente al proyecto Compose ya existente y en ejecución.
# Los archivos se crean en una ubicación SEGURA y AJENA a la app generada.
npm run app:db:checkpoint -- /ruta/app-generada \
  --project nombre_compose_existente \
  --env-file /ruta/privada/compose.env \
  --out /ruta/privada/backup/protocolia-20261021.dump

# Comprueba SHA-256, tamaño, permisos y formato del archivo contra su manifiesto.
npm run app:db:verify -- /ruta/privada/backup/protocolia-20261021.dump

# SOLO después de verificar una restauración y hacer mantenimiento:
npm run app:evolve -- /ruta/proyecto-TypeSpec /ruta/app-generada
```

`app:plan` ahora emite `PROTOCOLIA_EVOLUTION_SQL_PREVIEW` con SQL generado, cantidad de sentencias y digest SHA-256, sin tocar la base. Los cambios incompatibles siguen fallando antes de generar/aplicar la migración.

El comando `app:db:checkpoint` exige proyecto Compose y archivo de entorno **explícitos** (sin inferir instancias por defecto). Verifica el sello de propiedad de la aplicación generada, exige una base ya en ejecución, y ejecuta `pg_dump` en formato custom. Nunca crea, reinicia, detiene, restaura o modifica la base del usuario. No reemplaza archivos existentes. Escribe el archivo con permisos solo de propietario y un manifiesto `.dump.json` con metadatos mínimos y SHA-256. Se valida el índice del archivo mediante `pg_restore --list`.

`app:db:verify` comprueba integridad de bytes y formato, **no demuestra por sí solo que todos los datos pueden restaurarse**. El SHA-256 sin firma no protege de un adversario capaz de alterar simultáneamente el backup y el manifiesto.

## Procedimiento recomendado antes de un despliegue

1. Definir una ventana de mantenimiento, evitar nuevas escrituras, confirmar espacio libre y la estrategia de recuperación.
2. Ejecutar `app:plan`; revisar el SQL y que el cambio sea aditivo. Un cambio fuera de los perfiles permitidos debe requerir una migración dedicada y revisión profesional.
3. Tomar el checkpoint; moverlo a almacenamiento seguro fuera del servidor, cifrarlo y proteger claves y acceso. El dump puede contener **datos personales, credenciales de sesión y auditorías**; **no subirlo a GitHub ni a artefactos de CI**.
4. **Restaurar en un PostgreSQL separado** (preferentemente servidor aislado), verificar consultas de negocio, conteos, auditoría, claves foráneas, versión y los registros de migraciones. Hacer una recuperación real ensayada.
5. Ejecutar `app:evolve` para regenerar la aplicación en forma escalonada, conservando el esquema inicial. Su snapshot `.protocolia-backup-...` es **respaldo de archivos de aplicación**, no de la base de datos.
6. Reiniciar/desplegar la app durante el mantenimiento: en ese momento Spring/Flyway o Nest ejecutarán las migraciones de esquema pendientes.
7. Validar salud, logs de migraciones, totales de filas, datos históricos, auditoría y operaciones clave. Ante fallo, **no** intentar simplemente ejecutar la versión vieja sobre una base ya migrada; planificar restauración desde el checkpoint de manera separada.

No se ejecuta ninguna restauración productiva automáticamente. Tampoco existe aún un rollback universal automático de cambios arbitrarios de esquema.

## Evidencia real de CI

[GitHub Actions #39542741773](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39542741773) terminó **SUCCESS** en los dos targets `nestjs` y `modular-spring`.

Los dos jobs emitieron `PROTOCOLIA_V11_DB_BACKUP_RESTORE_PASS` y comprobaron:

- Se generó una aplicación real a partir del contrato TypeSpec de órdenes versionadas y se inició PostgreSQL efímero.
- Se crearon cabeceras, hijos y eventos auditados.
- Se generó un backup de la base con `pg_dump -Fc`, se comprobó checksum y se rechazó la sobrescritura.
- El archivo se **restauró por completo a otra base vacía**, sin cambiar el volumen original.
- Las consultas de datos, versiones, colecciones y auditoría devolvieron **exactamente los mismos valores** que antes de la restauración.
- Se aplicó en la copia restaurada una evolución SQL aditiva; los datos anteriores permanecieron.
- Se intentó instalar una restricción incompatible dentro de una transacción después de añadir una columna temporal: PostgreSQL revirtió toda la transacción, la columna temporal no quedó instalada y ningún dato cambió.
- Un archivo modificado después del checkpoint falló la verificación de integridad.
- Los comandos anteriores `app:test`, la UI React versionada/bulk y el contrato histórico sin versionado siguieron pasando.

Se probaron también los argumentos fail-closed y comprobaciones de archivo mediante `tests/vnext/database-checkpoint.test.mjs`.

## Alcance real de esta entrega

Se implementó un **checkpoint explícito, read-only y ensayado**, combinado con el motor aditivo preexistente. No es todavía un sistema de migración universal: no habilita alterar libremente entidades, relaciones, claves, tipos o permisos; no realiza una sustitución in-place entre contratos versionados incompatibles ni gestiona backups externos/cloud o política de retención. Antes de operar con datos reales se requiere revisión de DBA/seguridad, backup cifrado externo y ensayo de restauración sobre un entorno independiente.

**Próximos incrementos:** preflight automatizado contra un clon de la base con SQL real generado, evaluación de migraciones de contratos con límites/versionado, y estrategia de rollback verificada para cada nueva clase de cambio.
