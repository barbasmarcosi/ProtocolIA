# B1.3c — Comparación estricta entre decimales exactos

**Estado: PASS acotado al 16-10-2026**. Fuente funcional `fc82bd192710b749db110539628fa05d421fbb79`. Verificaciones en ramas aisladas antes de integrar:
- [Aceptación independiente exact-decimal en NestJS y Spring Boot, PostgreSQL y Chromium móvil](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38844095902) — `success` en ambos destinos.
- [Quality, schema y tests Python](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38844095863) — `success`.

## Semántica soportada

```typespec
@encode(string)
@exactDecimal(24, 4, "0", "99999999999999999999.9999")
unitPrice: decimal;

@encode(string)
@exactDecimal(24, 4, "0")
@greaterThanField("unitPrice")
priceCeiling?: decimal;

@encode(string)
@exactDecimal(16, 6, "0.000001", "9999999999.999999")
quantity: decimal;

@encode(string)
@exactDecimal(16, 4, "0")
@greaterThanField("quantity")
quantityLimit?: decimal;
```

`@greaterThanField` acepta ahora pares de `int32` o pares de `decimal` exactos. No se permiten pares mixtos, fuente ausente, opcional o anulable, destino anulable, referencias, campos computados ni comparaciones encadenadas. El destino puede ser opcional y, cuando está omitido, la regla no se aplica; `null` explícito en un destino no anulable es inválido. Precisión y escala de los dos decimales pueden diferir dentro de los límites de `@exactDecimal`.

- **Compilador/IR:** conserva tipo y metadatos exactos y rechaza la reducción de tipo, rango, escala, codificación JSON-string u opcionalidad en el DTO CREATE.
- **NestJS:** usa valores enteros escalados `BigInt` con escala común, sin conversión a `Number`.
- **Spring Boot:** utiliza `BigDecimal.compareTo` contra dos cadenas decimales ya validadas.
- **PostgreSQL:** cada adaptador genera `CHECK (destino IS NULL OR destino > origen)` sobre columnas `NUMERIC(p,s)`; rechaza inserciones SQL directas con igualdad o orden invertido.
- **React generado:** hace la comparación exacta con `BigInt` y muestra error específico del campo (`aria-invalid`); conserva las cadenas de decimales para el envío.
- **HTTP:** devuelve `400` con `issues: [{field: "...",code:"invalid_comparison"}]` para violaciones de orden durante CREATE; la persistencia no se modifica.

## Oráculos ejecutados

Igualdad sobre `9007199254740993.1234`, diferencia de una diezmilésima `9007199254740993.1235`, comparación de `quantity` escala seis con `quantityLimit` escala cuatro (`0.100001` vs `0.1000`), `null`, tipo JSON numérico inválido, escritura SQL directa violando `ck_gt_...`, lectura tras persistencia y formulario móvil con errores y corrección del valor. El corpus TypeSpec cubre referencias desconocidas, fuente opcional/anulable, tipos mixtos, autorreferencia y DTO debilitado. Mantiene los casos anteriores de decimales exactos, nullable y límites.

## Restricciones y pendientes

- Solo comparación estricta **mayor que** entre exactamente dos campos de la misma familia `int32` o `decimal`; no hay expresiones arbitrarias, disyunciones, comparaciones mixtas entero/decimal ni reglas `>=`.
- La validación contextual por campo se ejecuta en CREATE; otras mutaciones contra el `CHECK` se rechazan en PostgreSQL pero podrían devolver error genérico.
- No está demostrado un contrato comercial completo, autorización multinivel o disponibilidad para producción; Basic Auth continúa siendo modo demo.
- No desplegar esta iteración sobre Railway/Neon durables ni modificar `main` o PR #52.

**Pendiente:** completar el gate de regresión oficial de Bomberos luego del fast-forward a `independent/volunteer-evaluations`. Posteriormente abordar B1.4 (formularios), B2 (cálculos/transacciones), S1 (autoridad sobre datos).
