# P2 — Gramática de operadores semánticos componibles v0.1

Estado: investigación experimental. No representa autorización humana ni un generador universal.

## Cambio arquitectónico

En lugar de codificar una plantilla por dominio, la gramática acepta un JSON acotado con dos entidades y nombres de campos propios. Construye un grafo tipado validado y emite TypeSpec. Compone tres operadores previamente soportados por ProtocolIA: reserva transaccional al crear un registro, transiciones auditadas y una liberación compensatoria terminal.

La fuente de laboratorio EquipmentPool/EquipmentClaim reserva disponibilidad al crear la solicitud. Aprobar conserva la reserva y rechazar devuelve unidades una sola vez. Los tests incluyen una segunda configuración RentalAssets/RentalRequest con otras entidades, campos y una etapa de revisión intermedia. No se copiaron contratos TypeSpec fijos.

## Garantías y límites

La gramática rechaza campos desconocidos, inyecciones, privilegios libres, SQL, scripts, rutas inseguras, ciclos de estados, compensación no terminal, ausencia de reserva o de una única liberación. Admite exactamente dos entidades, un operador de reserva, 2–4 transiciones y un único release terminal. El grafo tiene procedencia y hashes; esos hashes NO autentican al propietario. No se implementan precios, IAM real, notificaciones, vencimientos ni reglas comerciales ilimitadas.

## Evidencia de aceptación

Los jobs NestJS y modular Spring generan aplicaciones desde TypeSpec, crean PostgreSQL aislado y comprueban doce reservas concurrentes de dos unidades sobre siete disponibles: 3 éxitos, 9 conflictos, saldo uno. Otros dos registros compiten por un pool de siete unidades: tras reservar cuatro queda tres; aprobar uno no devuelve unidades y rechazar el otro devuelve exactamente dos, saldo final cinco. Ambas decisiones se prueban con diez solicitudes concurrentes y el resultado terminal opuesto debe dar conflicto.

Las pruebas previas de inventario, cupos y revisión se ejecutan como regresión. Project Passport preserva fuentes y preguntas no aprobadas. Los resultados solo deben declararse terminados cuando GitHub Actions confirme la ejecución del commit.

## Reproducción

node --test tests/research/composable-operator-grammar.test.mjs
npm ci --ignore-scripts --no-audit --no-fund
npm run build:vnext
node scripts/research/composable-operator-intake.mjs generate research/autonomous-engineering/samples/composable-equipment-allocation.json /tmp/composable-operators
./node_modules/.bin/tsp compile /tmp/composable-operators
npm run app:build -- /tmp/composable-operators --target nestjs --out /tmp/composed-app
npm run app:test -- /tmp/composed-app

## Próximo paso

Generalizar los operadores versionados y sus contratos de prueba; introducir capacidades por acción de forma segura; integrar propuestas de LLM reales y aprobación humana; completar handoff R4.
