import type { DocumentKind } from '../../shared/contracts';

/**
 * Starting points, not forms. Every template says what a good version of this
 * document answers and marks what is still unknown, so nobody has to invent
 * data to fill a field. The human (or an agent) rewrites freely.
 */
const UNKNOWN = '_Sin definir todavía._';

function header(title: string, workTitle: string, base: string | null, lead: string): string {
  const lines = [`# ${title}`, '', `_${workTitle}${base ? ` · basado en: ${base}` : ''}_`, '', lead, ''];
  return lines.join('\n');
}

export function renderDocumentTemplate(kind: DocumentKind, title: string, workTitle: string, baseTitle: string | null): string {
  switch (kind) {
    case 'strategy':
      return `${header(title, workTitle, baseTitle, 'Qué decidimos hacer y por qué. Lo que todavía no sabemos queda marcado como tal.')}## Objetivo

${UNKNOWN}

## Audiencia

${UNKNOWN}

## Propuesta

${UNKNOWN}

## Elecciones

Qué hacemos y qué dejamos afuera, con el motivo.

${UNKNOWN}

## Restricciones

Presupuesto, plazos, límites de marca, lo que no se puede prometer.

${UNKNOWN}

## Hipótesis y evidencia

| Afirmación | Estado | En qué se apoya |
| --- | --- | --- |
|  | hipótesis | _sin fuente_ |

## Cómo lo medimos

${UNKNOWN}
`;
    case 'calendar':
      return `${header(title, workTitle, baseTitle, 'Un mes de acciones concretas. Una fila por pieza; lo que no está decidido se deja vacío, no se inventa.')}## Calendario

| Fecha | Canal | Objetivo | Mensaje | CTA |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Supuestos

Qué damos por cierto para que este calendario tenga sentido.

${UNKNOWN}

## Pendientes de definir

${UNKNOWN}
`;
    case 'research':
      return `${header(title, workTitle, baseTitle, 'Evidencia con fuente. Un hallazgo sin fuente es una hipótesis y se marca así.')}## Preguntas que queremos responder

${UNKNOWN}

## Hallazgos

| Hallazgo | Fuente | Fecha | Confianza |
| --- | --- | --- | --- |
|  |  |  |  |

## Qué quedó sin responder

${UNKNOWN}
`;
    case 'copy':
      return `${header(title, workTitle, baseTitle, 'Piezas listas para usar. Cada una dice para qué canal es y qué pide.')}## Pieza 1

- **Canal:** ${UNKNOWN}
- **Objetivo:** ${UNKNOWN}
- **CTA:** ${UNKNOWN}

Texto:

${UNKNOWN}
`;
    case 'note':
      return `${header(title, workTitle, baseTitle, 'Notas de trabajo.')}${UNKNOWN}\n`;
    default:
      return `${header(title, workTitle, baseTitle, 'El encargo y lo que hay que entregar.')}## Encargo

${UNKNOWN}

## Qué hay que entregar

${UNKNOWN}

## Restricciones

${UNKNOWN}
`;
  }
}

/** Human labels for the UI and for the instruction files. */
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  brief: 'Encargo',
  strategy: 'Estrategia',
  calendar: 'Calendario',
  research: 'Investigación',
  copy: 'Piezas',
  note: 'Nota',
};
