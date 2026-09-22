import type {InferPageType} from 'fumadocs-core/source';
import {config} from '@/config';
import {
  assertMachineReadableMarkdown,
  canonicalDocsUrl,
  serializeMachineReadableMarkdown,
} from '@/lib/machine-readable';
import type {source} from '@/lib/source';
import {toUrl} from '@/url';

const TRAILING_SLASH_PATTERN = /\/$/;
const INTEGRATION_EVENTS_PAGE_PATTERN = /^\/integrations\/[^/]+\/events$/;
const INTEGRATION_TOOLS_PAGE_PATTERN = /^\/integrations\/[^/]+\/tools$/;

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText('processed');
  const description = page.data.description;
  if (typeof description !== 'string' || description.length === 0) {
    const source = page.path ? `${page.path} (${page.url})` : page.url;
    throw new Error(`Documentation page "${source}" is missing a description.`);
  }

  const integrationCatalog = processed.includes('IntegrationCatalog')
    ? (await import('@/lib/integration-catalog-source')).getIntegrationCatalog()
    : undefined;
  const modelCatalog = processed.includes('ModelCatalog')
    ? await (await import('@/lib/model-catalog-source')).getModelCatalog()
    : undefined;
  const toolReference = processed.includes('ToolReference')
    ? (await import('@/lib/tool-reference-source')).getToolReferenceDocument(
        referenceId(page, 'toolReference'),
      )
    : undefined;
  const eventReference = processed.includes('EventReference')
    ? (await import('@/lib/event-reference-source')).getEventReferenceDocument(
        referenceId(page, 'eventReference'),
      )
    : undefined;
  const body = serializeMachineReadableMarkdown(processed, {
    integrationCatalog,
    modelCatalog,
    toolReference,
    eventReference,
    pageUrl: page.url,
    requiredFacts: requiredFactsForPage(page.url),
    sourcePath: page.path,
  });
  const markdown = [
    `# ${page.data.title} (${machineReadablePageUrl(page.url)})`,
    '',
    `Description: ${description}`,
    '',
    body,
  ].join('\n');

  assertMachineReadableMarkdown(markdown, {
    pageUrl: page.url,
    requiredFacts: requiredFactsForPage(page.url),
    sourcePath: page.path,
  });
  return markdown;
}

function referenceId(
  page: InferPageType<typeof source>,
  field: 'toolReference' | 'eventReference',
): string {
  const id = (page.data as Partial<Record<typeof field, unknown>>)[field];
  if (typeof id !== 'string' || id.length === 0) {
    const component = field === 'toolReference' ? 'ToolReference' : 'EventReference';
    throw new Error(
      `Documentation page "${page.url}" renders ${component} without a ${field} frontmatter id.`,
    );
  }
  return id;
}

function machineReadablePageUrl(pageUrl: string): string {
  const deploymentEnvironment = config.VERCEL_ENV ?? config.NEXT_PUBLIC_VERCEL_ENV;
  return deploymentEnvironment === 'production' ? toUrl(pageUrl) : canonicalDocsUrl(pageUrl);
}

function requiredFactsForPage(pageUrl: string): string[] {
  const path = pageUrl.replace(TRAILING_SLASH_PATTERN, '');
  if (path === '/reference/workflow-schema') {
    return [
      '## Workflow',
      '| `name` |',
      '## `concurrency`',
      '| `group` |',
      '### `steps[*]` agent step',
      '| `prompt` |',
    ];
  }
  if (path === '/reference/contexts') {
    return [
      '## Available contexts',
      '| Context | Holds |',
      '## Context properties',
      '| Property | Type | Description |',
    ];
  }
  if (path === '/reference/mcp-server') {
    return ['## Tool catalog', '#### `list_projects`', '##### Input'];
  }
  if (path === '/reference/model-providers') {
    return ['## Supported providers', '| Provider | `provider` ID |'];
  }
  if (path === '/reference/cloud-models') {
    return ['## Available models', '| Model | `model` ID |', '| Capabilities |'];
  }
  if (path === '/integrations') return ['## Integration catalog', '### GitHub'];
  if (INTEGRATION_EVENTS_PAGE_PATTERN.test(path)) {
    return ['## Event catalog', '#### `'];
  }
  if (INTEGRATION_TOOLS_PAGE_PATTERN.test(path)) {
    return ['## Tool catalog', '##### Input'];
  }
  return [];
}
