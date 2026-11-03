# P2 — Maker-checker por identidad de expediente (opt-in v0.5)

**Alcance:** investigación implementada con prueba HTTP/PostgreSQL. No equivale a autorización empresarial o despliegue productivo.

## Problema

El perfil v0.4 separa `entidad.submit` y `entidad.decide`, pero un sujeto que posee ambas capacidades todavía puede presentar y decidir el mismo expediente. La nueva gramática `protocolia-operator-assembly/v0.5` exige `authorizationProfile=maker-checker/v1`; produce `entidad.submit` para pasar a revisión y el permiso distintivo **`entidad.decide.checked`** para cualquiera de las dos decisiones finales. Los perfiles v0.3/v0.4 conservan su comportamiento y no heredan la restricción por accidente.

## Garantía

Ambos generadores aceptan únicamente un recurso, tres transiciones auditadas, inicio único y dos terminales sin efectos externos. Solo para el perfil revisado agregan a la tabla de negocio una columna **server-managed** `protocolia_submitted_by VARCHAR(128)` nullable mientras el expediente está en borrador. No forma parte del contrato público TypeSpec, del body ni de los datos serializados al cliente.

Presentar un caso ejecuta un UPDATE condicionado por el estado inicial y `protocolia_submitted_by IS NULL`, guarda el **subject autenticado** y cambia el estado en la misma sentencia SQL. La decisión terminal utiliza otro UPDATE atómico con estado previo, maker no nulo y `protocolia_submitted_by <> authenticated_subject`. Si el mismo sujeto intenta decidir un caso todavía en revisión, recibe HTTP 403 y el estado no cambia. Si la transición ya ocurrió o quedó obsoleta, recibe conflicto 409.

NestJS ejecuta transición + auditoría dentro de BEGIN/COMMIT. Spring mantiene la transacción de su despacho, con la transición y el registro de auditoría en la misma transacción. Los dos generadores usan parámetros SQL, y no se permite autoría enviada desde el cliente.

## Criterio de aceptación

Se mantienen las pruebas v0.3 ReviewCase y v0.4 ServiceTicket; se agrega v0.5 ServiceTicket, cada uno generado con NestJS y Spring y PostgreSQL descartable: seis jobs independientes.

- Usuario de demo con `serviceticket.submit` y lectura puede presentar, pero recibe 403 al crear o decidir.
- Manager con ambos permisos puede decidir un expediente presentado por ese otro sujeto; diez solicitudes concurrentes producen una válida y nueve conflictos.
- Manager crea y presenta **su propio** expediente, pero aun con permiso `decide.checked` recibe 403 tanto al aprobar como al rechazar; la fila permanece en revisión.
- Reintentar presentar no cambia la identidad almacenada; transiciones finales opuestas siguen excluidas.
- El IR/tipos/locks y las versiones v0.3/v0.4 se preservan. Los cambios en el catálogo, privilegios y efectos no aprobados se rechazan.

## Límites

El atributo de identidad debe proceder de un autenticador realmente confiable y tener un identificador estable. En pruebas se usan cuentas demo independientes, no IAM empresarial. Dos cuentas diferentes de una misma persona serían dos sujetos distintos: **todavía no hay reconciliación de identidades, pertenencia a organización ni política cross-tenant**. No hay firma humana del dueño del modelo ni evaluación de agente LLM real.

También es una protección sobre el camino de escritura generado, con precondiciones SQL atómicas; un administrador de base de datos con permisos irrestrictos podría modificar la fila directamente. El aislamiento de roles DB y una política adicional a nivel de base requerirían otro hito.

**Próximos hitos:** identidad empresarial y esquema multi-tenant, una política de aprobación más de una persona, auditorías negativas de acceso directo DB, P1 entrada LLM real y R4 traspaso limpio de agente.
