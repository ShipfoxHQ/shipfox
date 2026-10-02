import {listShippedSkillResources} from '@shipfox/workflow-templates';
import {renderAgentHandoff} from './agent-handoff';
import {canonicalDocsOrigin} from './canonical-docs-origin';
import {serializeEditionsComparison} from './editions';
import type {EventReferenceDocument} from './event-reference/document';
import {
  type CatalogProvider,
  catalogCapabilityLabels,
  catalogCategoryLabels,
  integrationRequestHref,
  type RequestableIntegration,
} from './integration-catalog';
import {inlineCode, tableValue} from './markdown';
import {type ModelCatalog, serializeModelCatalog} from './model-catalog';
import {serializeSolutionsComparison} from './solutions-comparison';
import {serializeTemplateCatalog, serializeTemplateDetail} from './template-catalog/markdown';
import type {TemplateCatalogEntry, TemplateDetail} from './template-catalog/types';
import type {ToolReferenceDocument} from './tool-reference/document';
import {serializeWorkflowOverview} from './workflow-overview';

const INTERNAL_DOC_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'shipfox.io',
  'www.shipfox.io',
  'shipfox-docs.vercel.app',
]);
const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const UNRESOLVED_MDX_COMPONENT_PATTERN = /<\/?[A-Z][A-Za-z0-9]*(?:\s[^<>]*)?\/?>(?:\s|$)/m;
const ROOT_RELATIVE_LINK_PATTERN = /\]\(\s*\//;
const ROOT_RELATIVE_ATTRIBUTE_PATTERN = /\b(?:href|src)=(['"])\//;
const PREVIEW_DOC_URL_PATTERN =
  /https?:\/\/(?:[^/\s]+\.vercel\.app|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)(?:\/|$)/;
const NON_CANONICAL_SHIPFOX_URL_PATTERN =
  /https?:\/\/(?:www\.)?shipfox\.io\/(?!docs(?:[/?#\s)\]"'<>]|[.,;:](?=$|[\s)\]"'<>])))/;
const UNUSABLE_IMAGE_SOURCE_PATTERN = /__img\d+/;
const UNUSABLE_MDX_IMAGE_PATTERN =
  /<img\b(?=[^>]*\bsrc\s*=\s*(?:["']__img\d+["']|\{__img\d+\}))[^>]*\/?>/gi;
const UNUSABLE_MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*<?__img\d+[^)]*\)?/gi;
const MARKDOWN_LINK_DESTINATION_PATTERN = /(\]\(\s*)(<[^>\n]+>|[^)\s]+)([^)\n]*\))/g;
const HTML_ATTRIBUTE_PATTERN = /\b(src|href)=(['"])([^'"]+)\2/g;
const ALT_ATTRIBUTE_PATTERN = /\balt=(['"])(.*?)\1/i;
const QUOTE_PREFIX_PATTERN = /^(?: {0,3}> ?)+$/;

type FenceCharacter = '`' | '~';

interface FenceMarker {
  character: FenceCharacter;
  length: number;
}

export type MarkdownAudience = 'human' | 'mcp';

export {stringifyMachineReadableComponent} from './machine-readable-stringify';
export {renderAgentHandoff};

export interface MachineReadableMarkdownOptions {
  integrationCatalog?: readonly CatalogProvider[];
  requestableIntegrations?: readonly RequestableIntegration[];
  modelCatalog?: ModelCatalog;
  toolReference?: ToolReferenceDocument;
  eventReference?: EventReferenceDocument;
  templateCatalog?: readonly TemplateCatalogEntry[];
  getTemplateDetail?: (id: string) => TemplateDetail;
  pageUrl?: string;
  requiredFacts?: readonly string[];
  sourcePath?: string;
}

export interface SerializeMachineReadableMarkdownOptions extends MachineReadableMarkdownOptions {
  audience: MarkdownAudience;
}

export function canonicalDocsUrl(pageUrl: string): string {
  return canonicalizeDocumentationUrl(pageUrl);
}

export function canonicalizeDocumentationUrl(destination: string, pageUrl?: string): string {
  const value = destination.trim();
  if (!value || value.startsWith('//')) {
    return destination;
  }

  if (value.startsWith('#') || value.startsWith('?')) {
    return pageUrl ? `${canonicalDocsUrl(pageUrl)}${value}` : destination;
  }

  if (value.startsWith('/')) return canonicalPath(value);

  let parsed: URL;
  try {
    parsed = pageUrl ? new URL(value, canonicalDocsUrl(pageUrl)) : new URL(value);
  } catch {
    return destination;
  }

  if (!isInternalDocumentationHost(parsed.hostname)) return destination;
  if (!isCanonicalDocumentationPath(parsed.pathname)) return destination;
  return canonicalPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
}

export function serializeIntegrationCatalog(
  providers: readonly CatalogProvider[],
  requestableIntegrations: readonly RequestableIntegration[] = [],
): string {
  const sections = providers.map((provider) => {
    const events = provider.eventCount
      ? `${provider.eventCount} ([event catalog](/integrations/${provider.slug}/events))`
      : '0';
    const tools = provider.toolCount
      ? `${provider.toolCount} ([tool catalog](/integrations/${provider.slug}/tools))`
      : '0';

    return [
      `### ${provider.name}`,
      '',
      provider.summary,
      '',
      '| Field | Value |',
      '|---|---|',
      `| Slug | ${inlineCode(provider.slug)} |`,
      `| Icon | ${inlineCode(provider.icon)} |`,
      `| Capabilities | ${tableValue(provider.capabilities.map((value) => catalogCapabilityLabels[value]).join(', '))} |`,
      `| Categories | ${tableValue(provider.categories.map((value) => catalogCategoryLabels[value]).join(', '))} |`,
      `| Aliases | ${tableValue(provider.aliases.map(inlineCode).join(', '))} |`,
      `| Events | ${tableValue(events)} |`,
      `| Tools | ${tableValue(tools)} |`,
      `| Overview | ${tableValue(`[${provider.name}](${provider.overviewHref})`)} |`,
      `| Setup | ${tableValue(provider.setupHref ? `[Connect ${provider.name}](${provider.setupHref})` : 'Not required')} |`,
    ].join('\n');
  });

  return [
    '## Integration catalog',
    '',
    'Every integration listed here is available in the documentation and carries the capabilities, event, and tool facts shown below.',
    '',
    sections.join('\n\n'),
    ...(requestableIntegrations.length > 0
      ? ['', serializeRequestableIntegrations(requestableIntegrations)]
      : []),
  ].join('\n');
}

function serializeRequestableIntegrations(integrations: readonly RequestableIntegration[]): string {
  return [
    '## Available on request',
    '',
    `These integrations need access first. Until Shipfox enables one for a workspace, it has no events, tools, or integration connection, so a workflow cannot reference it. A workspace can request access through the [integration request form](${integrationRequestHref()}).`,
    '',
    '| Integration | Type | Intended use |',
    '|---|---|---|',
    ...integrations.map(
      (integration) =>
        `| ${tableValue(integration.name)} | ${tableValue(integration.categories.map((value) => catalogCategoryLabels[value]).join(', '))} | ${tableValue(integration.summary)} |`,
    ),
  ].join('\n');
}

export function serializeMachineReadableMarkdown(
  markdown: string,
  options: SerializeMachineReadableMarkdownOptions,
): string {
  let serialized = replacePlaceholders(markdown, options);
  serialized = replaceUnusableImages(serialized);
  serialized = rewriteMachineReadableLinks(serialized, options.pageUrl);
  assertMachineReadableMarkdown(serialized, options);
  if (options.audience === 'mcp') assertNoBareCatalogPrompt(serialized, options);
  return serialized.trim();
}

/**
 * Rejects a skill's `catalog_prompt` shown as a code block in the `mcp` rendering,
 * where `AgentHandoff` should name the skill instead. It knows catalog prompts only,
 * so a handoff written in other words passes.
 */
export function assertNoBareCatalogPrompt(
  markdown: string,
  {pageUrl, sourcePath}: MachineReadableMarkdownOptions = {},
): void {
  const prompts = new Map<string, string>();
  for (const resource of listShippedSkillResources()) {
    if (resource.catalogPrompt) prompts.set(resource.catalogPrompt.trim(), resource.uri);
  }

  const label = pageLabel(pageUrl, sourcePath);
  for (const body of fencedBlockBodies(markdown)) {
    const skillUri = prompts.get(body.trim());
    if (skillUri) {
      throw new Error(
        `Machine-readable Markdown${label ? ` for ${label}` : ''} shows the catalog prompt of ${skillUri} in a code block. Use AgentHandoff.`,
      );
    }
  }
}

export function rewriteMachineReadableLinks(markdown: string, pageUrl?: string): string {
  let fence: FenceMarker | undefined;

  return markdown
    .split('\n')
    .map((line) => {
      const marker = fenceMarker(line);
      if (!fence && marker) {
        fence = marker;
        return line;
      }
      if (fence && closesFence(line, fence)) {
        fence = undefined;
        return line;
      }
      return fence ? line : rewriteMachineReadableLine(line, pageUrl);
    })
    .join('\n');
}

export function assertMachineReadableMarkdown(
  markdown: string,
  {pageUrl, requiredFacts = [], sourcePath}: MachineReadableMarkdownOptions = {},
): void {
  const document = withoutFencedCode(markdown);
  const label = pageLabel(pageUrl, sourcePath);
  const page = label ? ` for ${label}` : '';

  if (markdown.includes('\0'))
    throw new Error(
      `Machine-readable Markdown${page} contains an unresolved component placeholder.`,
    );

  const unresolvedComponent = document.match(UNRESOLVED_MDX_COMPONENT_PATTERN)?.[0];
  if (unresolvedComponent) {
    throw new Error(
      `Machine-readable Markdown${page} contains an unresolved MDX component: ${unresolvedComponent}`,
    );
  }

  if (ROOT_RELATIVE_LINK_PATTERN.test(document) || ROOT_RELATIVE_ATTRIBUTE_PATTERN.test(document)) {
    throw new Error(`Machine-readable Markdown${page} contains a root-relative link or media URL.`);
  }

  assertCanonicalUrls(document, pageUrl, page);

  if (UNUSABLE_IMAGE_SOURCE_PATTERN.test(document)) {
    throw new Error(`Machine-readable Markdown${page} contains an unusable image source.`);
  }

  for (const fact of requiredFacts) {
    if (!markdown.includes(fact)) {
      throw new Error(`Machine-readable Markdown${page} is missing generated fact: ${fact}`);
    }
  }
}

type PlaceholderOptions = Pick<
  MachineReadableMarkdownOptions,
  | 'integrationCatalog'
  | 'requestableIntegrations'
  | 'modelCatalog'
  | 'toolReference'
  | 'eventReference'
  | 'templateCatalog'
  | 'getTemplateDetail'
> &
  Pick<SerializeMachineReadableMarkdownOptions, 'audience'>;

const placeholderSerializers: Record<
  string,
  (options: PlaceholderOptions, attributes: Record<string, unknown>, children: string) => string
> = {
  ForHumans: (options, _attributes, children) => (options.audience === 'human' ? children : ''),
  ComparisonTable: (options) => {
    if (!options.integrationCatalog) {
      throw new Error('ComparisonTable requires an integration catalog.');
    }
    return serializeSolutionsComparison(options.integrationCatalog);
  },
  EditionsComparison: () => serializeEditionsComparison(),
  WorkflowOverview: () => serializeWorkflowOverview(),
  IntegrationCatalog: (options) => {
    if (!options.integrationCatalog) {
      throw new Error('Integration catalog data is unavailable for machine-readable Markdown.');
    }
    return serializeIntegrationCatalog(options.integrationCatalog, options.requestableIntegrations);
  },
  ModelCatalog: (options) => {
    if (!options.modelCatalog) {
      throw new Error('Model catalog data is unavailable for machine-readable Markdown.');
    }
    return serializeModelCatalog(options.modelCatalog);
  },
  ToolReference: (options) => {
    if (!options.toolReference) {
      throw new Error('Tool reference data is unavailable for machine-readable Markdown.');
    }
    return options.toolReference.markdown;
  },
  EventReference: (options) => {
    if (!options.eventReference) {
      throw new Error('Event reference data is unavailable for machine-readable Markdown.');
    }
    return options.eventReference.markdown;
  },
  TemplateGallery: (options) => {
    if (!options.templateCatalog) {
      throw new Error('Example catalog data is unavailable for machine-readable Markdown.');
    }
    return serializeTemplateCatalog(options.templateCatalog);
  },
  TemplateDetail: (options, attributes) => {
    if (!options.getTemplateDetail || typeof attributes.id !== 'string') {
      throw new Error('Example data is unavailable for machine-readable Markdown.');
    }
    return serializeTemplateDetail({
      template: options.getTemplateDetail(attributes.id),
      audience: options.audience,
    });
  },
  AgentHandoff: (options, attributes) => {
    const {skill, prompt} = attributes;
    if (typeof skill !== 'string' || typeof prompt !== 'string') {
      throw new Error('AgentHandoff requires a skill and a prompt.');
    }
    return renderAgentHandoff({skill, prompt, audience: options.audience});
  },
};

function replacePlaceholders(markdown: string, options: PlaceholderOptions): string {
  // Trailing newlines are captured so a dropped block doesn't leave a gap of blank lines.
  return markdown.replace(
    /\0([\s\S]*?)\0(\n*)/g,
    (_match, value: string, trailing: string, offset: number) => {
      let placeholder: unknown;
      try {
        placeholder = JSON.parse(value);
      } catch {
        throw new Error('Machine-readable Markdown contains an invalid component placeholder.');
      }

      if (!isPlaceholder(placeholder)) {
        throw new Error('Machine-readable Markdown contains an invalid component placeholder.');
      }

      const serialize = placeholderSerializers[placeholder.name];
      if (!serialize) {
        throw new Error(
          `Machine-readable Markdown contains an unresolved component placeholder: ${placeholder.name}`,
        );
      }
      // A dropped block inside a Callout, quote, or list would leave its marker behind.
      if (
        placeholder.name === 'ForHumans' &&
        markdown.lastIndexOf('\n', offset - 1) + 1 !== offset
      ) {
        throw new Error('ForHumans cannot be nested inside a Callout, quote, or list.');
      }

      const resolved = continueQuote(
        serialize(options, placeholder.attributes ?? {}, placeholder.children ?? ''),
        linePrefix(markdown, offset),
      );
      return resolved ? `${resolved}${trailing}` : '';
    },
  );
}

// A placeholder inside a blockquote or Callout resolves to several lines, and
// each one needs the quote markers of the line that held the placeholder.
function linePrefix(markdown: string, offset: number): string {
  const lineStart = markdown.lastIndexOf('\n', offset - 1) + 1;
  const before = markdown.slice(lineStart, offset);
  return QUOTE_PREFIX_PATTERN.test(before) ? before : '';
}

function continueQuote(text: string, prefix: string): string {
  if (!prefix) return text;
  return text
    .split('\n')
    .map((line, index) => {
      if (index === 0) return line;
      return line === '' ? prefix.trimEnd() : `${prefix}${line}`;
    })
    .join('\n');
}

function replaceUnusableImages(markdown: string): string {
  const withMdxImages = markdown.replace(UNUSABLE_MDX_IMAGE_PATTERN, (tag) =>
    imageDescription(tag),
  );

  return withMdxImages.replace(UNUSABLE_MARKDOWN_IMAGE_PATTERN, (_match, alt: string) => {
    return imageDescription(alt ? `alt="${alt}"` : '');
  });
}

function rewriteMachineReadableLine(line: string, pageUrl?: string): string {
  const withLinks = line.replace(
    MARKDOWN_LINK_DESTINATION_PATTERN,
    (_match, prefix: string, destination: string, suffix: string) => {
      const wrapped = destination.startsWith('<') && destination.endsWith('>');
      const value = wrapped ? destination.slice(1, -1) : destination;
      const rewritten = canonicalizeDocumentationUrl(value, pageUrl);
      return `${prefix}${wrapped ? `<${rewritten}>` : rewritten}${suffix}`;
    },
  );

  return withLinks.replace(
    HTML_ATTRIBUTE_PATTERN,
    (_match, name: string, quote: string, destination: string) =>
      `${name}=${quote}${canonicalizeDocumentationUrl(destination, pageUrl)}${quote}`,
  );
}

function canonicalPath(value: string): string {
  const url = new URL(value, `${canonicalDocsOrigin}/`);
  let pathname = url.pathname;
  if (pathname === '/docs') pathname = '/';
  else if (pathname.startsWith('/docs/')) pathname = pathname.slice('/docs'.length);

  return `${canonicalDocsOrigin}${pathname === '/' ? '' : pathname}${url.search}${url.hash}`;
}

function isInternalDocumentationHost(hostname: string): boolean {
  return INTERNAL_DOC_HOSTS.has(hostname);
}

function pageLabel(pageUrl?: string, sourcePath?: string): string {
  if (sourcePath && pageUrl) return `${sourcePath} (${pageUrl})`;
  return sourcePath || pageUrl || '';
}

function assertCanonicalUrls(document: string, pageUrl: string | undefined, page: string): void {
  const values = [pageUrl ?? '', document];
  if (values.some((value) => PREVIEW_DOC_URL_PATTERN.test(value))) {
    throw new Error(`Machine-readable Markdown${page} contains a preview or local docs URL.`);
  }
  if (values.some((value) => NON_CANONICAL_SHIPFOX_URL_PATTERN.test(value))) {
    throw new Error(`Machine-readable Markdown${page} contains a non-canonical Shipfox URL.`);
  }
}

function isCanonicalDocumentationPath(pathname: string): boolean {
  return pathname === '/docs' || pathname.startsWith('/docs/');
}

function withoutFencedCode(markdown: string): string {
  let fence: FenceMarker | undefined;
  return markdown
    .split('\n')
    .filter((line) => {
      const marker = fenceMarker(line);
      if (!fence && marker) {
        fence = marker;
        return false;
      }
      if (fence && closesFence(line, fence)) {
        fence = undefined;
        return false;
      }
      return !fence;
    })
    .join('\n');
}

function fencedBlockBodies(markdown: string): string[] {
  const bodies: string[] = [];
  let fence: FenceMarker | undefined;
  let body: string[] = [];
  for (const line of markdown.split('\n')) {
    const marker = fenceMarker(line);
    if (!fence && marker) {
      fence = marker;
      body = [];
    } else if (fence && closesFence(line, fence)) {
      bodies.push(body.join('\n'));
      fence = undefined;
    } else if (fence) {
      body.push(line);
    }
  }
  return bodies;
}

function fenceMarker(line: string): FenceMarker | undefined {
  const marker = line.match(FENCE_OPEN_PATTERN)?.[1];
  if (!marker) return undefined;
  return {
    character: marker[0] as FenceCharacter,
    length: marker.length,
  };
}

function closesFence(line: string, fence: FenceMarker): boolean {
  const marker = fenceMarker(line);
  return Boolean(
    marker &&
      FENCE_CLOSE_PATTERN.test(line) &&
      marker.character === fence.character &&
      marker.length >= fence.length,
  );
}

function imageDescription(tag: string): string {
  const alt = ALT_ATTRIBUTE_PATTERN.exec(tag)?.[2]?.trim();
  return alt ? `[Image: ${alt}]` : '[Image]';
}

function isPlaceholder(
  value: unknown,
): value is {name: string; children?: string; attributes?: Record<string, unknown>} {
  return (
    typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
  );
}
