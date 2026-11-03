# P2 — Autorización por operación en grafos de estados (v0.4)

**Alcance**: experimento aislado, sin IAM productivo ni separación de deberes por identidad real.

## Hito

El ensamblador `state-only-operator-grammar.mjs` conserva el formato v0.3 sin cambios. El formato opt-in `protocolia-operator-assembly/v0.4` requiere `authorizationProfile=submit-decide/v1` y un grafo de tres transiciones: una desde el estado inicial hacia revisión y dos salidas terminales excluyentes.

Las capacidades se derivan, no son libres ni definidas por un agente:

- `<entidad>.write`: crear el expediente (sin permiso de presentar).
- `<entidad>.read`: consultar y listar.
- `<entidad>.submit`: únicamente pasar del estado inicial a revisión.
- `<entidad>.decide`: cualquiera de las dos decisiones terminales. Aprobación y rechazo siguen compartiendo este permiso.

El validador independiente `packages/adapters/transition-authority.mjs` es utilizado por los generadores NestJS y Spring. Solo admite capacidad por transición si encuentra un único recurso, exactamente las operaciones CRUD + tres transiciones auditadas + health, ninguna reserva/liberación/efecto externo, estados alcanzables con bifurcación final y los nombres de capacidades derivados. Cualquier cambio al grafo o privilegio no aprobado detiene la generación. Los contratos antiguos siguen exigiendo el permiso de escritura por entidad.

## Prueba funcional

El runner local `app:test` conserva sus bases Docker/PostgreSQL desechables y nunca lee credenciales del cliente. Solo para el grafo revisado crea un tercer sujeto de **demo**, con permisos de lectura y presentación pero no creación/decisión. La conformidad comprueba:

1. El usuario acotado puede iniciar la revisión.
2. Ese usuario recibe HTTP 403 al crear, aprobar o rechazar.
3. El usuario manager puede tomar la decisión final; no hay bypass de estado.
4. Diez decisiones concurrentes para el mismo expediente producen un único éxito y nueve conflictos.
5. La decisión opuesta después del cierre recibe conflicto; las suites antiguas de reservas, finanzas y estados siguen intactas.

La CI verifica v0.3 con ReviewCase en NestJS y Spring, v0.4 con ServiceTicket en ambos, y ambas fuentes v0.4 en tests unitarios. Las políticas de pruebas se aplican a identidades de demo con permisos de alcance limitado, **no prueban** que un servidor de identidad externo asigne correctamente las capacidades.

## Límites críticos

**Permisos distintos no implican separación de deberes a nivel de expediente**: un administrador con ambos permisos puede presentar y decidir el mismo caso. No existe aún política para impedir que una persona apruebe su propia solicitud. Tampoco se verificó autoría del documento fuente ni autorización genuina del propietario. Este hito no implementa firma digital de aprobadores, reglas por organización, consentimiento ni publicación productiva.

**Próximo hito**: vincular la autorización por operación a identidad y sujeto del negocio (maker-checker) con pruebas de ausencia de autoaprobación, sin comprometer el contrato financiero S2c. En paralelo P1 sigue necesitando modelos remotos auténticos y evaluación independiente.
