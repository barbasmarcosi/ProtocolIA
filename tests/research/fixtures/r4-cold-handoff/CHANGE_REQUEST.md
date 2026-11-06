# Solicitud de cambio — inventario de herramientas

El taller necesita guardar la **fecha prevista de próxima calibración** de cada herramienta. Agregá un campo llamado `calibrationDueAt`, de tipo fecha y hora UTC, **opcional y anulable** tanto en la entidad persistida `Tool` como en el modelo de solicitud de alta `ToolRequest`.

Debe poder leerse con el detalle habitual y enviarse al crear una herramienta. Los registros antiguos deben permanecer válidos sin este campo. Conservá rutas, permisos, reglas de stock, validaciones existentes e identidad pública tal como están.

El dueño no definió todavía el intervalo de calibración de cada tipo de herramienta ni qué hacer cuando se vence una calibración. **No inventes políticas automáticas**, recordatorios ni una nueva API de autorización; registrá esas preguntas materiales y lo que elegiste deliberadamente no implementar.

Tu entrega será un proyecto TypeSpec editable (`contracts/**/*.tsp` y `tspconfig.yaml`) más un archivo `handoff-response.json` de acuerdo con el contrato de entrega indicado en `AGENT_TASK.md`. La revisión posterior puede rechazar soluciones que compilen pero modifiquen reglas no autorizadas.
