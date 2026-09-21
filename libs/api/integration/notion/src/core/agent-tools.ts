import type {NotionAgentToolId} from '@shipfox/api-integration-notion-dto';
import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';
import type {NotionAgentToolHttpMethod, NotionAgentToolQueryValue} from '#api/client.js';
import {normalizeNotionId} from './notion-id.js';

export type NotionAgentToolRequiredScope = 'read';
export type NotionAgentToolCatalogEntry = AgentToolCatalogEntry<NotionAgentToolRequiredScope>;

interface NotionAgentToolCatalogInput {
  id: NotionAgentToolId;
  description: string;
  inputSchema: AgentToolJsonSchema;
  outputSchema: AgentToolJsonSchema;
}

const pageIdSchema = stringSchema('Notion page URL or page ID');
const dataSourceIdSchema = stringSchema('Notion data source URL or data source ID');
const cursorSchema = stringSchema('Notion pagination cursor from the previous response');
const pageSizeSchema = integerSchema('Number of results to return, from 1 to 100', 1, 100);
const dynamicObjectSchema = openObjectSchema('Notion object with provider-defined fields');

export const notionAgentToolCatalog = [
  tool({
    id: 'search',
    description:
      'Search shared Notion pages and data sources by title. This is not full-text search. The result is paginated and can be filtered by object type.',
    inputSchema: objectSchema({
      query: stringSchema('Title text to search for'),
      object: enumSchema(['page', 'data_source'], 'Only return pages or data sources'),
      page_size: pageSizeSchema,
      cursor: cursorSchema,
    }),
    outputSchema: objectSchema({
      results: arraySchema(dynamicObjectSchema),
      next_cursor: nullableStringSchema('Cursor for the next page'),
      has_more: booleanSchema('Whether another page is available'),
    }),
  }),
  tool({
    id: 'get_page',
    description:
      'Retrieve a shared Notion page by URL or ID, including its title, parent, properties, and timestamps.',
    inputSchema: objectSchema({page_id: pageIdSchema}, ['page_id']),
    outputSchema: pageOutputSchema(),
  }),
  tool({
    id: 'get_page_content',
    description: 'Retrieve the Markdown content of a shared Notion page by URL or ID.',
    inputSchema: objectSchema({page_id: pageIdSchema}, ['page_id']),
    outputSchema: objectSchema({
      markdown: stringSchema('Page content in Markdown'),
      truncated: booleanSchema('Whether Notion truncated the content'),
      unknown_block_ids: arraySchema(stringSchema('Block ID Notion could not represent')),
    }),
  }),
  tool({
    id: 'query_data_source',
    description:
      'Query rows in a shared Notion data source. Notion filter and sort objects pass through unchanged.',
    inputSchema: objectSchema(
      {
        data_source_id: dataSourceIdSchema,
        filter: dynamicObjectSchema,
        sorts: arraySchema(dynamicObjectSchema),
        page_size: pageSizeSchema,
        cursor: cursorSchema,
      },
      ['data_source_id'],
    ),
    outputSchema: objectSchema({
      results: arraySchema(dynamicObjectSchema),
      next_cursor: nullableStringSchema('Cursor for the next page'),
      has_more: booleanSchema('Whether another page is available'),
    }),
  }),
  tool({
    id: 'get_comments',
    description: 'List comments on a shared Notion page or block. The result is paginated.',
    inputSchema: objectSchema(
      {block_id: stringSchema('Notion page URL, block URL, or block ID'), cursor: cursorSchema},
      ['block_id'],
    ),
    outputSchema: objectSchema({
      results: arraySchema(dynamicObjectSchema),
      next_cursor: nullableStringSchema('Cursor for the next page'),
      has_more: booleanSchema('Whether another page is available'),
    }),
  }),
] as const satisfies readonly NotionAgentToolCatalogEntry[];

export const notionAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: notionAgentToolCatalog.map(
    (entry): AgentToolSelector => ({
      token: entry.id,
      kind: 'standalone',
      sensitivity: entry.sensitivity,
      sensitive: entry.sensitive,
    }),
  ),
};

export interface NotionToolOperation {
  method: NotionAgentToolHttpMethod;
  path: (args: Record<string, unknown>) => string;
  query?: (args: Record<string, unknown>) => Record<string, NotionAgentToolQueryValue>;
  body?: (args: Record<string, unknown>) => unknown;
}

export const NOTION_TOOL_OPERATIONS: Partial<Record<NotionAgentToolId, NotionToolOperation>> = {
  search: {
    method: 'POST',
    path: () => '/v1/search',
    body: (args) => ({
      ...definedArguments(args, [
        ['query', 'query'],
        ['page_size', 'page_size'],
        ['cursor', 'start_cursor'],
      ]),
      ...(args.object === undefined ? {} : {filter: {property: 'object', value: args.object}}),
    }),
  },
  get_page: {
    method: 'GET',
    path: (args) =>
      `/v1/pages/${encodeURIComponent(normalizeNotionId(stringArgument(args, 'page_id')))}`,
  },
  get_page_content: {
    method: 'GET',
    path: (args) =>
      `/v1/pages/${encodeURIComponent(normalizeNotionId(stringArgument(args, 'page_id')))}/markdown`,
  },
  query_data_source: {
    method: 'POST',
    path: (args) =>
      `/v1/data_sources/${encodeURIComponent(normalizeNotionId(stringArgument(args, 'data_source_id')))}/query`,
    body: (args) =>
      definedArguments(args, [
        ['filter', 'filter'],
        ['sorts', 'sorts'],
        ['page_size', 'page_size'],
        ['cursor', 'start_cursor'],
      ]),
  },
  get_comments: {
    method: 'GET',
    path: () => '/v1/comments',
    query: (args) => ({
      block_id: normalizeNotionId(stringArgument(args, 'block_id')),
      ...(args.cursor === undefined ? {} : {start_cursor: String(args.cursor)}),
    }),
  },
};

function tool(input: NotionAgentToolCatalogInput): NotionAgentToolCatalogEntry {
  return {
    id: input.id,
    description: input.description,
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
  };
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
  };
}

function pageOutputSchema(): AgentToolJsonSchema {
  return {
    ...objectSchema({
      id: stringSchema('Notion page ID'),
      url: stringSchema('Notion page URL'),
      title: stringSchema('Page title'),
      parent: dynamicObjectSchema,
      properties: dynamicObjectSchema,
      created_time: stringSchema('Creation timestamp'),
      last_edited_time: stringSchema('Last edit timestamp'),
    }),
    additionalProperties: true,
  };
}

function openObjectSchema(description: string): AgentToolJsonSchema {
  return {type: 'object', description, additionalProperties: true};
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description === undefined ? {} : {description})};
}

function nullableStringSchema(description?: string): AgentToolJsonSchema {
  return {type: ['string', 'null'], ...(description === undefined ? {} : {description})};
}

function booleanSchema(description: string): AgentToolJsonSchema {
  return {type: 'boolean', description};
}

function integerSchema(description: string, minimum: number, maximum: number): AgentToolJsonSchema {
  return {type: 'integer', description, minimum, maximum};
}

function enumSchema(values: string[], description: string): AgentToolJsonSchema {
  return {type: 'string', description, enum: values};
}

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}

function definedArguments(
  args: Record<string, unknown>,
  names: readonly (readonly [string, string])[],
): Record<string, unknown> {
  return Object.fromEntries(
    names
      .map(([inputName, outputName]) => [outputName, args[inputName]] as const)
      .filter(([, value]) => value !== undefined),
  );
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : String(value ?? '');
}
