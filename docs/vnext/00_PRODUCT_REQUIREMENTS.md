# ProtocolIA vNext — Requisitos de producto (documento normativo)

**Estado:** DIRECCIÓN DE PRODUCTO APROBADA (documento de alcance normativo, fechado 2026-10-13). **Implementación posterior en curso:** A0–A12 y prueba independiente A13 realizadas en perfiles acotados; consultar [estado real](../EXECUTION_STATE.md) y [aceptación A13](evidence/A13.md).  
**Fecha:** 2026-10-13. **Responsable lógico:** ProtocolIA / contrato-a-sistema.  
**Precedencia:** este documento, [arquitectura](01_ARCHITECTURE_ADR.md), [plan](02_IMPLEMENTATION_PLAN.md) y [matriz de pruebas](03_ACCEPTANCE_MATRIX.md) rigen el desarrollo **vNext**. G0–G5, P0–P4 y sus evidencias siguen siendo hechos históricos, no pruebas de vNext.

## 1. Problema, usuario y promesa

**Problema.** El piloto Books G5 y el experimento Taller prueban que ensamblar manualmente HTTP, persistencia, controles de acceso, cliente tipado y UI es posible. No prueban que ProtocolIA genere por sí solo un sistema entero: el código SQL, Java, React y Docker del Taller todavía fue escrito y adaptado a mano. Esta es la brecha a cerrar, por encima del ahorro de tokens.

**Usuario objetivo.** Una persona técnica o un agente que analiza los requerimientos, resuelve las ambigüedades de negocio y escribe los **contratos de aplicación**. A partir de allí, ProtocolIA debe producir un sistema base utilizable sin implementar código específico del negocio dentro del perfil soportado.

**Promesa verificable.** Para un perfil de contrato y destino declarado como SOPORTADO: `contracts → validate → build → test → run/deploy` produce un sistema con API real, transacciones, datos persistentes, UI navegable, permisos aplicados en servidor y pruebas, **sin retoques de código por entidad después de cerrar los contratos**.

**No es la promesa:** resolver requisitos ambiguos automáticamente; inventar reglas; generar cualquier software imaginable; ser production-ready por defecto; demostrar menos tokens; ejecutar código de los contratos como un agente privilegiado.

## 2. Decisiones vinculantes

- **Fuente de verdad de dominio:** fuentes TypeSpec (`.tsp`) con biblioteca propia de decoradores/validadores `@protocolia/domain` (nombre de paquete de trabajo, sujeto a A0). API, tipos, comportamiento, persistencia, capacidades y exposición UI se declaran allí. La configuración de entorno/destino vive aparte; **no duplica entidades ni reglas**.
- **IR:** modelo semántico canónico **agnóstico a lenguaje, ORM, herramienta generadora y transporte**, con versión estable, validación fail-closed, capacidades soportadas por cada adaptador y compatibilidad semántica.
- **Candidatos técnicos iniciales:** TypeSpec Compiler + emisores estándar OpenAPI/JSON Schema; JHipster 9.4.0 + JDL emitido y React; primer backend Spring Boot, segundo backend NestJS con su blueprint 4.2.0. La integración es **hipótesis de A0** hasta un spike real; `generator-jhipster-nodejs` 4.2.0 declara JHipster 9.4.0 y NestJS 12. .NET se pospone: su blueprint 4.5.0 declara JHipster 8.11.0.
- **Plan de contingencia obligatorio:** conservar el camino modular basado en OpenAPI Generator/Orval, usar persistencia framework y UI declarativa; si JHipster obliga a mantener un fork grande, viola identidad/API o no permite regeneración segura, **descartarlo como motor principal**, sin cambiar los contratos.
- **Perfil inicial:** aplicaciones web de gestión con PostgreSQL; sin proveedor de modelos de pago, sin GitHub Actions obligatorias, sin secretos versionados. Otro almacenamiento/cliente móvil no bloquea el primer resultado.
- **Límite de alcance:** el runtime P3 de acciones privilegiadas y las mediciones científicas P4 quedan aislados de vNext. No mezclarlos con operaciones de negocio ejecutadas en la aplicación generada.

## 3. Requisitos funcionales

