# S1d.2a — Relaciones padre-hijo con autorización por propietario

**Fecha:** 2026-10-16. **Resultado:** PASS específico y regresión independiente Bomberos PASS.

## Contrato generado y alcance

El nuevo fixture independiente `examples/vnext/owner-relations/contracts/main.tsp` define dos entidades privadas `Folder` y `FolderNote`, cada una con un `@ownerIdentity owner: string`. El hijo contiene:

```typespec
@reference("Folder","restrict") @minLength(1) @maxLength(40)
folderCode: string;
```

Las operaciones HTTP de ambas entidades —create, get y listPage— se generan desde TypeSpec para NestJS y Spring Boot con PostgreSQL y React. El ejemplo **no incorpora código manual de aplicación para resolver la relación**.

Al crear `FolderNote` el cliente envía `noteCode,folderCode,title`, nunca `owner`. El backend deriva el propietario de la sesión autenticada; exige la capacidad de escritura de FolderNote **y** la capacidad `folders.read`. La inserción ocurre en una sola sentencia, equivalente a:

```sql
INSERT INTO folder_note (note_code, owner, folder_code, title)
SELECT :noteCode, :subject, :folderCode, :title
WHERE EXISTS (
  SELECT 1 FROM folder
  WHERE folder_code = :folderCode AND owner = :subject
);
```

Si no existe una carpeta del **mismo sujeto**, el servidor devuelve HTTP 400 sin distinguir si la carpeta es inexistente o ajena. Un sujeto que no tenga capacidad de leer padres recibe HTTP 403. La FK RESTRICT de PostgreSQL sigue protegiendo de eliminaciones concurrentes del padre. Las lecturas por identidad, listados y totales de ambas entidades continúan filtrados por propietario y un registro ajeno responde 404.

## Validación fail-closed

- `packages/compiler/src/index.ts` autoriza solamente la arista hijo-propietario → padre-propietario con una FK requerida y `onDelete=restrict`. Rechaza referencias entre entidades protegidas y no protegidas, autocitas, más de una FK, padres que a su vez tengan referencias y relaciones sin protección suficiente.
- `packages/adapters/owner-scope.mjs` vuelve a construir y validar el plan incluso si recibe IR modificado; produce nombre y columna del padre, identidad pública, columna de propietario y capacidad de lectura. No permite que los identificadores SQL provengan de la petición HTTP.
- Ambos adaptadores emiten el plan dentro del manifiesto generado y ejecutan la misma política, sin depender de ocultar controles en React.
- `packages/cli/conformance.mjs` comprende ahora recursos múltiples con `@ownerIdentity`; deja de enviar `owner` desde el cliente y verifica que lecturas/conteos desde otro usuario no lo revelen.

## Evidencia

SHA funcional: [`0b670cddebaebe34c0210e309fa4cf5bf1aae988`](https://github.com/barbasmarcosi/ProtocolIA/commit/0b670cddebaebe34c0210e309fa4cf5bf1aae988).

- [S1d.2a conformance #38918793058](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38918793058): **SUCCESS** en NestJS y Spring. Ambos jobs emiten `PROTOCOLIA_MULTIRESOURCE_CONFORMANCE_PASS` y `PROTOCOLIA_S1D2_OWNER_RELATION_PASS`, usan Docker Compose + PostgreSQL reales y verifican que los cambios sobreviven al reinicio.
- Casos positivos: manager crea un padre propio y un hijo vinculado correctamente; otro sujeto con permisos parciales `folders.read,folderNotes.read,folderNotes.write` crea hijos únicamente sobre su carpeta propia sembrada en PostgreSQL efímero.
- Casos negativos: carpeta inexistente o perteneciente a manager, reader u otro sujeto → 400; manager no puede crear hijos vinculados a padres ajenos; sin capacidad de creación → 403; lectura de hijos y padres ajenos → 404; listados y totales mantienen sólo filas propias.
- Chromium móvil verifica la aplicación React generada, que no expone `owner` en el alta y ofrece únicamente carpetas accesibles en el selector de FK. Crea una nota seleccionando una carpeta propia, comprueba el dato persistido y genera artifact `s1-owner-relation-mobile`.
- `tests/vnext/owner-relations.test.mjs` ejecuta mutaciones adversariales de TypeSpec e IR: parent sin propietario, child sin propietario, FK errónea, parent con FK encadenada, segunda referencia, `onDelete` no restrictivo y ruta no permitida.
- [Quality específica #38918792844](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38918792844): **SUCCESS** sobre el mismo SHA.
- Promoción protegida `expected_sha` desde `990c9c6d62f02c3438d7bdd1d1695c4e24ef49e2` hasta `0b670cddebaebe34c0210e309fa4cf5bf1aae988`. [Bomberos independiente #38919271243](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38919271243): **SUCCESS** NestJS/Spring/PostgreSQL/Chromium; [quality integrada #38919271276](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38919271276): **SUCCESS** sobre el código idéntico.

## Limitaciones, sin excepciones implícitas

1. La política es **una única relación directa** hijo → padre, ambos propietarios del mismo usuario y sin relaciones del padre a otras entidades. No hay jerarquías, pertenencia compartida, acceso por equipo, proyecciones por joins, agregados complejos ni cambios de FK posteriores al alta.
2. El modo de autenticación permanece Basic de demostración explícitamente opt-in, incluida tercera identidad con capacidades parciales. No hay OIDC/JWT productivo, revocación ni permisos externos.
3. Las claves públicas siguen siendo globalmente únicas. Un error 409 al crear un ID que otro usuario ya posee puede filtrar la existencia de esa clave. S1d.2a no corrige este punto.
4. No hay PostgreSQL RLS/GRANT por sujeto. Los controles protegen las rutas API; un actor con acceso directo a las credenciales de BD del backend puede alterar asociaciones.
5. No se desplegaron ni migraron datos de Railway/Neon. `main` y PR #52 permanecen intactos. La regresión Bomberos no demuestra cierre completo de sus 16 requisitos.

**Siguiente:** identidad productiva validada y políticas declarativas ampliadas con ensayos de concurrencia, filtrado multientidad y límites de privilegios SQL.
