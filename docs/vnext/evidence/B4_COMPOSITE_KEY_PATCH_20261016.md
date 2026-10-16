# ProtocolIA B4 — PATCH seguro de claves compuestas desde TypeSpec

**Fecha:** 16-10-2026 · **Resultado:** ACCEPTED · **Código funcional y CI:** `898e59d40d09ad81f0fe7260c17022c092c1d83f` · **Rama integrada:** `independent/volunteer-evaluations`.

## Objetivo de producto

B3 ya generaba restricciones SQL de unicidad compuesta desde `@uniqueTogether("equipmentCode,period")`, pero rechazaba actualizar uno de sus campos. B4 agrega **PATCH de un campo escalar requerido de esa clave**, conservando su identidad pública y preservando los demás datos, **sin personalizar por entidad** los sistemas generados.

## Semántica ejecutada

- El contrato declara `@behavior("patchFields","Inspection","period","period")` para un endpoint `PATCH /api/inspections/{number}/period` con respuesta 200 y errores 400/404/**409**. `InspectionPeriodUpdate` preserva límites y tipo de `period`.
- El compilador TypeSpec rechaza PATCH de campo clave con tipo/DTO debilitado, propiedad diferente, FK, campo opcional/nullable, owner-managed, o sin estados exigidos. La validación previa del adaptador Nest/Spring replica las restricciones más sensibles para IR externos malformados.
- Ambos backends ya hacen `UPDATE` sobre PostgreSQL, cuya restricción compuesta `UNIQUE(equipment_code,period)` gobierna concurrencia sin carrera read-before-write. NestJS traduce el código PG `23505` a `409`; Spring ahora también captura y traduce explícitamente `23505` en el camino PATCH. Un error revierte la actualización.
- No se agregó mutación directa de referencias FK: siguen requiriendo el comportamiento de reasignación de referencia tipado, y el PATCH normal las rechaza.
- Los cambios residen únicamente en compilador, generadores y plantilla compartida Spring, más fixtures y oráculos. Ni el contrato independiente de Bomberos ni el código de una aplicación generada fueron parcheados manualmente.

## Pruebas reales y adversariales

- [B4 HTTP/PostgreSQL #38965611867](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38965611867) **SUCCESS**, jobs `modular-spring` y `nestjs`. Generó ambos sistemas desde el nuevo fixture `examples/vnext/composite-key-patch` y ejecutó Node/TypeSpec, PostgreSQL y HTTP autenticado. Casos: duplicado en INSERT `409`; PATCH hacia combinación existente `409` y fila intacta; PATCH a combinación libre `200`; otra entidad padre con mismo período `200`; recurso inexistente `404`; payload con campo desconocido `400`. Dos PATCH concurrentes sobre registros distintos del mismo equipo hacia el mismo período: **exactamente un 200 y un 409**, base con una sola fila ganadora y la perdedora sin cambios. Se comprueba también el total de registros inalterado.
- Los tests negativos del compilador impiden omitir 409, debilitar restricciones de DTO, omitir el campo de payload e intentar actualizar una FK mediante PATCH normal. Un primer intento de CI falló porque un negativo esperaba el diagnóstico específico de B4, aunque el compilador rechazaba antes el payload inválido mediante `protocolia-behavior-input`. Se corrigió la expectativa para aceptar ambas validaciones fail-closed y se repitieron **todas las pruebas** en verde, sin silenciar errores.
- [Quality B4 #38965611886](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38965611886): **SUCCESS**.
- [Regresión independiente Bomberos #38965885865](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38965885865): **SUCCESS**, Spring + Nest reconstruidos desde el contrato independiente, PostgreSQL/HTTP y Chromium NestJS.
- [Quality integrada #38965885833](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38965885833): **SUCCESS** con Node/Python y conformidad de artefactos correspondiente.
- Integración por fast-forward protegido desde `30f3ec1f53204d0b412962c442d7cd29092d9449` al SHA funcional `898e59d40d09ad81f0fe7260c17022c092c1d83f`. `main` no se modificó; PR #52 permanece abierto y no se tocaron Railway/Neon persistentes.

## Límites y próximo paso

B4 cubre actualizaciones **escalares de texto** de un campo compuesto, no mutaciones de varias columnas de la clave en una sola transacción, reasignación FK, índice parcial/case-insensitive ni evolución de restricciones UNIQUE en DB históricas con duplicados. La UI React ya maneja conflictos HTTP; mejorar la explicación de la combinación duplicada para usuarios finales necesita atención adicional, sin exponer valores privados. Próximo valor de producto: actualización multicolumna atómica con guardas, validación DTO/estado y conflicto 409, o reglas de negocio multiagregado generadas desde TypeSpec. Mantener el perfil limitado declarado y la misma regresión independiente.
