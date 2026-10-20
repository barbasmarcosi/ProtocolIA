# B1.3d — Combinaciones prohibidas por estado enum (16-10-2026)

**Resultado: PASS acotado, integrado con regresión independiente.**

## Fuente de verdad y semántica

Código ejecutable validado: [`5439f4dc041343dcf1e65a7842c7ae85d970a9f3`](https://github.com/barbasmarcosi/ProtocolIA/commit/5439f4dc041343dcf1e65a7842c7ae85d970a9f3). Rama de implementación `feature/b1-3d-forbidden-combination-20261016`, promovida por fast-forward con comprobación del SHA base a `independent/volunteer-evaluations`. `main`, PR #52, Railway y Neon no fueron modificados.

El contrato `examples/vnext/finite-choices/contracts/main.tsp` demuestra el mismo campo con:

```typespec
@requiredWhen("quality", "needs_service")
@forbidWhen("quality", "ready")
@minLength(5) @maxLength(160)
maintenanceReason?: string;
```

- `needs_service`: motivo obligatorio y válido.
- `ready`: motivo ausente; incluirlo es incompatible.
- Otro valor declarado y origen opcional omitido: comportamiento previo conservado.
- El compilador rechaza un valor inexistente, una referencia a sí mismo, una fuente no enum, un campo no compatible y `requiredWhen` contradictorio.
- Los DTO de creación conservan el campo y su tipo; el compilador bloquea PATCH del campo protegido o su origen hasta contar con mutaciones atómicas con validación del estado final.

## Propagación y garantías

- TypeSpec `@forbidWhen` → metadata `IrField.forbidWhen`; sin expresiones arbitrarias ejecutables ni SQL proporcionado por el usuario.
- NestJS y Spring Boot hacen validación previa de CREATE; una combinación incompatible produce `400` con problema `invalid_combination` ligado a `maintenanceReason`.
- PostgreSQL crea `ck_forbid_gauge_maintenance_reason` con `CHECK (quality IS DISTINCT FROM 'ready' OR maintenance_reason IS NULL)`. El enum origen también conserva su CHECK de pertenencia. Los generadores verifican valores e identificadores antes de construir el SQL.
- React generado avisa del conflicto en el campo, impide persistir y elimina errores obsoletos cuando cambia el enum. La autoridad permanece del lado del servidor.
- OpenAPI mantiene los tipos HTTP normales; las condiciones entre propiedades se interpretan desde el IR, no se atribuye validación semántica a un OpenAPI no enriquecido.

## Evidencia exacta

1. [Aceptación del contrato independiente #38860191554](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38860191554): **SUCCESS**, ambos backends generados, compilación, mutaciones de TypeSpec rechazadas, PostgreSQL/HTTP real, inserción SQL prohibida rechazada y Chromium móvil en NestJS.
2. [Quality de código #38860191459](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38860191459): **SUCCESS** en intento 2. El primer intento sufrió un fallo de limpieza temporal en el test Python heredado `test_p4_local_runner` con Python 3.13; se reejecutó sólo el job afectado y pasó.
3. [Regresión Bomberos #38860508683](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38860508683): **SUCCESS** sobre el mismo SHA, aplicaciones NestJS/Spring Boot y PostgreSQL real, HTTP y Chromium.
4. [Quality integrada #38860508751](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38860508751): **SUCCESS** en primer intento sobre el mismo SHA.

## Límites y próximos pasos

- Una sola igualdad contra un valor de enum de cadena; campo destino `string` opcional no-nullable. No es un DSL de reglas general, autorización de datos, exclusión compleja entre entidades ni un motor de workflows.
- Sin migración automática aditiva para añadir el CHECK a datos existentes; la prueba se hizo con bases efímeras, **sin tocar Neon**.
- No se han cubierto todas las posibles combinaciones ni operaciones parciales: PATCH de los campos implicados queda rechazado deliberadamente.
- La aceptación funcional de 16 requerimientos de Bomberos sigue gobernada por su freeze independiente. Esta característica no se contabiliza como requisito cubierto si no existe un oráculo de negocio específico.
- Próxima prioridad de negocio: operaciones multi-entidad con cálculos decimales/auditoría, y S1 autorización por registro/campo verificada en backend.

Los commits documentales posteriores conservan `5439f4dc041343dcf1e65a7842c7ae85d970a9f3` como referencia de código probado; no se extrapola CI a cambios ejecutables posteriores.