| ID | Requisito verificable | Criterio mínimo observable |
|---|---|---|
| FN-01 | Proyecto desde contratos | Un directorio TypeSpec y config de destino constituye la entrada completa; CLI rechaza entradas incompletas antes de generar |
| FN-02 | Tipos y validaciones | Soportar tipos escalares elegidos, required/opcional/null, límites, formatos, enumeraciones y errores HTTP; validación coherente UI/API/DB |
| FN-03 | Entidades | Identidad declarada (natural o técnica), campos persistidos, unique, índice, default y nullability; alias entre identidad pública e interna sin filtrar semántica |
| FN-04 | Relaciones | `many-to-one` y `one-to-many` como primer subconjunto; integridad referencial y selectores UI; restantes se marcan unsupported hasta implementarse |
| FN-05 | CRUD real | Alta, lectura, listado paginado, modificación de campos permitidos y borrado sujeto a política; sin 501/success falsos |
| FN-06 | Acciones de dominio | Biblioteca inicial de `atomicIncrement`, `patchFields`, `create`, `get`, `listPage`, `delete`; efectos y precondiciones explícitos |
| FN-07 | Concurrencia y transacciones | Actualización atómica SQL/ORM según destino, control de límites/overflow y rollback; ninguna operación concurrente pierde actualizaciones |
| FN-08 | Errores HTTP | Errores tipados: validación 400/422 según contrato, credencial ausente 401, prohibido 403, inexistente 404, conflicto 409; no se normalizan arbitrariamente |
| FN-09 | Autenticación/autorización | Perfiles de desarrollo y producción separados; capacidades declaradas se validan del lado servidor para CADA operación; UI nunca concede permisos |
| FN-10 | UI generada | Lista paginada, detalle, creación, edición, acciones, referencias, navegación, loading/empty/error/permission; responsive usable |
| FN-11 | Consistencia de cliente | APIs tipadas, inputs validados, invalidación de listados/detalles tras escrituras, manejo de error sin falso éxito |
| FN-12 | Persistencia/migraciones | Baseline de PostgreSQL real, constraints, versión y migraciones reproducibles; ninguna mutación destructiva automática de DB poblada |
| FN-13 | Generación reproducible | Entradas+toolchain fijados producen resultado semánticamente equivalente y artefactos propios byte-identical donde el generador lo permite; provenance/ownership |
| FN-14 | Regeneración segura | Distinguir código generado de extensiones; rechazar colisiones o modificaciones inesperadas; no sobrescribir cambios ajenos |
| FN-15 | Ensamblado runnable | Una CLI arma aplicación completa, Docker/Compose y ejecuta pruebas; despliegue Render opcional tras test y autorización explícita para recursos externos |
| FN-16 | Múltiples destinos | Misma entrada para Spring y NestJS, con declaración de capacidades y pruebas de conformidad comunes, sin reescribir reglas |
| FN-17 | Evolución | Comparación contrato previo/nuevo con clasificación compatible/breaking y plan explícito de migración |
| FN-18 | Diagnósticos | Mensajes con archivo, símbolo, regla incompatible y destino afectado; unsupported **bloquea salida** |
| FN-19 | Extensibilidad | Nueva operación declarativa y nuevo destino pueden incorporarse sin cambiar contratos válidos anteriores |
| FN-20 | Verificación independiente | Suite de conformidad desde IR para API, PostgreSQL, auth, concurrencia y browser. Un build verde por sí solo no demuestra funcionalidad |
| FN-21 | Identidades y secretos | No crear cuentas hardcoded productivas; seeds/demo solo opt-in; secretos por entorno y TLS cuando la aplicación sale a internet |
| FN-22 | Requisitos trazables | Requerimiento → contrato/decorador/IR → adaptador → pruebas → evidencia, sin introducir documentos editables paralelos que contradigan la fuente |

## 4. Requisitos no funcionales

| ID | Condición | Verificación |
|---|---|---|
| NFR-01 Seguridad | Fail-closed en gramática, capacidades, coerciones, relaciones y migraciones. SQL siempre parametrizado; nombres de identificador validados; sin ejecución de shell proveniente del contrato | Tests negativos y revisión de superficie de generación |
| NFR-02 Portabilidad | Contrato e IR sin anotaciones de Java, C#, Spring, NestJS, JPA o TypeORM | Prueba con segundo backend sobre contrato idéntico |
| NFR-03 Determinismo | Versionar y fijar versiones exactas por lockfiles/contendedores, sin timestamps/carpetas arbitrarias en artefactos estables | Generación doble, hash/diff y manifesto |
| NFR-04 Independencia | Una aplicación generada compila/arranca sin ProtocolIA instalado en runtime | Docker limpio de app generada |
| NFR-05 Operabilidad | Health, logs estructurados sin secretos, errores diagnósticos, configuración por entorno | Smoke Docker/Render y checks de logs |
| NFR-06 Usabilidad | UI real con estados de error, etiquetas legibles y navegación por teclado | E2E real en viewport escritorio y móvil |
| NFR-07 Recursos/costo | Desarrollo y pruebas locales gratis; Render Free opcional sin depender de minutos de Actions | Pipeline documentado local; no APIs de pago |
| NFR-08 Evidencia veraz | IMPLEMENTED ≠ VERIFIED ≠ LIVE; registrar commit, versiones, comandos, fixture y resultados concretos | Registro de aceptación firmado por resultados reproducibles, no por texto |
| NFR-09 Mantenibilidad | No forks grandes de terceros; adaptadores desacoplados, upgrades evaluables, preservar fuentes históricas | Prueba de cambio de adaptador sin cambio del contrato |
| NFR-10 Licencia | Registrar licencia upstream y obligaciones de redistribución de dependencias realmente incluidas | Archivo de dependencias/licencias por adaptador |

