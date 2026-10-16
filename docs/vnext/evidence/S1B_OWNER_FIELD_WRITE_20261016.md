# S1b — Edición limitada a un campo y al titular

**Fecha:** 16-10-2026. **Estado:** PASS S1b en ambos backends; regresión independiente Bomberos PASS.

## Contrato y código

SHA validado: [`d21b5c7a360a6d1de1c1be4614b913558ff1d0bf`](https://github.com/barbasmarcosi/ProtocolIA/commit/d21b5c7a360a6d1de1c1be4614b913558ff1d0bf).

`examples/vnext/owner-scope/contracts/main.tsp` define:

```typespec
model NoteTitleUpdate {
  @minLength(1) @maxLength(90) title: string;
}
@route("/api/notes/{noteCode}/title") @patch
@behavior("patchFields","PrivateNote","title","title")
@capability("notes.title.write")
op updateNoteTitle(@path noteCode: string, @body input: NoteTitleUpdate):
  PrivateNote | BadRequest | NotFound | Unauthorized | Forbidden;
```

- Propietario de `PrivateNote` asignado exclusivamente desde la sesión Basic del perfil de prueba; cliente no puede declararlo ni modificarlo.
- A lo sumo un PATCH por entidad protegida, exactamente un campo string requerido, sin FK, `@initial`, cómputo, identidad pública o propiedad owner. Su DTO no puede tener propiedades extra y debe mantener los límites originales del campo.
- `notes.title.write` es distinto de `notes.write` y `notes.read`. Manifest y endpoints lo verifican sin delegar autorización al frontend.
- En Nest, UPDATE parametrizado `WHERE note_code=$2 AND owner=$3`; en Spring, condición `WHERE note_code=:key AND owner=:owner`. UPDATE y protección comparten **una sentencia**, el intento sobre registro ajeno afecta cero filas y devuelve 404; la lectura de respuesta vuelve a filtrarse.
- Validadores fuente e IR rechazan PATCH contra owner, clave, campo distinto, privilegios conflados, DTO ampliado, segundo PATCH y mutación clandestina de clase DELETE.
- El editor de campo React se genera desde las mismas operaciones, sólo visible con la capacidad `notes.title.write`.

## Aceptación real

[Conformance S1b #38908894479](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38908894479): PASS matriz NestJS + Spring Boot sobre PostgreSQL descartable y HTTP independiente. Logs finales `PROTOCOLIA_S1B_OWNER_FIELD_PASS`: creación en nombre del sujeto auténtico, propietario falsificado 400, actualización propia 200, request con owner o dos propiedades 400, título vacío 400, usuario sin capacidad 403, identidad inexistente 404, intento sobre registro ajeno 404 incluso para manager con permiso de edición. Segundo registro de reader fue sembrado por SQL **sólo en la BD desechable**, para demostrar que su contenido permanece sin alteración. Totales paginados aislados y persistencia tras restart también PASS. Chromium verificó la edición desde el detalle React móvil.

[Quality específica #38908894531](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38908894531) PASS. Promoción fast-forward protegida `03e6200443939e8db0e28d1576da0d993d6850e9` → `d21b5c7a360a6d1de1c1be4614b913558ff1d0bf`. [Regresión Bomberos #38909355603](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38909355603) PASS en Nest/Spring/PostgreSQL/Chromium; [quality integrada #38909355431](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38909355431) PASS, mismo SHA.

## Límites no resueltos

- **No es control de lectura por campo ni S1 integral.** Es permiso de escritura específico para un único campo de un recurso con propietario; no acepta PATCH múltiple ni relaciones entre entidades, transiciones, borrado, queryPage, agregados o auditoría con propietario.
- Manager demo tiene permisos de crear y modificar; reader sólo de lectura. Falta una identidad con permiso de modificar pero no crear, y otra con permisos de campo parciales, usando autenticación real. No hay OIDC/JWT productivo.
- No hay RLS PostgreSQL. Una conexión directa con privilegios DB puede eludir la autorización de la API.
- Una clave pública global duplicada puede devolver 409 y permitir inferir existencia de una clave ajena mediante POST. Revisar IDs no enumerables o unicidad compuesta antes de reclamar confidencialidad estricta.
- Sin migración de datos, sin cambios a Neon/Railway. `main` y PR #52 intactos; no se cerraron los 16 requisitos congelados de Bomberos.
- Hubo un fallo transitorio anterior de quality Python 3.11 por limpieza concurrente de un directorio temporal de test P4; el gate sobre el SHA final fue PASS.

**Siguiente:** S1c autorización de lectura y redacción de campos con contratos de respuesta honestos y sujetos con permisos diferenciados.
