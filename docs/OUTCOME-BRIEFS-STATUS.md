# Estado de los briefs de resultado

Revisión: 2026-09-11. Base: `gabogabucho/integrate-outcome-handoff`, `eabde47`, más el cierre de MCP opcional y la vertical PDF.
Fuente de alcance: [LATTE-OUTCOME-BRIEFS.md](LATTE-OUTCOME-BRIEFS.md).

## Ramas revisadas

- `gabogabucho/outcome-slice-claude`, `3d0355f`: contrato de resultado.
- `gabogabucho/handoff-cross-account`, `48dc0df`: continuación entre agentes/cuentas.
- `gabogabucho/integrate-outcome-handoff`: integra ambas sobre una base más reciente en `c8cb52f`; `c971d1a` incorpora el resultado al handoff; `eabde47` corrige i18n y validación del preview.
- `basketstar` permanece en `feat/installer-sidebar`, `917a082`, con modificaciones locales que esta revisión NO reemplaza. La actividad de equipo tiene una implementación integrada en `TeamPanel.tsx`; no copiar encima la variante vieja sin revisión.

No hacer push a `origin` por inercia: apunta a `gabogabucho/latte-web`, no al repositorio de la aplicación.

## Estado por brief

| Brief | Evidencia | Estado real |
| --- | --- | --- |
| 1. Contrato mínimo | `WorkOutcome.tsx`, `repository.ts`, `work-outcome.test.ts`, `work-outcome-view.test.ts` | Implementado y cubierto por tests; falta QA visual actual de Encargo en ES/EN. |
| 2. Documento para cliente | `client-document.test.ts`, fixture PDF Bruma y evidencia de parser/render | Recorrido técnico probado con PDF válido: documento aprobado, listado, apertura delegada (mock), vínculo, reinicio, handoff y faltante. No es una ejecución de agente real. |
| 3. Continuar con otro agente | `continuation.ts`, `TeamPanel.tsx`, `continuation.test.ts`, `continue-navigation.test.ts` | Núcleo determinista implementado y probado; falta smoke real entre cuentas. Síntesis IA opcional no implementada. |
| 4. MCP campañas/Reels | `ToolsView.tsx`, `optional-mcp-view.test.ts`, `optional-mcp-protocol.test.ts` | Opción configurable completada según aclaración del usuario: ningún proveedor fijo ni servidor instalado. Reglas de autorización, ejecución y verificación; no son enforcement ni prueba de campaña real. |

Los tests unitarios de resultado originales usan contenido de prueba (`bytes`) y extensión `.pdf`. La nueva integración usa una fixture PDF real, generada con ReportLab y parseada/renderizada con PyMuPDF; hash, texto y PNG están en `tests/fixtures/client-document/`. Latte no incorpora un conversor ni un validador universal de binarios, y la suite no agrega dependencias Python.

## Recorrido de aceptación y límites

La integración automatizada ya cubre los contratos de los pasos siguientes con una fixture PDF válida y runtime falso. Para un smoke completo de escritorio con agentes/cuentas reales, repetir el recorrido explícitamente: ese smoke NO se hizo ni se presenta como evidencia. El alcance de MCP acordado no requiere instalar un servidor ni ejecutar campañas.

Usar datos temporales, una marca ficticia y un documento acotado. No tocar marcas/cuentas reales ni disparar inferencias pagas para QA.

1. Crear encargo con audiencia, contexto y resultado PDF o DOCX explícitos.
2. Crear documento de trabajo separando decisiones aprobadas, evidencia, hipótesis y pendientes.
3. Producir el formato real con una herramienta disponible en `entregables/`, sin generador documental propio ni dependencias nuevas de producto.
4. Abrir con un lector adecuado; renderizar e inspeccionar todas las páginas si hay herramientas. Registrar limitaciones reales; tamaño/extensión no bastan.
5. Verificar que aparece en Entregables; abrir desde Latte.
6. Vincular desde Encargo → Resultado esperado → Editar → elegir archivo → Guardar. Actualmente no hay herramienta de enlace expuesta al agente: no editar la base de datos ni declarar enlace automático.
7. Recargar y comprobar persistencia; retirar temporalmente el archivo y comprobar estado faltante.
8. Crear handoff y verificar resultado esperado, ruta y estado; conservar origen. Distinguir prueba con runtime falso de ejecución real entre cuentas.
9. Guardar evidencia visual y resultados concretos antes de marcar el brief 2 terminado.

Si falta conversor, lector o renderer, registrar el bloqueo específico y qué validación quedó pendiente. Una alternativa HTML/Markdown requiere acuerdo humano y no cumple por sí sola el formato solicitado.

## Brief OPUS anterior

Se contrastó `basketstar/docs/OPUS-EXECUTION-BRIEF.md`: las cinco piezas tienen implementación por inspección (Ajustes, guardado con conflicto, historial, documentos y derivación estrategia/calendario). No se repitió su QA visual ni se trasladaron resultados históricos como evidencia actual. Los reportes `MVP-STATUS.md` y `OPUS-CUT-STATUS.md` que pedía no están en esta rama; este informe no los presenta como completados.

## Verificación de este avance

- Se habilitó `tests/integration/**/*.test.ts` en la suite principal; primera corrida: 42 archivos, 359 tests aprobados.
- Se completaron las reglas del protocolo documental (fuentes, formato, revisión visual, bloqueos y vínculo humano), con cinco regresiones nuevas en `tests/backend/client-document-protocol.test.ts`. Prueban instrucciones, no generación real.
- Verificación final: `npm test`, 46 archivos y 376 tests aprobados; `npm run typecheck:all` aprobado para electron, web y web-tests con `--noEmit`; `git diff --check` aprobado.
- PDF real de una página parseado y renderizado, inspección visual aprobada incluyendo acentos/ñ. Herramientas: ReportLab 5.0.0 y PyMuPDF 1.28.2 ya instalados. No generación DOCX ni inferencias reales.
- UI MCP renderizada en tests ES/EN: opcionalidad, estados, formulario vacío sin proveedor fijo, etiquetas accesibles, avisos y acentos. Esos tests no sustituyen QA visual interactiva de escritorio.
- Se intentó QA con Vite dev y una pestaña propia de Orca: `snapshot` falló con `runtime_unavailable` (el runtime cerró la conexión). No se reinició Orca ni se interrumpieron sesiones del usuario; QA interactiva queda pendiente.
- El junction local `node_modules` de esta rama apunta a `../basketstar/node_modules` para pruebas; no se instalaron dependencias ni se tocaron las de origen.
- Sin builds, instalación de servidores, cambios de credenciales ni campañas reales. El usuario autorizó unificar y publicar estos cambios en `ohmylatte/latte:main`, sin tag ni release de instalador.