## 5. Definición exacta del perfil inicial vNext-0

**Incluye:** una aplicación CRUD administrativa, autenticación de desarrollo segura por entorno, capacidades `read`/`write`, PostgreSQL, entidad principal y una secundaria con relación FK en la prueba de generalización, validaciones y transacciones simples, paginación `limit/offset`, UI React responsive, Docker, y al menos una acción `atomicIncrement`.

**Excluye hasta declarar soporte:** transacciones de negocio arbitrarias, cálculos de precios complejos, BPMN/orquestación genérica, colas/eventos distribuidos, multi-tenancy productivo, SSO OIDC listo para producción, deploy automático sin autorización, migración destructiva de bases pobladas, claves primarias compuestas, sistemas móviles nativos, mecanismos financieros o de seguridad críticos. No deben inferirse ni simularse.

**Persistencia de datos:** dev/Render Free puede usar PostgreSQL efímero **solo si el perfil declara expresamente pérdida aceptable**; para producto real se exige almacenamiento administrado y backups.

**Identidad natural:** `Tool.code` es identidad pública del contrato. Si JHipster usa un `id` interno, se permite el surrogate **solo como detalle de almacenamiento** si todos los endpoints, respuestas, UI, validaciones de unicidad y tests respetan `code`; de lo contrario A0 falla. No degradar contrato para contentar a JHipster.

## 6. Casos obligatorios

**Caso C1 (paridad): Taller de herramientas.** Código no vacío/único, nombre no vacío, cantidad entera ≥0, fecha opcional/nula, alta, consulta por código, listado paginado, incremento atómico, cambio de nombre y capacidades lector/gestor. Conservar el experimento manual existente como oracle; no editarlo para forzar un PASS.

**Caso C2 (generalización): Equipos e inspecciones.** Una entidad `Equipo` y otra `Inspeccion` referenciada por FK, campos obligatorios y fechas, CRUD y permisos. Contratos escritos sin reutilizar copias renombradas del Taller. Su propósito es detectar hardcodes, relaciones rotas y suposiciones del generador.

**Caso C3 (portabilidad):** C1 (y C2 donde el destino ya declare soporte) generado con el mismo contrato en Spring y NestJS. Se acepta soporte progresivo por perfil; nunca llamar al segundo destino completo si todavía no pasa la misma suite.

## 7. Métrica y cierre

**KPI primario:** porcentaje de operaciones y vistas **declaradas soportadas** que funcionan, en build limpio y prueba real, con **cero archivos de lógica de negocio/persistencia/UI escritos por entidad tras formalizar contratos**. No confundir cero líneas de configuración de entorno con ausencia de trabajo.

**Gate de éxito para MVP:** 100% de operaciones soportadas de C1/C2 funcionando en un destino, con pruebas HTTP + DB + UI + auth + regeneración y un solo comando reproducible. **Gate de portabilidad:** C1 conforme en segundo destino sin reescribir contratos. Medir tiempo/tokens solo como telemetría opcional, nunca condición de aceptación.

## 8. Control de cambios y no-objetivos

- Cualquier nueva primitiva de comportamiento requiere especificación de semántica, precondiciones, errores, transacciones, prueba negativa y matriz de compatibilidad por destino.
- No evolucionar v0.1–v0.4 retrospectivamente; la migración a TypeSpec será explícita, documentada y acompañada de pruebas de paridad. Mantener los compiladores históricos utilizables mientras vNext madure.
- No se fusiona generador incompleto o que emita éxito HTTP ficticio.
- Si JHipster falla la compatibilidad contractual, usar fallback modular sin retrasar indefinidamente el MVP.
- El sistema de evaluación P4 y el ejecutor privilegiado P3 tienen hojas de ruta independientes; no son prerrequisitos funcionales de vNext.

## 9. Documentos de referencia

- [01 — Arquitectura y decisiones](01_ARCHITECTURE_ADR.md)
- [02 — Plan ejecutable](02_IMPLEMENTATION_PLAN.md)
- [03 — Matriz de pruebas](03_ACCEPTANCE_MATRIX.md)
- [04 — Runbook y estados](04_EXECUTION_RUNBOOK.md)
- [Histórico G5](../G5_CONTRACT_EVOLUTION_PROGRESS.md)
- [Proyecto Taller — evidencia sobre rama experimental](https://github.com/barbasmarcosi/ProtocolIA/blob/experiments/p5-taller-real-requirements-v1/experiments/taller-requirements-v1/EVIDENCE.md)
