# ProtocolIA B6 — Actualización atómica de una clave compuesta desde TypeSpec y React

**Fecha:** 2026-10-17 · **Estado:** ACCEPTED — NestJS y Spring Boot (PostgreSQL + HTTP + Chromium móvil) más regresión independiente de Bomberos. **Código funcional validado:** `6323878840d81f5dc58a314af78ee676226c92ba`.

## Valor para el generador

ProtocolIA ahora puede generar una actualización en un único paso de **ambos campos** de una clave de negocio compuesta de dos cadenas obligatorias. El contrato TypeSpec usa `@uniqueTogether("branch,period")` en una entidad y `@patchTogether("branch,period")` en una operación `@behavior("patchTogether","Batch")`, sin código específico por modelo.

**Contrato independiente:** `examples/vnext/compound-update/contracts/main.tsp` (lotes por sucursal y período), generado automáticamente desde TypeSpec a React y backend NestJS o Spring Boot.

**Semántica verificada:**

- El compilador y ambos adaptadores rechazan declaraciones ambiguas, columnas opcionales, FK, owner-managed, estado, DTO debilitado, omisión de 409, rutas sin clave pública o campos no coincidentes con la restricción compuesta.
- La actualización utiliza una sola sentencia `UPDATE` con parámetros SQL enlazados para ambos valores y la identidad pública. No hay lectura previa vulnerable a carreras, ni dos escrituras independientes.
- La restricción PostgreSQL `UNIQUE(branch,period)` arbitra concurrencia; el código de error `23505` se transforma en **HTTP 409**, sin mutaciones parciales. Rechaza propiedades imprevistas (400), identidad inexistente (404) y perfiles sin permisos de escritura (403).
- Se genera una pantalla de detalle React con **dos inputs**, guardado conjunto, confirmación del éxito sólo después de respuesta real y error contextual legible para colisiones. La solución vive en la plantilla React compartida, no es un componente escrito para Batch.
- El adaptador de JDL declara explícitamente `patchTogether` como `BEHAVIOR_UNVERIFIED`; no se promete compatibilidad JHipster stock. La herramienta de conformance generic acepta que una app no declare `atomicIncrement` o `patchFields`, sin inventar que esas capacidades fueron probadas.

## Evidencia ejecutada

- [CI B6 #39006655679](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39006655679) — **SUCCESS**, jobs `nestjs` y `modular-spring`, commit `6323878840d81f5dc58a314af78ee676226c92ba`. Cada uno genera backend+React con TypeSpec, ejecuta negativo compilador, inicia PostgreSQL y la aplicación real vía Docker y verifica:
  - Cambio simultáneo válido de sucursal+período con otros campos intactos.
  - Colisión con otra fila: 409, ambos valores previos conservados.
  - 12 actualizaciones simultáneas sobre una única combinación: **1×HTTP 200, 11×HTTP 409**. Las 11 perdedoras mantienen ambas columnas originales. PostgreSQL contiene exactamente una fila ganadora y 14 filas totales sin pérdida.
  - 400 por campo desconocido/incompleto, 404 inexistente, 403 para lector.
  - Chromium real 390×844: edición de los dos inputs de la UI generada, advertencia contextual de 409, reintento exitoso, verificación por GET y sin excepciones de JavaScript. Marcadores `PROTOCOLIA_B6_COMPOUND_UI_CHROMIUM_PASS` y `PROTOCOLIA_B6_ATOMIC_COMPOUND_PATCH_PASS` aparecen para ambos targets.
- [Quality de B6 #39006655654](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39006655654) — **SUCCESS**.
- [Regresión independiente Bomberos #39006848037](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39006848037) — **SUCCESS** en Spring Boot y NestJS, PostgreSQL + HTTP y Chromium independiente sobre la UI del sistema de Bomberos.
- [Quality de integración #39006847968](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/39006847968) — **SUCCESS**, Python 3.11 y 3.13, contratos y artefactos.
- Hubo iteraciones de CI inicialmente fallidas de **compilador y harness de conformance**, no de un flujo de negocio declarado como aprobado: se agregó el bloqueo JHipster requerido por TypeScript, el registro real del decorador TypeSpec, la expresión de parseo de identidad HTTP y el test genérico de operaciones opcionales. El commit final recompiló y probó ambos targets en verde.

## Estado de integración

Código integrado por fast-forward protegido en `independent/volunteer-evaluations` desde `57e02d9599105331b78c4a78ed311306840cf637`; `main`, PR #52 y los despliegues existentes Railway/Neon no se modificaron.

## Límites reales y siguiente valor

- Perfil limitado intencionalmente a **dos campos string requeridos** que forman íntegramente una clave `@uniqueTogether`. No cubre PATCH de FK, combinaciones de tres/cuatro campos, índices únicos condicionados `@uniqueWhen`, reglas cross-entity, políticas de versiones/ETags ni migraciones automáticas de bases existentes con duplicados.
- La UI B6 recibió un oráculo Chromium móvil, pero falta evaluación transversal de accesibilidad con teclado/lector de pantalla y responsive escritorio para todos los widgets nuevos.
- Pendiente importante de producto: permitir operaciones transaccionales entre múltiples agregados desde contratos, con transacciones tipadas, evolución segura sobre bases pobladas y mensajes de validación localizados reutilizables, sin código escrito por entidad.
