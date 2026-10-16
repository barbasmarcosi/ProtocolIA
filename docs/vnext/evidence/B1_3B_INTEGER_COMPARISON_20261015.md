# B1.3b — Comparación numérica portable entre campos (int32)

**Estado:** PASS acotado en código `02ec63076634dbd06930a30e39509f04209cc298` de `feature/b1-4-numeric-field-20261015`, validado en GitHub Actions el 16-10-2026 UTC.

**Evidencia de ejecución:**
- [CI dirigida: NestJS y Spring Boot, PostgreSQL, oráculo HTTP/SQL y Chromium móvil](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38842980504) — ambas matrices `success`.
- [Quality: pruebas Python, artefactos, esquema contractual y v0.2](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38842980520) — `success`.
- [Commit de funcionalidad](https://github.com/barbasmarcosi/ProtocolIA/commit/3bff21abd149a64240e8dd38ab4262b5567f4c87) y [corrección del escenario adversarial](https://github.com/barbasmarcosi/ProtocolIA/commit/02ec63076634dbd06930a30e39509f04209cc298).

## Alcance contractual realmente implementado

```typespec
@minValue(0)
reading: int32;
@greaterThanField("reading")
readingCeiling?: int32;
```

1. `@greaterThanField("reading")` exige estrictamente `readingCeiling > reading` cuando se proporciona `readingCeiling`.
2. Fuente: campo hermano `int32` **obligatorio y no anulable**. Destino: `int32` no anulable, obligatorio u opcional; puede omitirse si es opcional, pero no admitirse `null` explícito. No se admiten referencias, campos computados, cadenas de comparaciones ni fuentes desconocidas/autorreferencias.
3. **TypeSpec → IR:** decorador con metadata tipada; errores fail-closed y rechazo de DTO CREATE cuando debilita tipo, límites u opcionalidad.
4. **PostgreSQL:** ambos adaptadores generan `CONSTRAINT ck_gt_gauge_reading_ceiling CHECK (reading_ceiling IS NULL OR reading_ceiling > reading)`. El oráculo prueba inserción directa inválida y confirma que no persiste.
5. **NestJS y Spring Boot:** validan el orden al crear, respondiendo HTTP 400 con `issues: [{field:"readingCeiling",code:"invalid_comparison"}]`; rechazaron igualdad, inversión, null y tipo JSON inválido.
6. **React generado:** valida antes del envío, marca el campo con `aria-invalid` y da error en español; Chromium móvil prueba igualdad y posterior creación correcta. Los campos `int32` opcionales en blanco se omiten del payload en lugar de convertirse implícitamente en cero.
7. El contrato independiente de prueba conserva las reglas previas de fecha cronológica y obligatoriedad condicional.

## Límites expresos

- Esta iteración **solo** admite comparaciones de `int32` entre campos. Comparaciones entre decimales exactos `NUMERIC`, límites entre fechas más expresivos, operadores inclusivos y predicados compuestos no están soportados.
- La validación tipada con mensaje por campo ocurre durante **CREATE**. Otras mutaciones que choquen con el `CHECK` de SQL son rechazadas por la base y pueden producir error genérico de restricción, no aún un diagnóstico contextual por campo.
- El cumplimiento probado corresponde a los escenarios ejecutados, **no** a completitud de todos los requisitos de Bomberos, producción, roles complejos ni autorización multinivel.
- Ningún cambio a la demo Railway UX9, Neon persistente, `main` ni PR #52 forma parte de esta iteración.

**Gate de promoción — PASS:** integración por fast-forward en `independent/volunteer-evaluations`, fuente funcional y documentación SHA `2eb71273c9bb344d14278fa589144f06ec26b108`. [Regresión independiente oficial: Bomberos NestJS/Spring Boot, PostgreSQL y Chromium #38843283558](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38843283558) y [quality integrada #38843283377](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38843283377), ambos `success`. B1.4 (metadatos avanzados de formularios), B2 (cálculos/transacciones) y S1 (autorización por datos) permanecen pendientes.
