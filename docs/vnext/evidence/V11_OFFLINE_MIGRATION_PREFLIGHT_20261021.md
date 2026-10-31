> **Historical evidence notice (2026-10-21):** This document describes the earlier preflight/report behavior at the linked historical commit. Since v1.1g, the preflight uses sorted per-row SHA-256 multiset attestation and the verified evolution gate requires report `schema=2`. See [v1.1g evidence](V11_CRYPTOGRAPHIC_ROW_ATTESTATION_20261021.md). Statements here about non-cryptographic hashes or `schema=1` are **superseded**, not current claims.

# ProtocolIA v1.1d — Preflight de migraciones contra backup restaurado y aislado

**Fecha:** 2026-10-21. **PR:** [#55](https://github.com/barbasmarcosi/ProtocolIA/pull/55), Draft.
**Commit funcional probado:** `92e47a0e2b210ef1709e4b5c67fe849daefddece`.
**CI real:** [#39545054407](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39545054407) — **SUCCESS** en NestJS y modular Spring, PostgreSQL 16.15 y Chromium, con marcador `PROTOCOLIA_V11_DB_PREFLIGHT_PASS`.
**Quality:** [#39545056961](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39545056961) y [#39545054460](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39545054460) — **SUCCESS**.

## Qué resuelve

Hasta B17.6a se podía extraer un `pg_dump -Fc` verificado y restaurarlo mediante ensayos especializados. `app:plan` podía mostrar el SQL de evolución aditiva, pero **no ejecutarlo automáticamente sobre registros reales sin tocar la instalación de origen**.

En v1.1d la nueva orden `app:db:preflight` conecta tres componentes existentes: el sello de propiedad de la aplicación generada, el manifiesto SHA-256 del checkpoint y el motor de contratos `diffContracts` + `validateOpenApiEvolution` + `additiveSql`. El SQL aplicado es **exactamente el que sale de la diferencia semántica TypeSpec**, nunca una sentencia arbitraria del usuario.

## Uso

Antes de aplicar cambios, tomar el respaldo y ensayar una restauración en una instalación separada:

```sh
npm run app:db:checkpoint -- /ruta/app-generada \
  --project compose-existente \
  --env-file /ruta/privada/compose.env \
  --out /ruta/privada/backup/ordenes.dump

npm run app:db:verify -- /ruta/privada/backup/ordenes.dump

# El nuevo contrato contiene únicamente cambios declarativos compatibles.
npm run app:db:preflight -- /ruta/TypeSpec-nuevo /ruta/app-generada \
  --checkpoint /ruta/privada/backup/ordenes.dump \
  --report /ruta/privada/backup/preflight-ordenes.json
```

El informe JSON **no contiene filas ni contraseñas**; aporta versión del formato, `status=pass`, adapter, digest del contrato original, digest del respaldo, digest del SQL propuesto, conteo de cambios y cantidad de tablas/filas revisadas. El nombre de informe debe ser nuevo y estar fuera del árbol del contrato y de la app. No se permite sobrescribir uno anterior.

## Garantías implementadas

1. **Validación previa:** la app debe tener sello de propiedad intacto; el respaldo debe superar `app:db:verify`, ser del **mismo target y hash de contrato** que la app. El contrato nuevo debe compilar a IR/OpenAPI sin drift no declarado y superar `diffContracts`.
2. **Sin acceso a la base de origen:** solo se lee el archivo de backup local. El preflight no conoce la URL/credenciales del servidor original y nunca ejecuta el Docker Compose de la instalación existente.
3. **Aislamiento:** arranca un contenedor PostgreSQL efímero con `--network none`, proyecto/nombre aleatorio, usuario/contraseña independientes y volumen temporal que se elimina al final. No se monta ningún volumen ni directorio de la instalación original.
4. **Restauración verificable:** se espera que finalice la inicialización oficial de PostgreSQL (evitando el falso positivo del servidor temporal `initdb`); se restaura el archivo custom mediante `pg_restore --single-transaction --exit-on-error`.
5. **SQL auténtico:** `additiveSql` genera el SQL del contrato TypeSpec y se ejecuta con `psql -1 -v ON_ERROR_STOP=1`. Un DDL fallido rechaza el preflight; PostgreSQL revierte la transacción.
6. **Conservación de datos:** antes de migrar se enumeran tablas/campos públicos y se capturan conteos y resúmenes hash acotados por tabla. Después se comprueban **todas las columnas originales**, el mismo número de filas y el mismo resumen de datos, incluyendo eventos de auditoría y journals de migración.
7. **Cierre seguro:** el contenedor y su volumen efímero se eliminan al salir, también si el SQL falla. Solo tras éxito se crea un informe con `status:"pass"` mediante escritura `wx` y permisos de propietario. No se emite aprobación ante contratos incompatibles, archivo corrupto, desajuste de origen o error SQL.

### Límites explícitos

- El resumen de datos usa una agregación fija de hashes PostgreSQL de 64 bits: **no es una prueba criptográfica de equivalencia fila por fila**. Es una señal de regresión, combinada con los conteos y las garantías de PostgreSQL sobre DDL transaccional.
- El preflight ensaya **el SQL aditivo de una evolución compatible**, no el arranque completo de la nueva aplicación ni cada consulta de negocio sobre ella.
- No hay mecanismo universal para migraciones destructivas, cambios de semántica, backfills complejos o conversiones de tipos que requieran lógica de negocio. El motor las bloquea.
- Un preflight exitoso no prueba que la base de origen permanezca sin cambios después del respaldo. Para desplegar: restringir nuevas escrituras, actualizar el checkpoint y repetir el ensayo, mantener backup remoto protegido y verificar rollback/restore.
- **No ejecutar el preflight ni los respaldos sobre datos sensibles sin almacenamiento cifrado, reglas de acceso/retención, DBA y plan de recuperación real.** Un SHA-256 local sin firma no impide falsificación del archivo y manifiesto por una misma persona con acceso a ambos.

## Pruebas con datos históricos reales

La matriz [#39545054407](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39545054407) ejercitó la funcionalidad en los dos objetivos. Partió de una app generada con el contrato versionado original; creó una orden real, tres renglones con unidades y un registro auditado; extrajo el archivo custom PostgreSQL y ejecutó:

- **Positivo:** compilación de `examples/vnext/dynamic-order-versioned-additive`, que añade un campo opcional `note` a PurchaseOrder y al DTO de creación; comparación IR/OpenAPI, restauración offline desde el backup, ejecución de `ALTER TABLE purchase_order ADD COLUMN ...`, preservación de filas, versiones y auditoría. Emite `PROTOCOLIA_DB_PREFLIGHT_PASS`.
- **Incompatible:** `examples/vnext/dynamic-order-versioned-breaking`, que estrecha `@maxLength(120)` a 119 en un campo existente, es rechazado por la validación de contrato; no se publica un informe PASS.
- **Archivo equivocado:** copia de backup cuyo manifiesto declara otro digest de contrato; se rechaza sin tocar la DB origen.
- **No sobrescritura:** se rechaza un segundo preflight con el mismo nombre de reporte.
- **Regresión:** el backup sigue restaurándose también por el ensayo anterior, los INSERT/GET/auditoría/PUT/React de B17 funcionan y la app generada no versionada pasa `app:test` en ambos targets.

```
PROTOCOLIA_V11_DB_PREFLIGHT_PASS {
  "migrationSqlFromTypeSpec":true,
  "isolatedPostgresNoNetwork":true,
  "restoredOldData":true,
  "allExistingRowsPreserved":true,
  "sqlDigestBoundToReport":true,
  "noAutoDeploy":true,
  "wrongContractRejected":true,
  "wrongSourceSnapshotRejected":true,
  "noOverwrite":true,
  "originalDatabaseUntouched":true
}
```

Se corrigió además la lista de archivos autorizados para evolución Nest, añadiendo **solo** `src/BffSession.ts` y `src/BffKeyring.ts`, que ya eran componentes generados y sellados. **No** se desactivó el control de archivos desconocidos.

## Próximo incremento

**v1.1e:** instrumentar una simulación de **arranque del runtime nuevo** en la base ya migrada, contrastar ledger Flyway/Nest, operaciones de negocio críticas y estimar locks/tiempos para bases grandes. Luego, preparar procedimientos de despliegue, rollback y restauración por entorno; las transformaciones incompatibles deben mantenerse bloqueadas hasta contar con perfiles y oráculos específicos.

Mantener `main` y `v1.0.0` inmóviles y PR #55 en Draft.
