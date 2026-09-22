import type {EventReferenceDocument, EventReferenceFamily} from '@/lib/event-reference/document';
import {inlineCode} from '@/lib/markdown';
import {fieldTable} from '@/lib/tool-reference/markdown';

const SHIPFOX_FIELD_DESCRIPTION_PATTERN = /added by Shipfox\.?$/iu;

/** Serializes the catalog with the heading structure the LLM text checks rely on. */
export function serializeEventReferenceMarkdown(
  document: Omit<EventReferenceDocument, 'markdown'>,
): string {
  const passthrough =
    document.passthrough && document.upstreamEventsDocUrl
      ? [
          `Shipfox also delivers ${document.provider} events that are not listed here. See [every ${document.provider} event](${document.upstreamEventsDocUrl}).`,
        ]
      : [];
  return [...passthrough, ...document.families.map((family) => serializeFamily(family, document))]
    .join('\n\n')
    .trimEnd();
}

function serializeFamily(
  family: EventReferenceFamily,
  document: Omit<EventReferenceDocument, 'markdown'>,
): string {
  const lines = [
    `### ${family.title}`,
    '',
    family.summary,
    '',
    payloadLine(family, document.provider),
    '',
  ];
  for (const note of family.notes) lines.push(note, '');
  if (family.fields.length > 0) {
    const fields = family.fields.map((field) =>
      family.shipfoxFields.includes(field.name)
        ? {
            ...field,
            description: shipfoxFieldDescription(field.description),
          }
        : field,
    );
    lines.push(...fieldTable(fields), '');
    if (family.openPayload) {
      lines.push(
        `${document.provider} may send other fields. Your workflow receives them too.`,
        '',
      );
    }
  }
  for (const event of family.events) {
    lines.push(`#### ${inlineCode(event.name)}`, '', event.summary, '');
    if (event.payloadDocUrl) {
      lines.push(`[${document.provider} docs](${event.payloadDocUrl})`, '');
    }
    const trigger = event.examples.find((example) => example.title === 'Trigger');
    if (trigger) lines.push('```yaml', trigger.code, '```', '');
  }
  return lines.join('\n').trimEnd();
}

function payloadLine(family: EventReferenceFamily, provider: string): string {
  const kind =
    family.payloadKind === 'raw-provider' ? `Fields from ${provider}.` : 'Fields listed below.';
  const reference = family.payloadDocUrl ? ` [${provider} docs](${family.payloadDocUrl})` : '';
  return `**Payload:** ${kind}${reference}`;
}

function shipfoxFieldDescription(description: string | undefined): string {
  if (!description) return 'Added by Shipfox.';
  return SHIPFOX_FIELD_DESCRIPTION_PATTERN.test(description)
    ? description
    : `${description} Added by Shipfox.`;
}
