import type {ToolReferenceExample, ToolReferenceField} from '@/lib/tool-reference/document';
import {type JsonValue, sampleObject} from '@/lib/tool-reference/examples';

const CAMEL_BOUNDARY_PATTERN = /([a-z0-9])([A-Z])/gu;
const NON_KEY_CHARACTER_PATTERN = /[^a-z0-9]+/gu;
const EDGE_UNDERSCORE_PATTERN = /^_+|_+$/gu;
const NAME_SEPARATOR_PATTERN = /[.:]/u;

export interface EventTriggerOptions {
  /** Trigger key to use instead of one derived from the event name. */
  key?: string | undefined;
  /** Omit `event` so the trigger subscribes to every event of the source. */
  omitEvent?: boolean | undefined;
}

export interface EventExampleInput {
  eventName: string;
  connection: string;
  fields: ToolReferenceField[];
  trigger?: EventTriggerOptions | undefined;
}

export function eventExamples(input: EventExampleInput): ToolReferenceExample[] {
  const examples: ToolReferenceExample[] = [
    {title: 'Trigger', language: 'yaml', code: triggerYaml(input)},
  ];
  if (input.fields.length > 0) {
    examples.push({
      title: 'Sample payload',
      language: 'json',
      code: JSON.stringify(samplePayload(input.fields, input.eventName), null, 2),
    });
  }
  return examples;
}

export function triggerKey(eventName: string): string {
  const snake = eventName
    .replace(CAMEL_BOUNDARY_PATTERN, '$1_$2')
    .toLowerCase()
    .replace(NON_KEY_CHARACTER_PATTERN, '_')
    .replace(EDGE_UNDERSCORE_PATTERN, '');
  return `on_${snake}`;
}

function triggerYaml(input: EventExampleInput): string {
  const lines = [
    'triggers:',
    `  ${input.trigger?.key ?? triggerKey(input.eventName)}:`,
    `    source: ${input.connection}`,
  ];
  if (!input.trigger?.omitEvent) lines.push(`    event: ${input.eventName}`);
  return lines.join('\n');
}

// The sample pins the discriminator to the documented event. Providers name the
// discriminator differently, so any top-level enum that lists the event name,
// or its last segment, is treated as the discriminator.
function samplePayload(fields: ToolReferenceField[], eventName: string): Record<string, JsonValue> {
  const sample = sampleObject(fields, true);
  const segment = eventName.split(NAME_SEPARATOR_PATTERN).at(-1) ?? eventName;
  for (const field of fields) {
    if (!field.enumValues) continue;
    if (field.enumValues.includes(eventName)) sample[field.name] = eventName;
    else if (field.enumValues.includes(segment)) sample[field.name] = segment;
  }
  return sample;
}
