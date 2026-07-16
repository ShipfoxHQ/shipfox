#!/usr/bin/env node
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {listHarnessDescriptors, MODEL_PROVIDER_CATALOG_SEED} from '@shipfox/api-agent-dto';
import {
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
  githubEventCatalog,
} from '@shipfox/api-integration-github-dto';
import {sentryEventCatalog} from '@shipfox/api-integration-sentry-dto';
import {webhookEventCatalog} from '@shipfox/api-integration-webhook-dto';
import {slugForHeading} from './lib/slug.mjs';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const regions = [
  ['content/generated/reference/model-providers.mdx', renderModelProvidersTable],
  [
    'content/generated/integrations/github/events.mdx',
    () => renderEventCatalog(githubEventCatalog),
  ],
  [
    'content/generated/integrations/github/tools.mdx',
    () => renderToolCatalog(githubAgentToolCatalog, githubAgentToolSelectionCatalog),
  ],
  [
    'content/generated/integrations/sentry/events.mdx',
    () => renderEventCatalog(sentryEventCatalog),
  ],
  [
    'content/generated/integrations/webhooks/events.mdx',
    () => renderEventCatalog(webhookEventCatalog),
  ],
];

function renderModelProvidersTable() {
  const supported = MODEL_PROVIDER_CATALOG_SEED.filter((p) => p.support_status === 'supported');
  const harnesses = listHarnessDescriptors();
  return [
    '| Provider | `provider` ID | Default model | Compatible harnesses |',
    '|---|---|---|---|',
    ...supported.map((provider) => {
      const compatible = harnesses
        .filter((harness) => harness.supportedProviderIds.includes(provider.id))
        .map((harness) => `\`${harness.id}\``)
        .join(', ');
      return `| ${provider.label} | \`${provider.id}\` | \`${provider.default_model}\` | ${compatible} |`;
    }),
  ].join('\n');
}

function renderEventCatalog(catalog) {
  const lines = [];
  if (catalog.passthrough) {
    lines.push(
      `Shipfox forwards additional raw ${catalog.provider} webhook events. See [the complete ${catalog.provider} event reference](${catalog.upstreamEventsDocUrl}) for the upstream catalog.`,
      '',
    );
  }
  for (const event of catalog.events) {
    lines.push(
      `### \`${event.name}\``,
      '',
      event.summary,
      '',
      `**Emitted when:** ${event.emittedWhen}`,
      '',
      `**Payload:** ${event.payloadKind === 'raw-provider' ? 'Raw provider payload.' : 'Shipfox-normalized payload.'}`,
      ...(event.payloadDocUrl
        ? ['', `[Provider payload documentation](${event.payloadDocUrl})`]
        : []),
      '',
    );
  }
  return lines.join('\n').trimEnd();
}

function renderToolCatalog(catalog, selectionCatalog) {
  const lines = [];
  for (const category of [...new Set(catalog.map((tool) => tool.category))]) {
    lines.push(`### ${category.replaceAll('_', ' ')}`, '');
    for (const tool of catalog.filter((candidate) => candidate.category === category)) {
      lines.push(
        `#### \`${tool.id}\``,
        '',
        tool.description,
        '',
        `**Sensitivity:** ${tool.sensitivity}.`,
        '',
        `**Sensitive:** ${tool.sensitive ? 'Yes.' : 'No.'}`,
        '',
        `**Required permissions:** ${formatScope(tool.requiredScope)}`,
        '',
        `**Selector tokens:** ${formatSelectors(tool.id, selectionCatalog)}`,
        '',
        '##### Input',
        '',
        ...renderFields(tool.inputSchema),
      );
      for (const method of tool.methods ?? []) {
        lines.push(
          '',
          `##### \`${tool.id}.${method.id}\``,
          '',
          method.description,
          '',
          `**Sensitivity:** ${method.sensitivity}.`,
          '',
          `**Sensitive:** ${method.sensitive ? 'Yes.' : 'No.'}`,
          '',
          `**Required permissions:** ${formatScope(method.requiredScope)}`,
          '',
          methodRequirements(tool.inputSchema, method.id),
        );
      }
      if (tool.outputSchema) lines.push('', '##### Output', '', ...renderFields(tool.outputSchema));
      lines.push('');
    }
  }
  return lines.join('\n').trimEnd();
}

function renderFields(schema) {
  const properties = object(schema.properties);
  const required = new Set(strings(schema.required));
  const conditional = new Set(
    [...objects(schema.oneOf), ...objects(schema.anyOf)].flatMap((option) =>
      strings(option.required),
    ),
  );
  const rows = Object.entries(properties).map(([name, value]) => {
    const property = object(value);
    const requirement = required.has(name)
      ? 'Required'
      : conditional.has(name)
        ? 'Conditional'
        : 'Optional';
    const type =
      strings(property.enum).length > 0
        ? `${property.type}: ${strings(property.enum)
            .map((item) => `\`${item}\``)
            .join(', ')}`
        : (property.type ?? 'value');
    return `| \`${name}\` | ${type} | ${requirement} | ${property.description ?? ''} |`;
  });
  if (rows.length === 0) return ['This schema accepts an object with provider-defined fields.'];
  const alternatives = objects(schema.anyOf)
    .map((option) => strings(option.required))
    .filter((requiredFields) => requiredFields.length > 0);
  return [
    '| Field | Type | Required | Description |',
    '|---|---|---|---|',
    ...rows,
    ...(alternatives.length > 0
      ? [
          '',
          `At least one of these input combinations is required: ${alternatives.map((fields) => fields.map((field) => `\`${field}\``).join(' and ')).join('; ')}.`,
        ]
      : []),
  ];
}

function methodRequirements(schema, methodId) {
  const option = objects(schema.oneOf).find(
    (candidate) => object(object(candidate.properties).method).const === methodId,
  );
  const required = option ? strings(option.required) : [];
  return required.length > 0
    ? `**Required input for this method:** ${required.map((field) => `\`${field}\``).join(', ')}.`
    : 'This method has no additional required input.';
}

function formatScope(scope) {
  return Array.isArray(scope) && scope.length > 0
    ? scope.map((entry) => `\`${object(entry).permission}:${object(entry).access}\``).join(', ')
    : 'None.';
}

function formatSelectors(toolId, selectionCatalog) {
  return selectionCatalog.selectors
    .filter((selector) => selector.token === toolId || selector.token.startsWith(`${toolId}.`))
    .map((selector) => {
      const target = selector.token.endsWith('.*') ? toolId : selector.token;
      return `[\`${selector.token}\`](#${slugForHeading(target)})`;
    })
    .join(', ');
}

function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

function strings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function objects(value) {
  return Array.isArray(value) ? value.map(object) : [];
}

for (const [file, render] of regions) {
  const path = join(docsRoot, file);
  mkdirSync(dirname(path), {recursive: true});
  const next = `${render()}\n`;
  writeFileSync(path, next);
  // biome-ignore lint/suspicious/noConsole: CLI diagnostics
  console.log(`✓ wrote ${file}`);
}
