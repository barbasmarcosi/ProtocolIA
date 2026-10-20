# S1a — Propiedad de registros autenticada y aislamiento por fila

**Fecha:** 16/10/2026. **Estado:** PASS en NestJS/Spring, PostgreSQL/HTTP, Chromium; regresión independiente Bomberos PASS.

## Semántica declarativa

En `examples/vnext/owner-scope/contracts/main.tsp`, `PrivateNote` tiene una identidad pública `noteCode`, un campo propietario `@ownerIdentity owner: string` con longitud máxima 128 y un `title`. El DTO de creación sólo contiene `noteCode,title`: **no** admite el campo `owner`.

- NestJS: en create, el servidor rechaza `owner` recibido, toma `username` de la sesión autenticada, valida e inserta esa propiedad; GET y listPage consultan `owner=$n` con parámetros SQL. El SELECT de paginación y su `COUNT(*)` aplican la misma guarda.
- Spring: la entidad generada identifica el nombre/columna propietario; `create` toma `Authentication.getName()` y rechaza input `owner`; GET y lista usan `NamedParameterJdbcTemplate` con `owner=:owner`. El conteo devuelve únicamente filas autorizadas.
- `GET` de un registro ajeno devuelve **404** igual que un ID inexistente. No se ofrece una respuesta que revele si el ID pertenece a otro sujeto. Los listados filtran los datos y el total, incluido offset.
- React: los formularios de alta omiten cualquier campo `ownerManaged`, mientras que detalle/lectura conserva el contexto que corresponde al usuario.
- El compilador y `packages/adapters/owner-scope.mjs` aplican fail-closed: propietario único, requerido, no nullable, tipo string con límites adecuados y sin referencias; exigen **sólo** un create/get/listPage y deniegan operaciones adicionales sin filtro explícito. Niegan relaciones entrantes/salientes para evitar filtraciones mediante joins en S1a. El `health` público no participa en el cierre de recursos.

## Evidencia verificable

**SHA funcional:** [`d6c2d5c432488364000ac4ac73c1104b9a20b177`](https://github.com/barbasmarcosi/ProtocolIA/commit/d6c2d5c432488364000ac4ac73c1104b9a20b177).

- [CI S1a #38906688595](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38906688595), **SUCCESS** en ambas variantes. Ambos jobs imprimen `PROTOCOLIA_OWNER_SCOPE_CONFORMANCE_PASS` (verificador genérico actualizado) y `PROTOCOLIA_S1A_OWNER_PASS` (oráculo independiente de dos sujetos).
- El oráculo genera una app nueva desde el TypeSpec, crea `PrivateNote` del sujeto manager y comprueba que su `owner` derivado es exactamente el sujeto autenticado. El cliente que envía `owner` recibe 400 y un lector no autorizado a crear recibe 403.
- `manager` no puede leer una nota de `reader`, ni `reader` una nota de `manager`: ambos reciben 404 aun con ID correcto. El test inserta una segunda nota con propietario reader mediante SQL exclusivo de la base PostgreSQL descartable, porque reader del demo es sólo lectura; esa nota sí resulta legible para reader y no para manager. Se verifican totales aislados, página con offset, 401 sin autenticación, duplicado 409 y persistencia tras reinicio.
- Chromium ejecuta en viewport móvil la creación React con `noteCode` y `title`, verifica que **no existe** input `create-owner` y consulta la propiedad persistida y el 404 del otro usuario. Captura `s1-owner-mobile.png` conservada como artifact de Actions.
- [Quality de feature #38906688274](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38906688274) **SUCCESS** sobre el mismo SHA.
- Promoción lineal por fast-forward protegido `expected_sha` de `557614b3a955b8c729051c77d6099d2990cfbea1` a `d6c2d5c432488364000ac4ac73c1104b9a20b177`, sin modificar `main`.
- [Regresión independiente Bomberos #38907038097](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38907038097) **SUCCESS** para NestJS/Spring/PostgreSQL/Chromium y [quality integrada #38907038134](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38907038134) **SUCCESS** sobre el SHA exacto.

## Alcance y riesgos pendientes

1. S1a protege **filas por titular autenticado** y un campo **gestionado exclusivamente por servidor**. No hay políticas de lectura selectiva/redacción de campos, permisos basados en atributos, transferencias de propietario, servicios multiusuario ni reglas por proyecto/equipo.
2. S1a sólo acepta un recurso independiente con create/get/listPage y no permite relaciones con modelos protegidos. El generador falla cerrado si se introducen operaciones que todavía no tienen guarda. No está probado aún con `queryPage`, audit, transiciones, delete, relaciones, agregados, referencias externas ni flujos de escritura parcial.
3. El sujeto procede de `Authentication.getName()` en Spring o el `username` validado por Basic en Nest, ambos en el perfil de demostración explícitamente opt-in. **No equivale a OIDC/JWT productivo con issuer/audience, rotación, MFA, revocación y provisioning**.
4. Hay parametrización SQL desde el runtime pero no PostgreSQL RLS, grants SQL por usuario, o límites de privilegios del propio dueño de la conexión. Un SQL directo con credenciales del backend puede alterar `owner`; el oráculo utiliza deliberadamente esa capacidad exclusivamente en una BD temporal. No confundir API-only authorization con un límite frente a DBAs.
5. Las reglas son **opt-in**: un contrato que quite `@ownerIdentity` ya no expresa propiedad y no recibe sus garantías. El verificador comprueba los contratos que sí declaran la anotación; la revisión de contratos sigue siendo esencial.
6. No se aplicaron migraciones a datos existentes, ni se modificó Neon ni el servicio Railway UX9. El PR #52 y `main` siguen abiertos/intactos. La regresión no cierra los 16 requisitos congelados de Bomberos.

**Siguiente bloque:** S1b controles por campo/operación y extensión por relaciones manteniendo reglas fail-closed, acompañados de dos sujetos escritores auténticos y políticas de identidad verificadas.
