# S1d.1 — Identidad opcional con capacidades parciales, verificación HTTP en 3 sujetos

**Fecha:** 2026-10-16. **Estado:** PASS específico y regresión Bomberos integrada PASS.

## Objetivo y diseño

Este incremento resuelve una limitación probatoria de S1a–S1c: antes sólo había un perfil demo manager con todos los permisos y un reader sin permisos de escritura ni lectura de campos privados. Ahora se puede probar una **tercera combinación de capacidades, configurada por el servidor**, sin que el cliente elija ni altere sus propios grants. El código funcional exacto es [`94ee817a04fccbd93a56cbc896a32fcd4c9084c5`](https://github.com/barbasmarcosi/ProtocolIA/commit/94ee817a04fccbd93a56cbc896a32fcd4c9084c5).

```text
PROTOCOLIA_ALLOW_DEMO_AUTH=true
PROTOCOLIA_SCOPED_USERNAME=<identidad-distinta>
PROTOCOLIA_SCOPED_PASSWORD=<secreto-de-al-menos-16-caracteres>
PROTOCOLIA_SCOPED_CAPABILITIES=notes.read,notes.private.read
```

Es una extensión **test-only** del modo Basic opt-in, no un proveedor productivo de identidad. La tercera identidad es opcional; si no se suministran sus tres variables, el comportamiento anterior permanece intacto. Si se intenta configurarla parcialmente o con un permiso no declarado, el arranque se rechaza.

## Invariantes y controles

- NestJS comprueba el trío de variables en el constructor del servicio, exige tres valores no vacíos, contraseña de al menos 16 caracteres y nombre distinto (case-insensitive) de reader/manager. Las capacidades deben existir literalmente en el manifiesto generado: read, write, audit, assign o field read. Se rechazan permisos públicos, repetidos, inexistentes y más de 16. La sesión autentica el tercer sujeto por credenciales y devuelve sólo su lista autorizada.
- Spring configura el mismo usuario opcional con `InMemoryUserDetailsManager`, credencial con bcrypt y authorities calculadas desde el manifiesto, con los mismos rechazos de arranque. `/api/_protocolia/me` filtra cualquier autoridad técnica propia de Spring Security: devuelve sólo capacidades declaradas, por ejemplo excluye `FACTOR_PASSWORD`.
- El archivo Compose y `.env.example` de ambos generadores incorporan variables **opcionales** sin publicar contraseñas ni permitir que HTTP body/query/headers definan el perfil.
- Ni backend ni React confían en un encabezado `X-ProtocolIA-Capabilities` para conceder permisos. Las decisiones siguen aplicándose en API y en SQL de propietario.

## Evidencia

- [Aceptación S1d.1 #38916049842](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38916049842): **SUCCESS** NestJS y Spring Boot en PostgreSQL efímero, con logs `PROTOCOLIA_S1D_PARTIAL_AUTH_PASS` que incluyen `thirdSubject`, `exactPartialGrants` y `unknownGrantFailsClosed`; Nest incluyó Chromium móvil con artifact.
- El tercer sujeto `scope_private_reader`, con exactamente `notes.private.read` y `notes.read`, obtiene su propia nota con contenido privado, ve una única fila propia y su total, no ve las filas de manager/reader (404) y no puede crear ni editar notas (403). El oráculo confirma que los datos persisten tras reiniciar el servicio.
- Un PATCH enviando un encabezado de permisos falsificado devuelve 403, no escalamiento de privilegios. El oráculo de arranque ejecuta un contenedor adicional con una capacidad desconocida `notes.nonexistent` y exige error explícito de validación, en ambos backends.
- Chromium móvil inicia sesión como manager, crea/edita una nota; luego inicia como el tercer usuario, comprueba que su secreto es visible en detalle y que no aparecen acciones de creación ni edición que no tiene autorizadas.
- [Quality específica #38916050277](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38916050277): **SUCCESS**, SHA idéntico.
- Se promovió el SHA funcional por fast-forward protegido desde `f11c0d66efaeabb2e5d08898673d0d867ecbf6bc` a `94ee817a04fccbd93a56cbc896a32fcd4c9084c5` sin tocar main. [Regresión independiente Bomberos #38916508110](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38916508110): **SUCCESS** Spring/Nest/HTTP/PostgreSQL/Chromium. [Quality integrada #38916508466](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38916508466): **SUCCESS** sobre ese mismo código.

## Límites

1. **S1d no está terminado.** Se verificó únicamente la parte de identidades con capacidades parciales en entorno de desarrollo. No hay OAuth/OIDC/JWT, MFA, revocación, servicio de usuarios, grants dinámicos, sesiones productivas ni rotación.
2. No hay row-level security de PostgreSQL ni permisos a nivel SQL; el proceso de backend usa credenciales con privilegios superiores a las de cada sujeto HTTP. No es aislamiento frente a accesos directos a DB.
3. No se habilitaron relaciones entre entidades protegidas. Continúan prohibidas las FK y operaciones que pudieran atravesar la barrera de titularidad sin un modelo declarativo verificado.
4. No está solucionada la posible filtración por conflicto 409 cuando dos propietarios eligen la misma identidad pública global; usar IDs opacos o definir unicidad compuesta para escenarios de alta confidencialidad.
5. Las autoridades parciales se configuran como variables de entorno **sólo para prueba**. No hay interfaz administradora de permisos ni asignación por organización. No se desplegó en Railway ni se modificó Neon, `main` o PR #52. Tampoco significa cerrar los 16 requisitos congelados de Bomberos.

**Siguiente incremento:** S1d.2 seguridad relacional y autenticación productiva, con sujeto y capacidades verificables por un proveedor independiente de la aplicación.
