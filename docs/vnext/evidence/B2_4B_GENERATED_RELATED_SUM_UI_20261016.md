# B2.4b — Panel de agregado relacionado autogenerado

**Estado de validación: PASS acotado.** Código funcional `b4d9d6249849a51af60a86c1d320d3beff29a759` (16-10-2026 UTC). [Conformance NestJS/Spring/PostgreSQL/Chromium #38857062269](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38857062269) y [quality #38857062188](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38857062188), ambas `success`. Capturas de escritorio y móvil preservadas como artefactos por backend en el run. Inspección visual: panel legible, jerarquía correcta, sin recorte lateral ni superposición; revisión y traducción de etiquetas `units`/`active`. **Regresión independiente de Bomberos pendiente del fast-forward de integración.**

## Alcance

Cuando un contrato TypeSpec incluye `@behavior("sumRelated", "Part")` y `@relatedSum("Allocation", "partSku", "units", "status", "active")`, el **generador React compartido**, sin código específico de inventario, descubre el recurso hijo en `protocolia-ui.json` y dibuja un panel de total activo en el diálogo de detalle de la entidad padre. La UI utiliza nombres legibles de las entidades/campos ya proyectados del contrato, no una etiqueta hardcodeada de «Reservas».

El panel solo aparece si el usuario tiene las capacidades de lectura del padre **y** del hijo. La API vuelve a verificar ambas autoridades: no se considera el filtro visual un control de seguridad. No aparecen inputs para editar totales derivados ni se suman valores paginados del cliente.

El dato llega mediante la operación GET generada y se verifica como `{totalUnits: string}` decimal entero positivo, con presentación local usando `BigInt`. El componente realiza una petición por identidad y revisión, aborta lecturas obsoletas cuando se cierra/cambia el detalle, dispone de recarga explícita, muestra spinner mientras se consulta y presenta un error de lectura sin inventar valores. El estilo es responsivo (escritorio/móvil), con roles y etiquetas accesibles.

## Oráculos

- Integridad del agregado y la autoridad SQL del bloque B2.4a: ambas aplicaciones completas en PostgreSQL con reserva, rollback, concurrencia y cancelación.
- Chromium contra la UI autogenerada: iniciar sesión como lector, abrir detalle del artículo, ver total activo 7; captura de escritorio.
- Insertar una nueva reserva desde HTTP mientras el detalle está abierto: la UI no inventa una actualización; al pulsar «Actualizar total» obtiene 9.
- Captura móvil a 390×844 y control de ancho; abrir otro artículo sin reservas y mostrar 0.
- Regresión independiente Bomberos, NestJS/Spring/PostgreSQL/Chromium después del fast-forward de integración.

## Límites

El agregado visible representa únicamente la suma de reservas activas (un `SUM` entero de registros hijos). No existe un motor general de gráficos/tablas de agregaciones, no hay streaming en tiempo real ni polling y el dato puede cambiar inmediatamente después de la lectura. El panel no incorpora visualización monetaria multi-entidad, ni sustituye S1 (autorización de datos específica del usuario) o una política de producción de autenticación. Basic demo sigue siendo solo para ensayos.
