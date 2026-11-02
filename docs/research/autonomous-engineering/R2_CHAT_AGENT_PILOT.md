# R2 — Primer ensayo con propuesta escrita por ChatGPT durante una sesión real

**Estado:** experimento no ciego, una sola propuesta, sin evaluación comparativa ni llamadas pagas a API. El propio ChatGPT redactó `trials/chat-agent-kiosk/proposal.json` tras inspeccionar el brief y el gateway existente. No es una respuesta simulada de HTTP ni una salida de Superpowers, GSD o Spec Kit. Tampoco se afirma que exista un run externo con facturación, token usage o certificación de origen de plataforma.

## Entrada congelada y procedencia

El brief previo `research/autonomous-engineering/samples/kiosk-owner-brief.json` está en Git y es **un ejemplo sintético, no un requerimiento autenticado del dueño de un kiosco**. El agente no lo modificó en esta prueba. La propuesta ancla el hash exacto SHA-256 del archivo y conserva los cuatro IDs de hechos fuente. Las operaciones TypeSpec permitidas ya están congeladas en el brief; el ejercicio **no prueba inferir un contrato universal desde lenguaje natural**.

El agente podía ver el gateway, el caso y la propuesta sintética de ejemplo, así que la evaluación **no es ciega**. No constituye una medición válida de superioridad frente a otra herramienta.

## Hallazgos de la propuesta escrita por el agente

- **K-Q03: BLOQUEANTE.** “Change stock atomically” de K-02 no especifica si debe permitir decrementos/ajustes de ventas; el perfil solo contiene `atomicIncrement` positivo. Ejecutar ventas reales bajo esa interpretación requeriría otra semántica.
- **K-Q04: BLOQUEANTE.** Los SKU son únicos por string pero no existe una regla confirmada de normalización (mayúsculas, espacios o Unicode). Esto puede crear duplicaciones empresariales.
- **K-Q05: fuera del perfil.** Los permisos `inventory.write` se declaran pero falta atribución real a identidades y usuarios. No se considera IAM de producción.
- **K-Q06: fuera del perfil.** Auditoría y reversión de ajustes de inventario no están especificadas ni implementadas.
- **K-Q07: provisional, solo UX.** Se considera usar el formulario generado hasta validar la experiencia móvil; la sugerencia no agrega lógica al contrato.
- **K-Q08: diferido.** Las devoluciones, productos dañados y stock disponible/reservado necesitan reglas adicionales.

Las preguntas originales **K-Q01 descuentos** y **K-Q02 política de devoluciones** siguen en el borrador, sin una respuesta inventada. El agente agregó las hipótesis K-05–K-07 como **trabajo diferido**, con cero operaciones declaradas como implementadas.

## Resultado que DEBE producir la CI

1. `agent-intake-gateway.mjs admit`: **ADMITIDO, BORRADOR NO VERIFICADO**. Se comprueba hash y que ningún hecho u operación original fue alterado.
2. `intake-to-typespec.mjs generate`: **RECHAZADO INTENCIONALMENTE**. Las preguntas K-Q03 y K-Q04 afectan la semántica admitida y están sin resolver. No debe existir `contracts/main.tsp`.
3. Pruebas negativas: rechazar atribución de consentimiento del propietario y conservar todas las preguntas.
4. Una **corrida independiente de control** parte del anterior borrador sintético de inventario positivo para probar que el compilador/app NestJS/PostgreSQL siguen funcionando. Ese control NO fue generado por esta propuesta del agente, que permanece bloqueada.

Al obtener evidencia de GitHub Actions, documentar IDs y estado exacto. No afirmar que toda la CI pasó antes de verla.

## Corrección transversal de confianza descubierta

El gateway anterior transformaba sistemáticamente un hecho de cualquier brief en `origin: "explicit_owner"`. Eso era incorrecto para fuentes sintéticas y potencialmente para fuentes no autenticadas. Esta rama añade `source_brief_unverified` al contrato de origen y al Project Passport, y **nunca eleva la existencia de un archivo a aprobación del propietario**. El mismo tipo de origen viaja de gateway → intake → TypeSpec mapping → Passport. No se modifica la semántica de TypeSpec.

La trazabilidad basada en hash demuestra coincidencia de bytes, **no** que el documento refleje la intención del usuario, que el agente detectó todas las preguntas importantes ni que el resultado esté listo para producción.

## Qué falta para una prueba científica

- Evaluación por un **revisor independiente** con criterios ocultos y varios casos no contaminados.
- Comparar agente directo, scaffolding y combinaciones Superpowers, Spec Kit, OpenSpec y GSD Core con **modelos/harnesses fijados** y presupuestos equivalentes.
- Medir por separado: cantidad/precisión de ambigüedades, contratos correctos, código realmente verificado, latencia, tokens/costo real, intervenciones humanas y regressions.
- Ampliar la capacidad del compilador (ventas y ajustes con decrementos seguros, SKU normalizado si se confirma), en lugar de declarar supuestos como reglas.
- Una prueba de retoma R4 sin chats ni autor original.

## Reproducción local

```sh
node --test tests/research/chat-agent-pilot.test.mjs
node scripts/research/agent-intake-gateway.mjs admit \
  research/autonomous-engineering/samples/kiosk-owner-brief.json \
  research/autonomous-engineering/trials/chat-agent-kiosk/proposal.json /tmp/protocolia-agent-pilot
node scripts/research/intake-to-typespec.mjs generate \
  /tmp/protocolia-agent-pilot/intake.json /tmp/protocolia-agent-pilot-contracts
# La última instrucción DEBE terminar con exit 1 por K-Q03 y K-Q04.
```

**No merge ni despliegue automático.** Este PR debe permanecer apilado y en Draft, ya que `main` continúa con trabajo financiero separado.
