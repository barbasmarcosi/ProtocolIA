# P2 — Composición de transiciones sin reserva (gramática v0.3)

**Alcance:** avance de investigación sobre las capacidades verificadas de ProtocolIA. No habilita reglas de negocio arbitrarias ni autorización humana.

## Problema que resuelve

Hasta ahora el ensamblador v0.2 exigía una entidad de capacidad, un registro contable de reserva y una transición compensatoria. Esa restricción impedía reutilizar el operador versionado `state.transition-audited@1` sin construir una plantilla nueva. La gramática opt-in `protocolia-operator-assembly/v0.3`, `profile=state-only`, habilita **una sola entidad con estados auditados**. Solo exige `operatorVersions.transition = state.transition-audited@1`; no simula reservas o devoluciones inexistentes.

El generador `scripts/research/state-only-operator-grammar.mjs` admite nombre de entidad, ruta, identidad, etiqueta, campo de estado y **3–5 aristas acíclicas**, todos definidos por una fuente con claves estrictamente validadas. Las reglas compartidas en `operator-catalog-v1.mjs` comprueban alcanzabilidad desde el estado inicial, nombres únicos, prohibición de uniones ambiguas y al menos dos estados terminales. Los permisos se fijan a lectura/escritura de la entidad y health público; la fuente no puede otorgar privilegios nuevos.

## Dos esquemas, un solo operador

| Fuente | Entidad | Secuencia y bifurcación |
|---|---|---|
| `state-only-review-v03.json` | `ReviewCase` | drafted → in_review → approved / rejected |
| `state-only-service-ticket-v03.json` | `ServiceTicket` | reported → triaged → completed / dismissed |

Ambas usan el mismo generador y fijan el mismo catálogo. La compatibilidad con el perfil anterior `typed-review-workflow/v0.1` se inspecciona a nivel de campos, endpoints y transiciones. El contrato v0.3 nuevo no reemplaza ni altera el generador legado.

## Contratos y pruebas

`scripts/research/state-only-operator-intake.mjs` emite TypeSpec, `semantic-ir.json`, huellas y pins de catálogo, requerimientos, decisiones abiertas, informe y lock reproducible. El origen es sintético y **no autentica al dueño**.

La CI del PR contiene cuatro ejecuciones independientes de aplicaciones generadas: ReviewCase/NestJS, ReviewCase/Spring, ServiceTicket/NestJS y ServiceTicket/Spring. En cada una, TypeSpec y Project Passport se verifican antes de la aplicación. PostgreSQL debe demostrar la transición a la etapa intermedia, una decisión terminal con diez solicitudes concurrentes (un éxito, nueve conflictos), otro registro con la decisión terminal alternativa, prohibición de salto directo y prohibición de cambiar un resultado final. La prueba es **genérica por grafo**, no por nombre `ReviewCase`.

El catálogo v0.2 de reservas se mantiene intocado y deben pasar regresiones de inventario, cupos, estados, firmas y finanzas S2c.

## Limitaciones

No se admiten transiciones con efectos secundarios, SQL/JS arbitrario, operaciones destructivas, reglas monetarias, calendarios, tareas en segundo plano ni identificación de aprobadores. Los adaptadores actuales aplican una capacidad de escritura por entidad, por lo que **no está comprobada la separación de roles entre quien presenta y quien aprueba**. El catálogo no autoriza nuevas versiones automáticamente.

Para reproducir desde la raíz del repositorio:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:vnext
node --test tests/research/state-only-operator-grammar.test.mjs
node scripts/research/state-only-operator-intake.mjs generate research/autonomous-engineering/samples/state-only-service-ticket-v03.json /tmp/protocolia-state-only
./node_modules/.bin/tsp compile /tmp/protocolia-state-only
npm run app:build -- /tmp/protocolia-state-only --target nestjs --out /tmp/state-only-app
npm run app:test -- /tmp/state-only-app
```

**Próximo hito:** combinaciones de operadores sin exigir estructuras fijas y autorizaciones por operación, con tests semánticos independientes en ambos adaptadores. P1 de agente real y P3/R4 de traspaso entre agentes permanecen pendientes.
