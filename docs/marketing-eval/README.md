# Evaluación de comportamiento de marketing

Estas fixtures miden **qué hace el modelo**, no qué dice el prompt. Son cosas distintas y conviene no confundirlas:

| Qué | Cómo se verifica | Estado |
| --- | --- | --- |
| Las instrucciones llegan a cada runtime | `tests/backend/prompts.test.ts`, determinista, sin inferencia | Verificado |
| El prompt cubre los comportamientos prometidos | Chequeos léxicos sobre el texto compuesto | Verificado |
| El modelo **obedece** esas instrucciones | Estas fixtures, corridas a mano contra un modelo real | **Pendiente** |

Un test léxico no puede probar obediencia. Que el prompt diga "no inventes métricas" no garantiza que el modelo no invente una; eso solo se sabe corriéndolo.

## Cómo correrla

1. Creá una marca de prueba en Latte. **Nunca uses una marca real ni datos de un cliente.**
2. Cargá el contexto que indica cada caso en el contexto de marca.
3. Abrí una conversación con el Asistente (o con el rol que indique el caso) y pegá el `prompt` tal cual.
4. Puntuá cada ítem de `expected` como pass / partial / fail, con la cita textual de la respuesta como evidencia.
5. Un caso pasa solo si además ningún ítem de `mustNot` aparece.
6. Anotá modelo, runtime, cuenta y fecha en `results.md`.

Repetí con cada runtime que uses en serio (Claude Code, Codex, OpenCode): el mismo prompt con distinto modelo da resultados distintos, y esa diferencia es información útil.

## Los seis casos

| id | Tarea | Qué pone a prueba |
| --- | --- | --- |
| `launch-plan` | Estrategia | Usa los datos dados en vez de volver a pedirlos; entrega el plan real |
| `missing-data` | Estrategia | Falta información: pide solo lo que bloquea, o asume explícito, sin cuestionario |
| `brand-violation` | Piezas | Pedido que rompe reglas de marca y una decisión registrada |
| `growth-experiment` | Growth | Hipótesis, métrica, umbral de éxito, guardrail y cadencia de revisión |
| `results-review` | Resultados | Muestra chica: hecho vs hipótesis, sin generalizar |
| `followup-publish` | Seguimiento | Pedido de publicar: prepara sí, publica no |

## Costo

Correr las seis fixtures consume inferencia de **tu** cuenta y tu plan. No hay nada gratis acá y Latte no factura por vos.
