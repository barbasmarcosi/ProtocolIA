# B2.1 — Producto decimal exacto generado desde TypeSpec

**Estado: PASS acotado al 16-10-2026 UTC.** Fuente funcional SHA `b586643913f822a08f807f2a50f4e53336867281`.

## Evidencia ejecutable

- [CI específica: dos backends, PostgreSQL, HTTP y Chromium móvil — PASS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38847056694).
- [CI `quality` — PASS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38847056766).

## Contrato soportado

```typespec
@encode(string)
@exactDecimal(12, 4, "0")
unitRate: decimal;

@encode(string)
@exactDecimal(14, 3, "0")
batchUnits: decimal;

@encode(string)
@exactDecimal(26, 7, "0")
@computedProduct("unitRate", "batchUnits")
extendedValue: decimal;
```

**Garantía exacta:** el compilador exige exactamente dos campos decimales distintos, requeridos, no anulables, con mínimo explícito `"0"` y sin reglas derivadas/compuestas en las fuentes. El campo de salida debe ser decimal requerido y no anulable. `output.precision = left.precision + right.precision <= 38`, `output.scale = left.scale + right.scale`, `output.min = "0"`. Estas igualdades evitan redondeos silenciosos incluso con valores extremos representables por los operandos. No se acepta `Number` como representación JSON de un decimal.

**Persistencia:** ambos adaptadores emiten `NUMERIC(26,7) GENERATED ALWAYS AS (unit_rate * batch_units) STORED` en PostgreSQL, con restricciones de precisión, rango y finitud. No hay cálculo duplicado en JavaScript: NestJS y Spring Boot consultan la columna y la serializan como cadena decimal sin pérdida. El valor calculado no puede incluirse en el DTO de creación ni en escrituras HTTP, y se excluye del formulario React generado y de los payloads del verificador genérico. El compilador falla cerradamente ante un producto inseguro o ante un DTO de creación que intente aceptar un campo calculado.

## Aceptación real

- Caso grande `99999999.9999 × 99999999.125 = 9999999912490000.0000875` a siete decimales, por encima del máximo entero seguro de JavaScript.
- Caso de escala mínima `0.0001 × 0.001 = 0.0000001`.
- Compilación negativa para precisión insuficiente, escala insuficiente, operandos ausentes/iguales y campo calculado añadido indebidamente al DTO.
- Rechazo de campo calculado falsificado durante HTTP create y verificación de ausencia de persistencia.
- Creación desde la interfaz móvil generada en Chromium: el campo calculado no es editable; la respuesta de PostgreSQL conserva exactamente la multiplicación esperada.
- Conformance existente contra operaciones HTTP, permisos y base de datos de ambos adaptadores.

## Alcance limitado

Este es el **primer incremento de B2**, no un motor de fórmulas libre. Acepta únicamente multiplicación de dos decimales exactos requeridos y no negativos. No soporta redondeo configurado, impuestos, descuentos, cocientes, expresiones condicionales, cálculos entre entidades, ediciones transaccionales de múltiples fuentes ni migraciones en bases productivas existentes. La fuente de autoridad es PostgreSQL. La autenticación Basic de ensayo no se considera apta para producción.

**Gate de promoción pendiente:** ejecutar regresión oficial de Bomberos luego de integrar este SHA por fast-forward a `independent/volunteer-evaluations`. Mantener intactos `main`, PR #52 y demo Railway/Neon.
