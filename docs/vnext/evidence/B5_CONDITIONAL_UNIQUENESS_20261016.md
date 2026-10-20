# ProtocolIA B5 — Unicidad de negocio condicionada por estado

**Fecha:** 16-10-2026. **Resultado:** ACCEPTED. **Commit funcional y pruebas:** `6593151b456e685504c933bf8c64da80ed6ddd54`, integrado en `independent/volunteer-evaluations`.

## Producto: TypeSpec → invariante transaccional automático

B3/B4 introdujeron unicidad compuesta y PATCH seguro bajo `UNIQUE` global. B5 agrega un comportamiento distinto: conservar documentos históricos y borradores duplicados, pero imponer que **sólo un registro de la misma combinación de negocio esté en un estado activo**.

El contrato independiente `examples/vnext/active-work-orders/contracts/main.tsp` declara:

```typespec
@entity
@uniqueWhen("siteCode,period","status","approved")
model WorkOrder {
  @publicIdentity @unique code: string;
  siteCode: string;
  period: string;
  @initial("draft") status: string;
}
```

Las operaciones `@transition("draft","approved")` y `@transition("approved","closed")` ya se generan y comprueban en ambos backends. El compilador valida `@uniqueWhen`, lo transporta al IR agnóstico y el adaptador genera:

```sql
CREATE UNIQUE INDEX uq_work_order_active
  ON work_order (site_code,period)
  WHERE status = 'approved';
```

La base impone la regla atómicamente también ante dos solicitudes simultáneas desde instancias distintas. No existe búsqueda previa `SELECT ...` expuesta a carreras. Un error PostgreSQL `23505` se convierte en HTTP `409`. En Spring se agregó el tratamiento específico de la transición, sin alterar los demás errores; Nest conserva el manejador genérico de errores SQL.

## Fail-closed y límites del perfil

- Una declaración por entidad, con **2 a 4** columnas distintas, requeridas, persistidas y no-null, diferentes de identidad pública y del campo de estado.
- El campo de estado debe ser una cadena requerida con `@initial` diferente del valor activo; el literal activo admite únicamente una gramática cerrada de valores seguros.
- Debe existir **exactamente una transición que entra** y otra **que sale** del estado activo. Las transiciones son operaciones de dominio autorizadas.
- Rechaza `@uniqueWhen` simultáneo a `@uniqueTogether` en la misma entidad y modificaciones directas por `patchFields` o `reassignReference` a los campos involucrados. Los adapters verifican también IR externo, para no aceptar declaraciones malformadas.
- No se acepta SQL inyectado ni expresiones arbitrarias en decoradores. No se implementa en este perfil índice único con múltiples estados, collation case-insensitive, condición temporal o cross-entity.
- No se modifica una base histórica automáticamente para crear un índice si tiene duplicados existentes. Un despliegue con datos poblados necesita análisis de colisiones, migración aditiva y procedimiento independiente.

## Evidencia real

- [B5 TypeSpec→NestJS y Spring, CI #38980920121](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38980920121): **SUCCESS** ambos targets. Generación de la aplicación completa con React, backend y schema; pruebas negativas TypeSpec/adapter; demo; Docker/PostgreSQL; HTTP autenticado.
- Marcador de ambos targets: `PROTOCOLIA_B5_PARTIAL_UNIQUE_PASS`. Los ensayos generan órdenes históricas, permiten dos borradores con la misma combinación, ejecutan aprobaciones simultáneas con exactamente un ganador y conflicto `409` para la otra; verifica rollback y persistencia del borrador perdedor. También aprueba combinación de otro sitio, cierra la orden activa, permite activar otra y repite la carrera sobre **8 solicitudes concurrentes** con exactamente **1 éxito y 7 conflictos**. Se verifica además que el índice existe realmente en `pg_indexes`, el conteo total no cambia y PostgreSQL conserva una sola fila activa por sitio/período.
- [Quality de rama #38980920140](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38980920140): **SUCCESS**.
- [Regresión independiente Bomberos #38981274923](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38981274923): **SUCCESS**, aplicaciones generadas desde el contrato independiente en Spring y NestJS + PostgreSQL/HTTP, Chromium NestJS.
- [Quality integrada #38981274915](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38981274915): **SUCCESS**, incluida Python 3.11/3.13, conformance y artefactos.
- Primera CI B5 #38980808673 falló durante la generación porque la instrucción `schema.push` / `sql.push` se colocó antes de inicializar el arreglo correspondiente. Se corrigió la ubicación después de los `CREATE TABLE` en ambos emisores y se repitió la matriz en verde. No se declaró PASS sobre la ejecución fallida.
- Fast-forward de `feature/b5-conditional-business-uniqueness-20261016` a `independent/volunteer-evaluations`, con verificación de ascendencia, `expected_sha=5f0ce5fdd7089c72c4a3dfef487299719edca1c6` y SHA funcional final `6593151b456e685504c933bf8c64da80ed6ddd54`.
- No se tocó `main`, no se fusionó PR #52 y no se modificaron los servicios persistentes de Railway/Neon.

## Siguiente valor de producto

Para ampliar lo que ProtocolIA puede generar automáticamente desde TypeSpec: actualización atómica **multicolumna** de datos de negocio, invariantes entre entidades con transacciones, y UX de validaciones de conflictos contextualizada desde el IR. Mantener cada implementación limitada por su semántica, rechazar `UNSUPPORTED` antes de generar y usar aplicaciones independientes para evitar código específico por dominio.
