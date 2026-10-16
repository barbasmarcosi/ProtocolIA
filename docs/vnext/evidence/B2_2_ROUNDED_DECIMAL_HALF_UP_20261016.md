# B2.2 — Redondeo decimal explícito en columnas calculadas

**Estado: PASS acotado, fuente `7869276af0fc411c91f6273bc9b64e3499b148ed` (16-10-2026 UTC).**

## Evidencia ejecutada

- [NestJS y Spring Boot: contrato, compilación negativa, PostgreSQL, HTTP y Chromium móvil](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38848292244) — ambos jobs `success`.
- [Quality: matriz de compatibilidad y esquemas](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38848292215) — `success`.

## Contrato

```typespec
@encode(string)
@exactDecimal(12, 4, "0")
unitRate: decimal;

@encode(string)
@exactDecimal(14, 3, "0")
batchUnits: decimal;

@encode(string)
@exactDecimal(22, 2, "0")
@computedRoundedProduct("unitRate","batchUnits","half_up")
roundedTotal: decimal;
```

El output **se define explícitamente** a dos decimales; `half_up` es el único modo soportado en este incremento. Como los dos operandos son obligatoriamente no negativos y `min = "0"`, PostgreSQL `round(numeric,2)` aplica la política de mitad hacia arriba (los empates se alejan del cero). No se admite negativo o semántica de `half_even` implícita.

El compilador requiere dos campos de entrada distintos, decimales exactos, obligatorios, no anulables, sin cadena de campos calculados ni reglas de referencia/comparación. El resultado debe ser obligatorio, no anulable, `min="0"`, sin `max`, y con escala de salida **menor** que la suma de escalas de entrada. Se exige la igualdad conservadora:

```text
integerDigits(output) = integerDigits(left) + integerDigits(right) + 1
precision(output) = integerDigits(output) + scale(output) <= 38
```

El dígito extra permite que el redondeo produzca un acarreo sobre la parte entera sin desbordar. Los contratos inseguros se rechazan antes de generar el backend.

Ambos adaptadores emiten `rounded_total NUMERIC(22,2) GENERATED ALWAYS AS (round(unit_rate * batch_units, 2)) STORED`. NestJS, Spring Boot y React excluyen el valor derivado de los payloads de creación y modificaciones; la base de datos lo calcula incluso para escrituras SQL directas. Los decimales se serializan como cadenas JSON sin coerción a IEEE 754.

## Oráculos

- `1.0050 * 1.000 -> 1.01` (empate half_up).
- `1.0049 * 1.000 -> 1.00` (inmediatamente menor que mitad).
- `1.0150 * 1.000 -> 1.02` (segundo empate).
- `0.0000 * 1.000 -> 0.00` y producto sub-centavo `0.0001 * 0.001 -> 0.00`.
- Producto de precisión alta `99999999.9999 * 99999999.125 -> 9999999912490000.00`, junto al valor exacto sin redondear de B2.1.
- Inserción SQL directa válida calcula el redondeo; intentar insertar un valor en la columna `GENERATED ALWAYS` falla.
- El POST con `roundedTotal` suministrado se rechaza con HTTP 400 y no persiste.
- El frontend generado no presenta `create-roundedTotal` como input. Chromium crea correctamente a partir de los operandos.
- Casos negativos TypeSpec: modo `half_even`, precisión sin acarreo, escala no reducida, campo de origen faltante, origen duplicado, destino opcional y DTO que intenta volver escribible el resultado.

## Límites

B2.2 **no** es un sistema monetario completo. Quedan fuera descuentos, porcentajes, IVA, operaciones compuestas, sumas entre renglones, redondeo negativo, `half_even`, facturación, operaciones multientidad y migraciones de bases existentes. El uso de Basic Auth corresponde solo a ensayos. No hay despliegue productivo ni cambios en `main`, PR #52, Railway o Neon.

**Gate de promoción aún pendiente:** integrar por fast-forward en `independent/volunteer-evaluations` y ejecutar allí la regresión independiente de Bomberos antes de declarar el incremento integrado.
