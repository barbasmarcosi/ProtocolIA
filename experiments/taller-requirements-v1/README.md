# ProtocolIA — P5 prueba de requerimientos independientes: Taller

**Rama independiente; no se modifica main ni el experimento congelado P4.**

## Requerimientos fijados antes de generar

Gestionar herramientas con código único obligatorio (1–64), nombre obligatorio
(1–255), cantidad >=0 y fecha opcional/nula de última revisión. Se necesitan:
crear (201, 409 duplicado), obtener por código (200/404), paginar listado
(limit 1–50, offset 0–1.000.000), incrementar cantidad de forma concurrente
(1–1000, sin overflow) y renombrar con validación. Lectura/escritura tienen
capacidades separadas, aplicadas en la API.

## Aplicación pública de demo (Render Free)

Un Web Service Docker incluye Java/Spring y PostgreSQL 16 únicamente en
loopback. `/health` y el frontend se pueden consultar sin autenticar; la
API de datos exige Basic Auth con credenciales de demo configuradas en Render.
Las contraseñas NO forman parte del repositorio. **PostgreSQL es descartable
y puede resetearse entre despliegues/suspensiones. No usar datos reales.**

Se cargan 4 herramientas iniciales mediante Flyway, no datos codificados en
la interfaz. La compilación Docker exige un smoke E2E HTTP con PostgreSQL real
(201, 200, 400, 401, 403, 404, 409, concurrencia), y validación de código
generado, Java y TypeScript.

## Proveniencia / propiedad

- `contract.json`, `resources.json`, `http-errors.json`: autores de los
  requisitos, introducidos a mano en el formato v0.4 soportado.
- `/bundle/*`: creado por `protocolia compile-bundle`.
- `/gen/upstream/*`: creado por OpenAPI Generator 7.26.0, no escrito a mano.
- `/web/src/generated/orval/*`: creado por Orval 8.41.0.
- React/RJSF: **componentes personalizados adaptados** de G5, mientras
  los tipos/validación de formularios provienen de JSON Schema y las vistas
  de manifiestos. No se afirma que ProtocolIA haya dibujado la UI.
- `ToolInventory.java`, `ToolsDelegate.java`, `DemoSecurity.java`,
  migraciones Flyway, Docker y `start.sh`: **código humano**, necesario
  porque ProtocolIA no genera automáticamente SQL, lógica ni IAM.

Se registrarán los resultados reales del deployment y problemas encontrados.
