# ProtocolIA — Roadmap de entrega (2026-11-02)

> Dos líneas diferenciadas: **producto vNext en main** (avanza en paralelo, con hitos S2c de integridad financiera) y **investigación agentic R1–R4** (PRs Draft apilados). No confundir éxito de CI de un PR de investigación con funcionalidad presente en `main`.

## Punto de partida constatado

- `main`: producto vNext con TypeSpec, generadores NestJS/React y Spring, PostgreSQL, suite de conformance y trabajo S2c/controles financieros. Rama principal **no** contiene automáticamente los PRs R1–R2/R3 de investigación.
- **R1** investigación inicial (#105): escenarios y criterios sintéticos. Comparación real entre Superpowers, Spec Kit, GSD, OpenSpec u otros **NO ejecutada**.
- **R3 v0** Project Passport (#107): requisitos, decisiones, incógnitas y artefactos del IR con verificación contra cambios de fuente. Retoma independiente tras dos años **NO demostrada**.
- **R2.0** JSON intake → perfil administrativo simple (#109): produce TypeSpec y limita su alcance.
- **R2.1** gateway de agentes (#110): fuentes congeladas, hashes, prohibición de autoridad inventada.
- **R2.2** modelo Chat Completions (#111): transporte opt-in y costo desconocido; **solo HTTP mock en CI**, no modelo remoto pago.
- **R2.3** primera propuesta redactada por ChatGPT (#121): encontró dudas materiales; bloqueo confirmado, sin benchmark ciego.
- **R2.4** decisiones de alcance firmadas (#122): prueba criptográfica de alcance con claves efímeras de CI; NO es firma del propietario.
- **R2.5** perfil TypeSpec con débito/journal/reversión (#123) + puente agente para dos entidades (#125): pruebas NestJS/PostgreSQL con carrera concurrente 12×2 contra stock 7 → 3 aprobados, 9 conflictos, saldo 1; reutiliza `@reserve`/`@release`.
- **R2.6** IR semántico tipado de inventario (rama hija de #125): fuente fija nuevos límites, grafo tipado, generación TypeSpec determinista y pruebas de regresión. Estado de CI y PR en sus evidencias; no declararlo integrado a `main` mientras siga Draft.

## Ruta crítica al MVP serio

| Etapa | Entregable tangible | Condición para completarla | Estimación orientativa* |
|---|---|---|---:|
| **P0. Consolidación** | Rebase de la pila investigativa, PRs pequeños, CI + tests de regresión conjunta, criterios de merge | `main` recibe solo cambios revisados sin romper el trabajo S2c | 2–4 iteraciones |
| **P1. Intake con modelo real** | Brief en lenguaje natural → preguntas, alcance aprobado, TypeSpec plan trazable | Evidencia de un modelo remoto real, sin secretos, y decisiones materiales bloqueadas hasta autorización | 3–6 |
| **P2. IR ampliable** | Contratos con entidades/relaciones/estados/validaciones y comportamiento acotado | Múltiples dominios reales, sin lógica inventada; conformance NestJS y Spring | 6–12 |
| **P3. Pasaporte + handoff** | Proyecto reabierto por agente nuevo usando solo repo/Passport | Test *clean-room* sin acceso a conversación/historial ni suposiciones de política | 3–5 |
| **P4. Producto operable** | UX para requerimientos, dudas, decisiones, generación, inspectores, pruebas y artefactos descargables | Autenticación, límites de gasto, aislamiento, control de despliegue, recuperación | 5–9 |
| **P5. Evaluación comparativa** | Corridas reales en mismos casos con diferentes modelos/harnesses | Casos ciegos, tests independientes, tokens/costo/latencia trazables y resultados reproducibles | 4–8 |
| **P6. Beta acotada** | Usuarios reales capaces de definir y obtener una app en dominio autorizado | Adopción, incidentes, seguridad y reversibilidad comprobados; no dominios regulados sin revisión | 5–10 |

`*` Iteraciones = sesiones de trabajo con código, tests y evidencia. **No** son promesas de horas/días; varias etapas pueden hacerse en paralelo y la estimación cambiará tras el P0. Hitos no equivalen a certificación comercial/producción.

## Dos alcances de producto que no deben mezclarse

**MVP gobernado**: convertir requisitos en **2–3 perfiles industriales concretos** (por ejemplo inventario, turnos, operaciones internas), con validación, decisions gate, generación full-stack y tests. Es alcanzable antes de crear un compilador de dominios general.

**Visión extendida**: “describí cualquier aplicación y generá un producto robusto, mantenible, seguro, desplegable y retomable por agentes años después”. Requiere composición de operadores semánticos, garantías de identidad y datos, migraciones, observabilidad, despliegues seguros y mucha más evidencia. No declarar completada por éxito de un kiosk sintético.

## Prioridad de ingeniería (para avanzar sin vueltas)

1. **No seguir creando solo capas de investigación**: convertir v0.3 a parámetros reales y verificar concurrencia y rechazo adversarial.
2. **P0**: evitar pila interminable de PRs Draft; revisar y reagrupar cambios estables, solucionar conflictos de `main`, reducir flakiness y mergear por hitos.
3. **P1/P2**: un segundo caso end-to-end independiente y un agente remoto autorizado. Separar “modelo escribió una propuesta” de “modelo produjo software correcto”.
4. **P3**: ejecutar handoff sin ChatGPT previo; registrar fallos y cobertura de Passport.
5. **P4/P5**: diseñar interfaz mínima del operador con decisiones, y comparar baselines con evidencia real.
6. **P6**: beta limitada y controles de producto.

## Riesgos y bloqueos honestos

- No existe todavía una comparación real con otras plataformas. No se puede afirmar que ProtocolIA sea superior a Superpowers, Spec Kit, GSD, etc.
- La procedencia de un archivo puede verificarse por hash; **la aprobación humana exige un canal de identidad y autorización confiable**.
- Limitar una IA a las operaciones de un perfil ya validado demuestra un **pipeline gobernado**, no interpretación semántica arbitraria.
- Pasaporte sintético no equivale a traspaso real a otro agente independiente.
- `main` puede cambiar con el trabajo automático S2c; cada merge debe revalidar el HEAD y los checks de la base.
- Mantener una documentación de aceptación por commit/hito; evitar afirmaciones sin enlaces a runs exactos.
