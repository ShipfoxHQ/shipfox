import type {ToolReferenceExample, ToolReferenceField} from '@/lib/tool-reference/document';

type JsonValue = string | number | boolean | null | JsonValue[] | {[key: string]: JsonValue};

const SAMPLE_UUID = '0192b3d4-6f1a-7c2e-8f4b-1a2b3c4d5e6f';
const SAMPLE_DATE_TIME = '2026-01-15T09:30:00Z';
const SUCH_AS_PATTERN = /such as ([^,.;]+)/u;
const PLAIN_SCALAR_PATTERN = /^[A-Za-z0-9_./<>-]+$/u;
const MINIMUM_PATTERN = /Minimum (\d[\d,]*)/u;
const LEADING_LIST_INDENT_PATTERN = /^\n {2}/u;

export interface IntegrationExampleInput {
  toolId: string;
  connection: string;
  access: 'read' | 'write';
  input: ToolReferenceField[];
  /** Fields required by the method a tool step selects, for method families. */
  methodId?: string;
  methodRequiredInput?: string[];
  output?: ToolReferenceField[];
}

export function integrationExamples(input: IntegrationExampleInput): ToolReferenceExample[] {
  const examples: ToolReferenceExample[] = [
    {title: 'Tool step', language: 'yaml', code: toolStepYaml(input)},
    {title: 'Agent step', language: 'yaml', code: agentStepYaml(input)},
  ];
  if (input.output && input.output.length > 0) {
    examples.push({
      title: 'Output',
      language: 'json',
      code: JSON.stringify(sampleObject(input.output, true), null, 2),
    });
  }
  return examples;
}

export function mcpExamples(input: {
  arguments: ToolReferenceField[];
  result: ToolReferenceField[];
}): ToolReferenceExample[] {
  return [
    {
      title: 'Arguments',
      language: 'json',
      code: JSON.stringify(sampleObject(input.arguments), null, 2),
    },
    {
      title: 'Result',
      language: 'json',
      code: JSON.stringify(sampleObject(input.result, true), null, 2),
    },
  ];
}

function toolStepYaml(input: IntegrationExampleInput): string {
  const stepTool = input.methodId ? `${input.toolId}.${input.methodId}` : input.toolId;
  const methodRequired = new Set(input.methodRequiredInput ?? []);
  const fields = input.input.filter(
    (field) =>
      field.name !== 'method' &&
      (field.requirement === 'required' || methodRequired.has(field.name)),
  );
  const withBlock = Object.fromEntries(fields.map((field) => [field.name, sampleValue(field)]));
  const lines = [
    `- key: ${input.toolId}`,
    `  tool: ${stepTool}`,
    `  connection: ${input.connection}`,
  ];
  if (Object.keys(withBlock).length > 0) lines.push(`  with:${yaml(withBlock, 4)}`);
  const firstOutput = input.output?.[0];
  if (firstOutput) {
    lines.push('  outputs:', `    ${firstOutput.name}: \${{ result.${firstOutput.name} }}`);
  }
  return lines.join('\n');
}

function agentStepYaml(input: IntegrationExampleInput): string {
  const lines = [
    '- prompt: Describe the task for the agent.',
    '  integrations:',
    `    - connection: ${input.connection}`,
    `      include: [${input.toolId}]`,
  ];
  if (input.access === 'write') lines.push('      allow_write: true');
  return lines.join('\n');
}

// Placeholders follow the schema: a "such as" hint in the description wins,
// then the first enum value, then a value shaped by the type.
function sampleValue(field: ToolReferenceField): JsonValue {
  const hint = field.description?.match(SUCH_AS_PATTERN)?.[1]?.trim();
  if (hint) return hint;
  if (field.enumValues && field.enumValues.length > 0) return field.enumValues[0] ?? '';
  // Union types sample their first member.
  const type = field.type.split(' | ')[0] ?? field.type;
  if (type.startsWith('array')) {
    return field.children ? [sampleObject(field.children, true)] : [`<${field.name}>`];
  }
  if (type.startsWith('object')) return field.children ? sampleObject(field.children, true) : {};
  return sampleScalar(type, field);
}

function sampleScalar(type: string, field: ToolReferenceField): JsonValue {
  if (type.startsWith('constant ')) {
    return JSON.parse(type.slice('constant '.length)) as JsonValue;
  }
  if (type.startsWith('boolean')) return true;
  if (type.startsWith('integer') || type.startsWith('number')) {
    const minimum = field.constraints?.match(MINIMUM_PATTERN)?.[1];
    return minimum ? Number(minimum.replaceAll(',', '')) : 1;
  }
  if (type.includes('uuid')) return SAMPLE_UUID;
  if (type.includes('date-time')) return SAMPLE_DATE_TIME;
  return `<${field.name}>`;
}

function sampleObject(fields: ToolReferenceField[], includeOptional = false): JsonValue {
  const chosen = fields.filter((field) => includeOptional || field.requirement === 'required');
  return Object.fromEntries(chosen.map((field) => [field.name, sampleValue(field)]));
}

function yaml(value: JsonValue, indent: number): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return ` [${value.map(scalar).join(', ')}]`;
    }
    return `\n${value.map((item) => `${pad}-${yaml(item, indent + 2).replace(LEADING_LIST_INDENT_PATTERN, ' ')}`).join('\n')}`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return ' {}';
    return `\n${entries.map(([key, item]) => `${pad}${key}:${yaml(item, indent + 2)}`).join('\n')}`;
  }
  return ` ${scalar(value)}`;
}

function scalar(value: JsonValue): string {
  if (typeof value === 'string') {
    return PLAIN_SCALAR_PATTERN.test(value) ? value : JSON.stringify(value);
  }
  return JSON.stringify(value);
}
