# ProtocolIA B3 — Unicidad compuesta de negocio desde TypeSpec

**Fecha:** 2026-10-16. **Resultado:** ACCEPTED en NestJS y Spring Boot, con PostgreSQL y HTTP reales, más regresión independiente en el sistema de Bomberos. **Código funcional validado:** `0725a0b13a92422c7eadabb890801f6b7ce81ebc`.

## Capacidad reusable del generador

Una entidad TypeSpec puede declarar **una** restricción de unicidad compuesta mediante `@uniqueTogether("fieldA,fieldB")` aplicada al modelo. Admite entre **2 y 4** columnas persistidas, distintas, requeridas y no-null, del mismo modelo. Los nombres se leen del contrato TypeSpec; nunca se interpolan expresiones, SQL ni nombres externos arbitrarios.

Ejemplo independiente del sistema de Bomberos, en `examples/vnext/composite-uniqueness/contracts/main.tsp`:

```typespec
@entity
@uniqueTogether("equipmentCode,period")
model Inspection {
  @publicIdentity @unique number: string;
  @reference("Equipment", "restrict") equipmentCode: string;
  period: string;
  notes: string;
}
```

La validación del compilador ocurre **antes de generar**, y rechaza campos inexistentes, repetidos, opcionales, nullable, calculados, no persistidos o equivalentes a la identidad pública. Además exige que el DTO de creación preserve tipos y restricciones de todos los operandos; los PATCH individuales de campos que forman la clave están declarados UNSUPPORTED hasta incorporar un manejador transaccional de conflictos equivalente.

Tanto el adaptador Spring Boot como NestJS convierten el IR a una restricción PostgreSQL idéntica:

```sql
CONSTRAINT uq_inspection_business UNIQUE (equipment_code,period)
```

Esta regla es un *invariante de persistencia*, no sólo una advertencia de interfaz. PostgreSQL arbitra las inserciones concurrentes, impidiendo que dos procesos pasen la misma comprobación simultáneamente; las APIs generadas traducen `23505` a HTTP `409 Conflict`.

## Evidencia ejecutada

- [CI B3 #38960366032](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38960366032): **SUCCESS**, dos jobs (NestJS y Spring Boot) en el commit `0725a0b13a92422c7eadabb890801f6b7ce81ebc`. Build completo desde TypeSpec, React+backend+PostgreSQL, conformance existente y pruebas negativas del compilador.
- Marcador en **ambos** targets: `PROTOCOLIA_B3_COMPOSITE_UNIQUE_PASS`. Ensayo generado `scripts/vnext/probe-composite-uniqueness-http.mjs` crea una pareja equipo/período, rechaza una segunda identidad con misma pareja (409), permite mismo equipo en otro período y otro equipo en igual período, y después lanza **12 POST simultáneos** con la misma pareja: exactamente **1 HTTP 201 + 11 HTTP 409**. Confirma `total=4`, persistencia de la fila ganadora y registro original sin alteraciones, consultando PostgreSQL directamente.
- [Quality de rama #38960366035](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38960366035): **SUCCESS**.
- [Regresión independiente Bomberos #38960737106](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38960737106): **SUCCESS** en Spring Boot y NestJS, incluyendo HTTP y PostgreSQL, y Chromium independiente en NestJS.
- [Quality integrada #38960737115](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38960737115): **SUCCESS** para Python 3.11 y 3.13, artifact/conformance y demás jobs.
- Primero falló una ejecución de CI porque el test negativo invocaba el compilador antes de construir sus bibliotecas; se corrigió el orden (primero `app:build`, después test) y se repitió **todo** en verde. Ninguna prueba funcional fallida se presentó como aprobación.
- Integrado por fast-forward protegido en `independent/volunteer-evaluations`, desde `3380ae35c36ce70b9b8b7b2f7bc7374a2c85e255`. `main`, PR #52 y recursos Railway/Neon persistentes sin modificaciones.

## Alcance y límites

1. Actualmente se admite una única declaración `@uniqueTogether` por entidad. No hay índices únicos parciales, variantes deferrable, nulos equivalentes, case-insensitive ni reglas arbitrarias entre entidades.
2. Un PATCH individual sobre alguna columna de la clave se rechaza en el compilador. La creación sí está validada, y el orden/conciencia de concurrencia reside en la restricción PostgreSQL.
3. Los sistemas se generan con esta capacidad de manera automática, pero la prueba B3 no incluye un ensayo visual propio con Chromium de ese fixture; la regresión general sí comprueba Chromium para el sistema independiente de Bomberos. El mensaje exacto de error de usuario ante conflicto podría mejorarse.
4. Como siguiente **valor de producto**, incorporar invariantes transaccionales de actualización de registros y experiencias de usuario de conflicto; después generalizar reglas entre entidades/workflows sin heurísticas o código de dominio manual.
