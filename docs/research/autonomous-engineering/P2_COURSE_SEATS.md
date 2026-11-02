# P2: Segundo dominio independiente — cupos de cursos

**Estado:** investigación experimental, aceptación sujeta a GitHub Actions. No desplegar en producción.

## Problema abordado

El primer dominio de ProtocolIA fue inventario. Este segundo dominio representa la inscripción a cursos con capacidad limitada. Para evitar copiar otro contrato TypeSpec fijo, ambos dominios reutilizan el mismo renderizador de IR tipado, con validaciones semánticas independientes.

La fuente sintética research/autonomous-engineering/samples/course-seats-source.json congela:

- CourseSession: sessionCode único, topic y seatsAvailable no negativo.
- SeatBooking: bookingId único, referencia obligatoria a CourseSession, seats positivos y estado inicial confirmed.
- createSeatBooking: resta asientos y registra la reserva en la misma transacción PostgreSQL; una reserva rechazada no queda registrada.
- cancelSeatBooking: transición confirmed → cancelled con auditoría y devolución exactamente una vez.
- Lectura/listado de ambas entidades y health endpoint.

Se parametrizan límites del source, pero la relación, la identidad, los permisos y las ocho operaciones están definidos por el perfil validado y no son editables por un agente.

## Evidencia requerida para CI

El workflow signed-decision-gate-r2 incorpora matriz de dos destinos: NestJS y modular Spring. Cada uno compila el TypeSpec emitido, compara los límites contra el IR real, genera Project Passport, levanta la aplicación y PostgreSQL aislados y debe superar:

- 12 reservas HTTP simultáneas con IDs distintos, de 2 cupos cada una, para sesión con 7 cupos: 3 éxitos, 9 conflictos, saldo 1.
- Integridad de la fila de cada reserva aceptada/rechazada.
- Cancelación compensatoria auditada, segura frente a reintentos concurrentes.
- Pruebas del dominio de inventario anterior para detectar regresiones por refactor.
- Falsificación de permisos, referencias, estados, operaciones, límites y procedencia.

Para reproducir desde la raíz:

~~~
node --test tests/research/course-seat-intake.test.mjs tests/research/stock-semantic-ir.test.mjs
npm ci --ignore-scripts --no-audit --no-fund
npm run build:vnext
node scripts/research/course-seat-intake.mjs generate research/autonomous-engineering/samples/course-seats-source.json /tmp/protocolia-course-seats
./node_modules/.bin/tsp compile /tmp/protocolia-course-seats
npm run app:build -- /tmp/protocolia-course-seats --target nestjs --out /tmp/course-seats-nest
npm run app:test -- /tmp/course-seats-nest
~~~

## Limitaciones y siguientes hitos

Esta es una aplicación de laboratorio sobre cupos, NO un sistema de turnos completo. No implementa horario/calendario, zona horaria, solapamientos, instructor, alumnos identificados, precios, cobros, devoluciones o permisos de cancelación por titular. La fuente está etiquetada como no verificada por un propietario.

La cancelación es una compensación de cupos, no un reembolso comercial. Las capacidades técnicas de los endpoints no definen identidad productiva. No hubo ejecución de un modelo externo ni benchmark ciego de agentes.

Este hito valida reutilización de un operador transaccional en un segundo dominio. Sigue pendiente: operadores semánticos componibles, agente con entrada natural independiente, aprobación humana real, R4 clean-room, UX del operador y beta.
