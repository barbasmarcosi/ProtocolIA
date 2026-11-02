# P2 — Catálogo versionado de operadores semánticos (v1)

**Alcance:** biblioteca revisada de primitivas, no un cargador dinámico de plugins, ni autorización de políticas por agentes.

## Nuevo hito

`scripts/research/operator-catalog-v1.mjs` separa de la gramática las invariantes de tres operadores:

| Operador | Pin ejecutable | Propiedad crítica |
|---|---|---|
| Reserva | `capacity.reserve@1` | Descontar capacidad y persistir journal atómicamente, sin sobresuscripción |
| Transición | `state.transition-audited@1` | Cambio CAS auditable, grafo alcanzable sin ciclos ni uniones ambiguas |
| Compensación | `capacity.release-terminal@1` | Una sola devolución, exactamente una vez, sobre estado terminal |

El nuevo `protocolia-operator-assembly/v0.2` exige que la fuente contenga **los tres pins exactos**. Las versiones no reconocidas, atributos adicionales y degradaciones fallan antes de generar archivos. La biblioteca permite comparar snapshots: `identical`, `requires-review` (adición) o `breaking` (cambio/eliminación). Una clasificación de compatibilidad **no concede autorización para ejecutar un operador agregado**.

La fuente `research/autonomous-engineering/samples/composable-equipment-operators-v02.json` emplea los mismos comportamientos de la v0.1; cambia únicamente la explicitud de versiones. El resultado `semantic-ir.json` incluye un vínculo al catálogo y su SHA-256. `operator-catalog.json`, el informe y `protocolia-intake.lock.json` registran las versiones y su huella de manera verificable. La versión v0.1 queda aceptada y genera el **mismo TypeSpec**; no hay migración destructiva.

## Evidencia

- Pruebas independientes para cada primitiva, versiones desconocidas, cambios de semántica y salidas alteradas.
- Prueba de equivalencia binaria TypeSpec entre v0.1 y v0.2.
- CI matricial NestJS + Spring con PostgreSQL: la fuente **v0.2** debe superar la carrera de 12 reservas (3 éxitos, 9 conflictos, saldo 1), aprobación (saldo 3) y devolución única tras rechazo (saldo 5).
- La CI anterior de stock, cupos de cursos, revisión, Project Passport, firmas y finanzas S2a/S2b sigue siendo guardrail.
- El SHA demuestra **integridad**, no firma de un propietario ni aprobación comercial. Las pruebas no ejecutan modelos externos.

## Pendientes de producto

El catálogo v1 todavía cubre **dos entidades y una reserva + transición + compensación**. No se admite cualquier esquema relacional o condición. Para introducir un nuevo operador: contrato semántico versionado, revisión del riesgo de privilegios/efectos, conformance PostgreSQL reproducible en ambos adaptadores y análisis de compatibilidad. El operador no se activa solo porque esté declarado.

Próximos hitos: aislamiento y autorización por operación, más relaciones/entidades y un P1 con propuestas auténticas de LLM sujetas a aprobación humana y límites de costo.
