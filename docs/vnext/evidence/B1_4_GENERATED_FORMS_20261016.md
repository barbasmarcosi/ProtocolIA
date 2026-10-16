# B1.4 — Formularios estructurados autogenerados a partir de TypeSpec

**Estado: PASS acotado**, 16-10-2026 UTC. Fuente funcional: `96599b2a4d50df10d429bc1358d04e88026341e8`.

## Pruebas ejecutadas

- [Regresión independiente de Bomberos: NestJS + Spring Boot, PostgreSQL, HTTP, Chromium real](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38845680611) — ambos jobs exitosos.
- [Quality: matriz legacy Python, contratos y esquemas](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38845680704) — exitoso.
- [Capturas generadas: desktop, mobile, scrolled, pickers y modals](https://github.com/barbasmarcosi/ProtocolIA/actions/runs/38845680611/artifacts/12023465666) — `protocolia-generated-ux-review`; las capturas provienen de la aplicación realmente generada.

## Capacidades

1. `@uiSection("Identificación")` define agrupaciones de un formulario sin escribir componentes por entidad. Campos y grupos conservan orden de declaración y siguen siendo elementos editables del IR. `@uiSection("Puntajes")` separa los datos numéricos en la evaluación.
2. `@uiPlaceholder("Nombre y apellido")` brinda un ejemplo visual no persistido ni usado como default o filtro de servidor.
3. `@uiControl("textarea")` produce un área de texto accesible para cadenas con `@maxLength` explícito y acotado (1–2000). El límite del contrato continúa validándose en backend y base de datos.
4. El compilador rechaza secciones vacías, etiquetas inseguras, ejemplos con marcado y controles incompatibles mediante diagnósticos específicos. Los textos tienen límites de longitud y no se ejecutan ni se interpretan como HTML.
5. El formulario generado comparte la misma plantilla React para NestJS y Spring Boot; mantiene inputs con `aria-describedby` y `aria-invalid`, picker FK, protección de borradores y foco restaurado.
6. En móvil, formularios largos separan la región desplazable de campos de los botones «Cancelar» y «Crear». Chromium comprueba que el último input quede sobre la barra y pueda editarse. Se conservan los bottom sheets de formularios cortos.

## Revisión visual y hallazgo corregido

La primera captura móvil mostró texto que se filtraba **debajo** del pie flotante. El arreglo pasó el segundo gate y se inspeccionó manualmente en las capturas resultantes. En la vista de 390×780, el contenido ya no aparece por debajo del pie y el último campo se alcanza desplazándose dentro del formulario. Escritorio utiliza títulos claros por sección y dos columnas para las puntuaciones.

## Límites explícitos

- Metadatos de UI no crean invariantes de dominio ni modifican permisos. No hay formularios condicionales generales, autorrelleno inteligente, wizard multietapa, ordenamientos drag-and-drop ni rich text.
- No se reemplaza la autoridad del backend con validaciones del navegador; solo se da asistencia adicional.
- La prueba demuestra escenarios concretos de formulario con cinco entidades y datos ficticios. No demuestra que los 16 requisitos originales de Bomberos estén completos o que la autenticación Basic sea apta para producción.
- `main`, PR #52, demo Railway UX9 y Neon durable permanecen fuera del alcance.

**Gate final de promoción:** al integrar a `independent/volunteer-evaluations`, ejecutar automáticamente una nueva regresión oficial sobre el SHA integrado. Las modificaciones posteriores exclusivamente documentales no requieren reejecutar GitHub Actions.
