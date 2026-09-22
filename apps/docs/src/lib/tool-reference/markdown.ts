import {inlineCode, tableValue} from '@/lib/markdown';
import type {
  ToolReferenceDocument,
  ToolReferenceField,
  ToolReferenceGroup,
  ToolReferenceMethod,
  ToolReferenceTool,
} from '@/lib/tool-reference/document';

type Metadata = Pick<
  ToolReferenceTool,
  'access' | 'sensitive' | 'permissions' | 'alternativePermissions' | 'repository'
>;

/** Serializes the catalog with the heading structure the LLM text checks rely on. */
export function serializeToolReferenceMarkdown(
  document: Omit<ToolReferenceDocument, 'markdown'>,
): string {
  return document.groups
    .map((group) => serializeGroup(group, document))
    .join('\n\n')
    .trimEnd();
}

function serializeGroup(
  group: ToolReferenceGroup,
  document: Omit<ToolReferenceDocument, 'markdown'>,
): string {
  return [
    `### ${group.title}`,
    '',
    ...group.tools.map((tool) => serializeTool(tool, document)),
  ].join('\n');
}

function serializeTool(
  tool: ToolReferenceTool,
  document: Omit<ToolReferenceDocument, 'markdown'>,
): string {
  const lines = [`#### ${inlineCode(tool.id)}`, '', tool.description, ''];
  if (document.kind === 'integration') {
    lines.push(...metadataLines(tool));
    lines.push(`**Selector tokens:** ${tool.selectors.map(inlineCode).join(', ')}`, '');
  }
  lines.push('##### Input', '', ...inputLines(tool, document.kind));
  for (const method of tool.methods ?? []) lines.push(...serializeMethod(method));
  if (tool.output) {
    lines.push(`##### ${document.outputLabel}`, '', ...outputLines(tool.output, document.kind), '');
  }
  return lines.join('\n');
}

function inputLines(tool: ToolReferenceTool, kind: ToolReferenceDocument['kind']): string[] {
  if (tool.inputVariants) {
    return [
      'Exactly one of these shapes applies.',
      '',
      ...tool.inputVariants.flatMap((variant) => [
        `**Shape requiring ${variant.title}:**`,
        '',
        ...fieldTable(variant.fields),
        '',
      ]),
    ];
  }
  if (tool.input.length === 0) {
    return [
      kind === 'integration'
        ? 'This schema accepts an object with provider-defined fields.'
        : 'This tool takes no input.',
      '',
    ];
  }
  const alternatives = tool.inputAlternatives
    ? [
        `At least one of these input combinations is required: ${tool.inputAlternatives
          .map((fields) => fields.map(inlineCode).join(' and '))
          .join('; ')}.`,
        '',
      ]
    : [];
  return [...fieldTable(tool.input), '', ...alternatives];
}

function outputLines(output: ToolReferenceField[], kind: ToolReferenceDocument['kind']): string[] {
  if (output.length > 0) return fieldTable(output);
  return [
    kind === 'integration'
      ? 'This tool returns the provider response without declared fields.'
      : 'This tool returns an empty result.',
  ];
}

function serializeMethod(method: ToolReferenceMethod): string[] {
  return [
    `##### ${inlineCode(method.id)}`,
    '',
    method.description,
    '',
    ...metadataLines(method),
    method.requiredInput.length > 0
      ? `**Required input for this method:** ${method.requiredInput.map(inlineCode).join(', ')}.`
      : 'This method has no additional required input.',
    '',
  ];
}

function metadataLines(metadata: Metadata): string[] {
  const lines = [
    `**Access:** ${metadata.access}.`,
    '',
    `**Sensitive:** ${metadata.sensitive ? 'Yes.' : 'No.'}`,
    '',
    `**Required permissions:** ${formatPermissions(metadata.permissions)}`,
    '',
  ];
  if (metadata.alternativePermissions) {
    lines.push(
      `**Accepted instead:** ${metadata.alternativePermissions.map(formatPermissions).join('; ')}`,
      '',
    );
  }
  if (metadata.repository) {
    lines.push(`**Repository classification:** ${metadata.repository.classification}`, '');
    if (metadata.repository.indirectTargetNote) {
      lines.push(`**Indirect target:** ${metadata.repository.indirectTargetNote}`, '');
    }
  }
  return lines;
}

function formatPermissions(permissions: string[]): string {
  return permissions.length > 0 ? permissions.map(inlineCode).join(', ') : 'None.';
}

function fieldTable(fields: ToolReferenceField[]): string[] {
  return [
    '| Field | Type | Required | Description |',
    '|---|---|---|---|',
    ...flattenFields(fields).map(
      (field) =>
        `| ${inlineCode(field.path)} | ${tableValue(fieldTypeText(field))} | ${requirementText(field)} | ${tableValue(fieldDescription(field))} |`,
    ),
  ];
}

function flattenFields(fields: ToolReferenceField[]): ToolReferenceField[] {
  return fields.flatMap((field) => [field, ...flattenFields(field.children ?? [])]);
}

function fieldTypeText(field: ToolReferenceField): string {
  if (field.enumValues) return `${field.type}: ${field.enumValues.map(inlineCode).join(', ')}`;
  return field.type
    .split(' | ')
    .map((member) =>
      member.startsWith('constant ')
        ? `constant ${inlineCode(member.slice('constant '.length))}`
        : member,
    )
    .join(' | ');
}

function requirementText(field: ToolReferenceField): string {
  return field.requirement.charAt(0).toUpperCase() + field.requirement.slice(1);
}

function fieldDescription(field: ToolReferenceField): string {
  return [field.description, field.constraints].filter(Boolean).join(' ');
}
