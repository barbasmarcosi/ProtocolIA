# B2.3 — Total monetario con porcentaje de descuento declarativo

**Estado: PASS acotado**. Fuente de código y pruebas: `edbde80edc7493f27cc58cdf79e5879d662dc025` (16-10-2026 UTC).

## Evidencia independiente de las plantillas

- [NestJS + Spring Boot, PostgreSQL, HTTP y Chromium — PASS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38849656181).
- [Quality — PASS](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38849656143).

## Nuevo contrato soportado

```typespec
@encode(string) @exactDecimal(12, 4, "0")
unitRate: decimal;

@encode(string) @exactDecimal(14, 3, "0")
batchUnits: decimal;

@encode(string) @exactDecimal(5, 2, "0", "100")
discountPercent: decimal;

@encode(string) @exactDecimal(22, 2, "0")
@computedDiscountedTotal("unitRate","batchUnits","discountPercent","half_up")
discountedTotal: decimal;
```

El compilador resuelve tres referencias a **campos diferentes, editables, requeridos, decimales, no anulables**. Precio y cantidad requieren mínimo `"0"`; el descuento requiere `min="0",max="100"` expresados como cadenas decimales exactas. Solo se admite `half_up` para este perfil no negativo. El campo de salida es requerido, no anulable, `min="0"` y **no acepta máximo**. La precisión se demuestra conservadoramente: `integerDigits(out) = integerDigits(price)+integerDigits(quantity)+1` y `precision(out)=integerDigits(out)+scale(out)<=38`. La escala debe ser menor que la precisión fraccional disponible de los tres operandos y el divisor 100.

TypeSpec rechaza fuentes desconocidas, duplicadas, calculadas, tipos mixtos, descuentos fuera de los metadatos requeridos, modo distinto de `half_up`, precisión sin acarreo o un DTO que intente ofrecer la columna calculada. Los adaptadores vuelven a validar estos invariantes si reciben un IR modificado o fabricado.

## Generación

Los dos generadores producen una sola columna PostgreSQL materializada:

```sql
discounted_total NUMERIC(22,2)
  GENERATED ALWAYS AS (
    round((unit_rate * batch_units * (100 - discount_percent)) / 100, 2)
  ) STORED
```

Es un cálculo **directo** sobre tres campos fuente: evita la dependencia entre columnas `GENERATED ALWAYS` que PostgreSQL no admite. La operación utiliza `NUMERIC` y no `Number`. NestJS y Spring Boot leen el importe de PostgreSQL como cadena decimal sin pérdida de precisión, y React genera el formulario con campos de entrada para precio, cantidad y descuento, pero no para el resultado.

## Oráculos reales

- Descuento cero sobre `1.0050 × 1.000` da `1.01` con empate half-up.
- `1.0100 × 1.000` con **50 %** da `0.51`, prueba de redondeo del resultado del descuento.
- `100.0000 × 1.000` con **12,50 %** da `87.50`.
- Un descuento del **100 %** devuelve `0.00`.
- Los descuentos `100.01`, `-0.01` y el número JSON `50` (en lugar de cadena) fallan HTTP 400 sin persistencia.
- Resultado de alta precisión `99999999.9999 × 99999999.125 × 0.875` → `8749999923428750.00`.
- Una petición con `discountedTotal` falsificado se rechaza; la columna no aparece como input del formulario React generado en Chromium.
- Los oráculos previos de SQL directo, límites de escalas, fechas, enums, columnas generadas y precio exacto siguen pasando en ambas tecnologías.

## Límites y siguientes pasos

Esta operación representa exclusivamente **total después de un descuento porcentual por línea**, no un motor de expresiones arbitrarias. No incluye IVA, tasas compuestas, un descuento de carrito, redondeo por factura, precios negativos, `half_even`, multi-moneda ni operaciones transaccionales entre diferentes tablas. El perfil Basic Auth sigue siendo exclusivo de pruebas. No se desplegó sobre Railway/Neon de duración prolongada ni se alteró `main` o el PR #52.

**Gate de integración pendiente:** fast-forward de `independent/volunteer-evaluations` y verificación de la regresión independiente de Bomberos sobre ese SHA, junto con la CI quality.
