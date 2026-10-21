# ProtocolIA v1.1 — preflight SQL de migración sin acceso a producción

**Fecha:** 2026-10-21  
**Matriz inicial de aceptación:** [#39545054407](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39545054407) — PASS NestJS y Spring Boot; reforzada por [#39546957519](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39546957519).  
**Rama:** `feature/v1.1-generic-if-match-conformance-20261020`, [PR #55](https://github.com/barbasmarcosi/ProtocolIA/pull/55) Draft.

## Problema resuelto

Un checksum correcto de `pg_dump` permite detectar corrupción del archivo pero no demuestra que **un cambio TypeSpec se puede instalar sobre datos históricos**. Este incremento incorpora un ensayo del SQL aditivo sobre una copia aislada de la base y deja evidencia explícita de compatibilidad antes de la regeneración de la aplicación.

## Operación

```sh
npm run app:db:preflight -- /ruta/contratos-nuevos /ruta/aplicacion-existente \
  --checkpoint /ruta/segura/checkpoint.dump \
  --report /ruta/segura/preflight.json
```

El comando en `packages/cli/database-preflight.mjs` aplica los siguientes controles:

1. Validación de rutas, manifiesto sellado de generación e integridad SHA-256 del archivo `pg_dump -Fc`. El `target` y `contractSha256` originales deben coincidir con la aplicación de entrada. El reporte debe crearse fuera de los árboles generados, sin sobrescribir otro archivo.
2. Reutilización del motor de compatibilidad TypeSpec (`app:plan`) y de su función `additiveSql`, compartida con `app:evolve`. Los cambios incompatibles no son ensayados como si fueran válidos.
3. PostgreSQL oficial `postgres:16.15-alpine` en **nuevo contenedor aleatorio** con `--network none`, volumen separado, límites de CPU/memoria y sin montar el volumen ni archivos de la instalación original.
4. Espera de la **inicialización completa del servidor PostgreSQL**, no del servidor efímero que el contenedor emplea mientras ejecuta `initdb`; restauración del archivo custom en transacción, sin owner ni ACL.
5. Conteos de filas y resúmenes de contenido de **todas las tablas originales** y sus columnas originales, obtenidos antes de la ejecución del SQL, y comparación después de la migración. Si una tabla desaparece o cambia su contenido histórico, se rechaza.
6. Ejecución del SQL real derivado de IR mediante `psql -1 -v ON_ERROR_STOP=1`: una sentencia inválida fuerza rollback de toda la transacción.
7. Emisión de reporte `preflight.json` solo si todos los pasos concluyen. Incluye target, SHA-256 de contrato original, backup y SQL propuesto, tablas/filas comprobadas, imagen, aislamiento y tiempo. No incluye contraseñas ni contenido de filas.
8. Eliminación del contenedor y volumen *exclusivamente temporales* incluso tras un error.

## Evidencia

El oráculo `scripts/vnext/probe-db-checkpoint.mjs` inicia una aplicación generada, crea y audita datos históricos, toma un checkpoint y ejecuta el preflight con un contrato aditivo independiente.

Pruebas en ambos targets:
- `PROTOCOLIA_V11_DB_PREFLIGHT_PASS`: SQL real derivado de TypeSpec, datos restaurados, tablas/filas conservadas, sin acceso a la base original.
- Contrato con restricción existente incompatible (maxLength más estrecho): rechazo.
- Backup que conserva los bytes pero declara un `contractSha256` diferente: rechazo.
- Intento de sobrescribir un reporte: rechazo.
- Comparación de datos del contenedor original antes y después del ensayo.
- Ensayo con la misma base tras una regeneración y arranque reales en la matriz posterior: [V11_REAL_APP_EVOLUTION_20261021.md](V11_REAL_APP_EVOLUTION_20261021.md).

## Qué no demuestra

El hash de filas es un resumen estadístico de contenido, **no una prueba criptográfica individual ni semántica**. El preflight no prueba rendimiento bajo carga, compatibilidad de todos los consumidores, bloqueos en producción, políticas de autorización por instancia ni restauración remota. Tampoco despliega automáticamente ni obliga a `app:evolve` a verificar el reporte. Para uso productivo hacen falta ventana de mantenimiento, respaldo cifrado fuera del servidor y restauración independiente.

El hito v1.0.0 permanece congelado en `main`; esta evidencia forma parte del PR #55.
