# Latte — briefs de ejecución orientada a resultados

## Norte de producto

Latte es un sistema de ejecución de marketing basado en contexto. La marca, sus decisiones y el trabajo pertenecen a Latte; los agentes son runtimes reemplazables.

El contexto es infraestructura, no el resultado final. Todo trabajo debe terminar en uno de estos estados verificables:

- un entregable real;
- una acción confirmada;
- un bloqueo explícito;
- un aprendizaje incorporado al contexto.

## Restricciones comunes

- No crear `Task`, `Run`, `Pipeline`, `Workflow`, `Artifact`, `Evidence` ni `ContextSnapshot` antes de demostrar su necesidad.
- No agregar dashboards, Kanban, backlog, nuevas tabs ni navegación principal.
- No duplicar `Documents` ni `Deliverables`.
- `Work.brief` continúa siendo el objetivo del trabajo.
- `Deliverables` continúa siendo la única fuente visual de archivos finales.
- Toda funcionalidad nueva debe ser opcional y compatible con trabajos existentes.
- Markdown puede ser un insumo interno, pero no cuenta como resultado cuando se pidió DOCX, PDF u otro archivo final.
- No construir frameworks genéricos, conversores universales ni orquestación autónoma prematuramente.

---

## Brief 1 — Contrato mínimo de resultado

### Objetivo

Permitir que un trabajo declare qué salida espera y cuál archivo existente representa el resultado, sin crear tareas ni una máquina de estados paralela.

### Alcance propuesto

Extender `Work`, si el modelo real lo confirma, con campos opcionales equivalentes a:

```ts
type WorkOutcome = {
  expectedOutput: string;
  resultPath: string | null;
};
```

Antes de agregar un nuevo estado, verificar si puede derivarse o reutilizar `DocumentStatus` y las aprobaciones existentes.

### UX

Dentro de la vista existente de **Encargo**, agregar una superficie compacta o colapsable para:

- editar el resultado esperado;
- mostrar el resultado vinculado;
- elegir un archivo ya presente en `entregables/`;
- abrir el resultado;
- indicar sin romper la vista cuando el archivo ya no existe.

### No objetivos

- Nueva pantalla de resultados.
- Listado paralelo de entregables.
- Formulario obligatorio al crear trabajos.
- Estado operativo complejo.
- Persistir o copiar nuevamente el archivo final.

### Criterios de aceptación

- Los trabajos existentes abren sin migraciones destructivas.
- Un trabajo sin resultado esperado continúa funcionando como hoy.
- No aparecen nuevas secciones principales.
- El archivo final no se duplica.
- Un `resultPath` inexistente se muestra como faltante.
- El resultado esperado llega al contexto del agente sin duplicar el brief.
- La migración y los contratos tienen pruebas focalizadas.

---

## Brief 2 — Primera vertical slice: documento para cliente

### Objetivo

Demostrar el ciclo completo:

```text
Contexto de marca
→ documento de trabajo
→ DOCX/PDF real
→ revisión
→ resultado vinculado
```

### Caso de uso

El usuario solicita un brief, estrategia o guía para entregar a un cliente en DOCX o PDF.

El agente debe:

1. Leer el encargo y el contexto relevante de la marca.
2. Separar decisiones aprobadas, evidencia, hipótesis y pendientes.
3. Redactar contenido apto para la audiencia final.
4. Excluir razonamiento interno y conversación entre agentes.
5. Crear el archivo real dentro de `entregables/`.
6. Verificar que el archivo existe y abre correctamente.
7. Renderizarlo y revisar visualmente cuando las herramientas disponibles lo permitan.
8. Corregir problemas de contenido o presentación.
9. Vincularlo como resultado del trabajo.
10. Informar brevemente qué produjo y qué quedó pendiente.

### Definition of Done

No está terminado hasta que:

- existe el archivo solicitado;
- el formato es válido;
- no contiene Markdown crudo ni razonamiento interno;
- es utilizable por alguien que no participó de la conversación;
- aparece en `Deliverables`;
- está vinculado al trabajo;
- cualquier limitación está declarada explícitamente.

### No objetivos

- Editor DOCX embebido.
- Conversor universal de formatos.
- Generador documental propio.
- Motor genérico de validación de binarios.
- Automatización multiagente.

---

## Brief 3 — Continuar con otro agente o cuenta

### Objetivo

Permitir cambiar agente, proveedor o cuenta sin perder el estado intelectual del trabajo ni depender del saldo del agente anterior.

### Flujo

Agregar una acción contextual **Continuar con otro agente**:

1. Elegir cuenta, proveedor, modelo y rol.
2. Construir un handoff compacto.
3. Permitir revisar y editar el handoff.
4. Crear una nueva conversación o miembro.
5. Enviar el paquete como contexto inicial.
6. Conservar una referencia al origen.

### Contenido mínimo del handoff

- objetivo actual;
- decisiones aprobadas;
- documentos relevantes;
- resultado esperado;
- resultados producidos;
- pendientes;
- bloqueos conocidos;
- referencias a archivos, sin copiarlos.

### Modo económico

Construir primero un handoff determinista sin inferencia:

```text
brief + decisiones + documentos aprobados + resultado esperado
+ archivos vinculados + últimos mensajes relevantes
```

Ofrecer como mejora opcional una síntesis generada por IA. No enviar automáticamente el transcript completo.

### No objetivos

- Mutar la cuenta de un thread existente.
- Copiar transcripts completos entre proveedores.
- Resumir obligatoriamente con el agente que se quedó sin saldo.
- Orquestador multiagente autónomo.

---

## Brief 4 — Futuro MCP de campañas o Reels

### Alcance aclarado por el usuario (2026-09-11)

La entrega es la **opción de usar un MCP elegido y configurado por el usuario**, no un servidor integrado de fábrica. No instalar servidores, elegir proveedores, conectar cuentas ni ejecutar campañas reales como parte de este cambio. Reutilizar Herramientas y el MCP del runtime: sin MCP configurado, el resto del trabajo sigue funcionando; solamente la acción externa necesita configuración y autorización explícitas. Las pruebas de contratos y UX no deben presentarse como evidencia de una ejecución externa real.

### Condición de entrada

Implementar únicamente después de comprobar el contrato de resultado y el handoff.

### Flujo esperado

1. Detectar una intención de producción o ejecución.
2. Construir un paquete de contexto acotado a la tarea.
3. Confirmar alcance, cuenta, presupuesto y autorizaciones necesarias.
4. Ejecutar la herramienta MCP.
5. Consultar nuevamente el estado externo.
6. Guardar archivos e identificadores resultantes.
7. Registrar qué se ejecutó, con qué contexto y qué quedó pendiente.

### Regla

Si el usuario pidió ejecutar y están presentes autorización y alcance, el agente debe usar la herramienta. No debe reemplazar la ejecución con otro documento Markdown.

### No objetivos iniciales

- Integración propia con cada plataforma.
- Credenciales almacenadas por Latte.
- Ejecución autónoma sin confirmación.
- Framework universal de acciones externas.

---

## Orden recomendado

1. Contrato mínimo de resultado.
2. Vertical slice DOCX/PDF.
3. Handoff entre agentes y cuentas.
4. Segundo entregable real: formulario o presentación.
5. MCP de campañas o Reels.

## Regla de evaluación

Una slice no está terminada porque el agente produjo una explicación convincente. Está terminada cuando existe un resultado verificable que otra persona puede usar o cuando Latte muestra un bloqueo concreto que requiere intervención humana.
