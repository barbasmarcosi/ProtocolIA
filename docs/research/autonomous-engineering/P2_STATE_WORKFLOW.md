# P2 — Operador independiente de estados: expedientes de revisión

El PR agrega un tercer ejemplo de dominio semántico, **distinto de reservas/cupos**. Permite representar y ejecutar un flujo acotado de decisiones sin alterar saldos, cobrar, borrar ni disparar acciones externas.

## Contrato de laboratorio

- Entidad ReviewCase: caseId único, summary y estado inicial.
- Fuente JSON con límites y nombres de cuatro estados distintos. Grafo **cerrado** de operaciones: crear, consultar, listar, enviar a revisión, aprobar, rechazar y health.
- Máquina de estados fuente: drafted → in_review → (approved | rejected). Solo una salida terminal debe poder ser elegida; no puede saltarse la etapa de revisión.
- Capacidades selladas: cases.write para crear y modificar estados, cases.read para consultar y public solo para health. La separación real de permisos entre revisión y aprobación sigue PENDIENTE. Sin identidad de operador o separación de deberes reales aún.
- @transition y @audit("state") de TypeSpec con control de carrera en PostgreSQL, sin @reserve ni @release.
- Contrato/IR y Project Passport reproducibles con SHA de fuente, decisiones comerciales/privilegios no resueltos y prueba de deriva.

El texto y estados vienen de la fuente de laboratorio, no de una decisión autenticada del cliente. No hay ejecución de un modelo de IA remoto ni evaluación de propuestas en lenguaje natural.

## Aceptación

CI matricial NestJS / Spring, PostgreSQL desechable:

1. TypeSpec compila y el IR oficial contiene las tres transiciones con capacidades correctas.
2. Tests de seguridad rechazan manipulación de permiso público, estado, transiciones, inyección de un estado, acción arbitraria y artefactos.
3. El caso original debe pasar de borrador a revisión y luego a aprobado, con 10 intentos concurrentes por transición, exactamente uno exitoso.
4. Un segundo caso independiente debe rechazar el salto directo a aprobado, avanzar a revisión, terminar en rechazado con 10 intentos concurrentes y negar aprobación posterior.
5. El expediente aprobado nunca puede quedar también rechazado.
6. El primer dominio de inventario y el segundo de cupos de cursos siguen pasando sus suites sin cambios semánticos.
7. Passport preserva preguntas sobre identidades y apelaciones como pendientes, nunca inferidas por el generador.

Para reproducir:

~~~sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:vnext
node --test tests/research/typed-review-workflow.test.mjs
node scripts/research/review-workflow-intake.mjs generate research/autonomous-engineering/samples/review-workflow-source.json /tmp/review-contract
./node_modules/.bin/tsp compile /tmp/review-contract
npm run app:build -- /tmp/review-contract --target nestjs --out /tmp/review-app
npm run app:test -- /tmp/review-app
~~~

**No es aún un workflow empresarial completo:** no hay autenticación del revisor de negocio, notificaciones, firmas externas, adjuntos, apelaciones ni reglas por tiempo. El operador de estados se demuestra en un grafo acotado y seguro; no autoriza arbitrariamente flujos definidos por agentes.
