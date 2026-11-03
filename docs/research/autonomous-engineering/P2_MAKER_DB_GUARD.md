# P2 — Invariantes PostgreSQL para identidad del presentador (v0.5)

Estado: incremento de seguridad del perfil maker-checker ya integrado; no equivale a aislamiento multi-tenant.

## Por qué

El perfil v0.5 hacía cumplir maker-checker en los caminos de transición generados por NestJS y Spring, mediante UPDATE CAS, pero una ruta adicional de escritura con la conexión SQL del servicio podría alterar `protocolia_submitted_by` directamente. El siguiente requisito de aislamiento por organización necesita un registro de autor estable antes de incorporar miembros y tenants.

## Implementación

`packages/adapters/maker-checker-db-guard.mjs` produce SQL validado desde el grafo tipado y aprobado. NestJS y Spring lo usan únicamente cuando `auditedTransitionAuthority(...).makerChecker` está activo. No introduce un trigger en v0.3/v0.4 ni en otros perfiles de negocio.

1. `CHECK` mantiene la equivalencia entre estado inicial y presentador ausente. En cualquier estado posterior debe existir un presentador.
2. `BEFORE INSERT OR UPDATE` rechaza inserciones con autor o estado ya alterados, cambios posteriores del autor, retornos a estado inicial y rutas de estado no declaradas.
3. Para cambiar estado, el trigger exige `current_setting('protocolia.subject', true)`, que las aplicaciones establecen mediante `set_config(..., true)` dentro de la transacción con un actor proveniente de su autenticación. La presentación solo puede fijar el maker a ese actor. La decisión final exige otro actor y un estado precursor válido.
4. La transacción de PostgreSQL debe registrar estado, maker y auditoría juntos. `SET LOCAL` se descarta al confirmar o revertir, evitando que un sujeto quede asociado a otra solicitud de la conexión reutilizada.

## Prueba adversarial real

El comando `app:test` genera y levanta una aplicación con credenciales y volumen Docker desechables, ejecuta la conformidad HTTP completa y después abre una **nueva sesión psql sin sujeto**. Utilizando una fila creada por la prueba, el SQL independiente intenta: finalizar el expediente, cambiar al presentador, devolver el estado a borrador y borrar el presentador. Los cuatro intentos deben fallar con SQLSTATE `23514` y la fila debe conservar su estado original. El marcador `PROTOCOLIA_MAKER_DB_GUARD_PASS` confirma esta evidencia.

La CI debe superar esta prueba en los backends NestJS y Spring v0.5, además de la matriz v0.3/v0.4 y las regresiones financieras existentes.

## Límites

El valor `protocolia.subject` es una variable de transacción establecida por el servidor, **no una prueba criptográfica de identidad por sí sola**. Un administrador PostgreSQL irrestricto puede manipular configuraciones o eliminar triggers. Esto no reemplaza roles de base de datos con mínimos privilegios ni una plataforma de identidades confiable. Una persona con dos cuentas puede presentarse y decidir bajo identificadores distintos.

**No se implementa multi-tenancy aquí.** El futuro aislamiento requiere un identificador de organización autenticado por el proveedor de identidad, membership y decisiones multi-tenant consistentes en CRUD, listados, eventos y transiciones; hasta entonces no debe anunciarse como protegido. Para entornos productivos es necesario separar cuentas de migración y runtime y negar DDL al rol runtime.

Próximo hito: especificar identidad tenant segura, límites de roles de base, aislamiento de lectura y escritura por organización, y pruebas de negativas cruzadas en aplicaciones generadas, antes de intentar incorporar modelos LLM al proceso P1.
