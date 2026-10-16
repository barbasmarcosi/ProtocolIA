# B2.4a — Agregado transaccional de reservas activas entre entidades

**PASS acotado**, código verificado `658a798f10276262e7753ac84aac858b916df832` (16-10-2026 UTC).

## Evidencia de aceptación

- [NestJS y Spring Boot generados desde TypeSpec, PostgreSQL real y 10 reservas concurrentes — PASS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38852383133).
- [Quality — PASS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38852383115).

## Contrato declarativo

```typespec
model ActiveAllocationSummary { totalUnits: string; }

@route("/api/parts/{sku}/allocation-summary")
@get
@behavior("sumRelated", "Part")
@relatedSum("Allocation", "partSku", "units", "status", "active")
@capability("parts.read")
op activeAllocationSum(@path sku: string):
  ActiveAllocationSummary | NotFound | Unauthorized | Forbidden;
```

La operación solo es válida cuando el hijo declara una FK obligatoria `@reference` al padre, una cantidad `int32` positiva requerida y un estado `@initial("active")` con un par de operaciones `@reserve`/cancelación `@release` correspondiente. El compilador y el generador rechazan otras formas (FK inválida, tipo incorrecto, estado inconsistente, ciclo no autorizado, SQL identificador inseguro, ruta/status/body incorrectos). La autorización **no es solamente la del padre**: exige además la capacidad de lectura `allocations.read` del hijo.

NestJS y Spring Boot comparten el mismo plan validado de SQL, no SQL construido con parámetros de usuario. Una sola sentencia PostgreSQL retorna cero si el padre existe pero no hay reservas activas; si el padre no existe, retorna 404:

```sql
SELECT COALESCE(SUM(c.units::bigint),0)::text AS "totalUnits"
FROM part p
LEFT JOIN allocation c ON c.part_sku = p.sku AND c.status = 'active'
WHERE p.sku = :identity
GROUP BY p.sku;
```

El parámetro de identidad se vincula por driver, no se interpola. `SUM(int32)` usa acumulación `bigint` y se entrega como cadena decimal JSON, sin overflow de un `int32` del frontend ni conversión a `Number`. PostgreSQL resuelve la suma en una instantánea MVCC coherente de las filas de ambas entidades.

## Pruebas negras

1. GET sin autenticación: 401. Recurso inexistente: 404. Artículo existente sin reservas: `{"totalUnits":"0"}`.
2. Stock inicial 10: reserva de tres unidades → disponible 7 y total activo 3.
3. Reserva duplicada rechazada con 409; disponibilidad y total permanecen 7/3.
4. Diez solicitudes concurrentes por una unidad: exactamente siete 201 y tres 409; total activo 10 y disponible 0.
5. Cuatro cancelaciones simultáneas de la misma reserva: exactamente una 200 y tres 409; total activo 7 y disponible 3.
6. Lecturas repetidas del agregado muestran una instantánea consistente.
7. La cuenta con rol lector no puede crear reservas y recibe 403.
8. Los dos generadores pasan el mismo conjunto de pruebas en PostgreSQL real sin lógica específica del dominio en React o en los controladores.

## Límites explícitos

- Esto es **B2.4a**, no el cierre del sistema transaccional completo. La operación agregada es **solo lectura** y no crea asientos, órdenes ni operaciones monetarias entre varias tablas.
- Una consulta MVCC representa un estado confirmado coherente; no garantiza que dos peticiones HTTP separadas (lectura de stock y lectura de suma) vean el mismo instante ni que el resultado no cambie tras la respuesta.
- Los metadatos y el runtime verifican que existen ambos permisos, pero los usuarios de demostración tienen grupos predefinidos de permisos: esta CI **no verifica empíricamente un rol que posea únicamente uno de los dos**. Queda pendiente probar autorización de datos S1.
- La consistencia entre stock y reservas se garantiza para las transacciones generadas `@reserve`/`@release`. Escrituras SQL directas por fuera de estos flujos podrían violar la contabilidad; no se agregó un trigger de conciliación.
- La agregación se ofrece por HTTP tipado, pero **no se generó una tarjeta visual de resumen** en React en este incremento.
- Sin suma de varias facturas, IVA, multi-moneda, pagos, conciliación durable ni transacciones entre más de las tablas de reserva/stock.
- `main`, PR #52, Railway UX9 y Neon durable quedan fuera del alcance.

**Gate final pendiente:** integrar por fast-forward a `independent/volunteer-evaluations` y ejecutar en ese SHA la regresión independiente completa de Bomberos y quality.
