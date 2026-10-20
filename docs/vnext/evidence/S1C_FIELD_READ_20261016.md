# S1c — Lectura condicional de campos sensibles desde TypeSpec

**Fecha:** 2026-10-16. **Estado:** PASS en NestJS/Spring/PostgreSQL/Chromium y regresión independiente Bomberos PASS.

## Contrato y garantías

El nuevo `@readCapability` se declara en una propiedad del modelo fuente, no en una configuración React específica de una aplicación:

```typespec
@entity
model PrivateNote {
  @publicIdentity noteCode: string;
  @ownerIdentity owner: string;
  title: string;
  @readCapability("notes.private.read") @maxLength(180)
  privateMemo?: string;
}
```

Una cuenta con `notes.read` **pero sin `notes.private.read`** puede acceder a los registros de los que es titular y recibir su título; el JSON de respuesta no contiene la clave `privateMemo`. La propiedad TypeSpec es opcional, de modo que esta omisión satisface la estructura pública declarada. Una sesión con el permiso específico recibe el valor original de texto, sin cambiar reglas de propiedad ni modificar el registro guardado.

- Decorador `@readCapability` → IR tipado `field.readCapability` → manifiestos generados de Nest y Spring, permisos de lectura de campo **sólo para el perfil manager** (lector básico sin ese permiso) → filtro de respuesta autorizado del servidor.
- Nest redacciona los registros retornados por `create`, `get`, `patchFields` y los `items` de `listPage` antes de `res.json`; la capacidad usada proviene de la sesión verificada, nunca del cliente.
- Spring añade `readCapability` al campo del manifiesto Java y concede `FIELD_READ_CAPABILITIES` sólo al perfil manager. La respuesta de los mismos comportamientos se copia y filtra según `Authentication.getAuthorities()`.
- El frontend compartido filtra columnas de lista y propiedades del detalle conforme a capacidades devueltas por `/api/_protocolia/me`, sin confiar en ello como única barrera de seguridad.
- Contrato fail-closed: S1c se habilita sólo para un recurso `@ownerIdentity`; máximo dos campos guardados; sólo string opcional no nullable, no PK/FK/owner, no estados, no campos computados ni reglas condicionales; permiso independiente, no `public` ni usado por create/get/list/patch. Rechazo en compilación TypeSpec y en validación de IR manipulado.

## Evidencia de aceptación

**Commit funcional:** [`c5cf17492dd56b1b2ab5d2e2dbefd941dd1602e1`](https://github.com/barbasmarcosi/ProtocolIA/commit/c5cf17492dd56b1b2ab5d2e2dbefd941dd1602e1).

- [S1c conformance #38912768040](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38912768040) — **SUCCESS**, ambos backends con PostgreSQL descartable. Logs `PROTOCOLIA_S1C_FIELD_READ_PASS` con `privateReadCapability:true`, `omittedInDetailAndPage:true` y dos identidades distintas. Nest incluye Chromium móvil y artifact `s1-owner-mobile`.
- Oráculo positivo: manager tiene `notes.private.read` y su nota creada con `privateMemo="Manager top secret"` devuelve el texto exacto en POST/GET, luego en PATCH y en la página de lista; el creador mantiene su titularidad.
- Oráculo negativo: reader tiene `notes.read` pero no `notes.private.read`. Una nota propia sembrada desde PostgreSQL descartable contiene `private_memo` con contenido; el GET y listPage del usuario reader omiten completamente la propiedad. El conteo sigue aislado por titular, y los accesos a registros ajenos devuelven 404.
- Pruebas TypeSpec e IR malicioso incluyen propiedad que pasa de opcional a requerida, capacidad `notes.read`, `notes.title.write` o `public`, referencia no autorizada y falsificación en DTO.
- Browser: manager crea una nota con `privateMemo` desde el formulario React generado, abre el detalle y observa su contenido; edita `title` con permiso independiente y persiste tras reinicio.
- [Quality específica #38912767396](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38912767396) **SUCCESS** sobre el mismo SHA.
- Integración protegida por fast-forward desde `52c96160a3ba5f8a0185c0706931aa352fe236d7` a `c5cf17492dd56b1b2ab5d2e2dbefd941dd1602e1`. [Regresión Bomberos #38913205634](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38913205634) **SUCCESS** en ambos adaptadores y Chromium, y [quality integrada #38913205539](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38913205539) **SUCCESS**.

## Limitaciones

1. Es una primera **redacción por campo opcional sobre entidades privadas aisladas**. No equivale a un motor ABAC genérico, no maneja permisos por fila compartida, tenants/equipos ni proyecciones con relaciones, queryPage, auditoría o aggregations.
2. El lector demo únicamente tiene lectura general y el manager tiene todas las capacidades; no hay autorización OIDC/JWT productiva, roles personalizables ni un tercer sujeto con combinaciones de permisos arbitrarias. La interfaz móvil probada corresponde al manager, no se afirma una inspección visual automática de sesión reader.
3. S1a/S1b todavía no impiden colisiones de ID público global (409 puede revelar que una clave ya existe). No hay RLS ni GRANT por usuario de DB; una escritura SQL con privilegios del backend puede manipular datos.
4. Sólo se controla la proyección HTTP de las operaciones enumeradas; el campo privado **no está cifrado en almacenamiento**, y no se garantiza protección frente a registros/logs externos, volcados SQL o acceso a la base.
5. Migración en producción, integraciones externas, vínculo cross-entity con autorización, revocación y observabilidad de acceso son pendientes. `main`, PR #52, Neon persistente y Railway UX9 permanecen sin cambios. La regresión no completa automáticamente los 16 requisitos de Bomberos.

**Siguiente etapa:** S1d provisión de sujetos con capacidades parciales, vínculos autorizados entre entidades y endurecimiento de unicidad/privilegios en almacenamiento.
