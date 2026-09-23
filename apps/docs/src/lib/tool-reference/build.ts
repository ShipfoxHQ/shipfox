import {slug} from 'github-slugger';
import type {
  ToolAccess,
  ToolReferenceDocument,
  ToolReferenceMethod,
  ToolReferenceRepository,
  ToolReferenceTool,
} from '@/lib/tool-reference/document';
import {integrationExamples, mcpExamples} from '@/lib/tool-reference/examples';
import {serializeToolReferenceMarkdown} from '@/lib/tool-reference/markdown';
import {
  type JsonSchema,
  object,
  objects,
  schemaAlternatives,
  schemaFields,
  schemaVariants,
  strings,
} from '@/lib/tool-reference/schema-fields';

type RepositoryScope = {
  kind: string;
  requiresExplicitRepository?: boolean | undefined;
  indirectTargetNote?: string | undefined;
};

interface CatalogMetadata {
  description: string;
  sensitivity: ToolAccess;
  sensitive: boolean;
  requiredScope: unknown;
  alternativeScopes?: readonly unknown[] | undefined;
  repositoryScope?: ((args: Readonly<Record<string, unknown>>) => RepositoryScope) | undefined;
  indirectTargetNote?: string | undefined;
}

export interface CatalogMethodLike extends CatalogMetadata {
  id: string;
}

export interface CatalogEntryLike extends CatalogMetadata {
  id: string;
  category?: string | undefined;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema | undefined;
  methods?: readonly CatalogMethodLike[] | undefined;
}

export interface IntegrationToolReferenceInput {
  id: string;
  catalog: readonly CatalogEntryLike[];
  selectors: readonly {token: string}[];
  /** Slug of the integration connection used in examples. */
  connection: string;
  /** Whether readers must replace the example integration connection slug. */
  replaceConnection?: boolean;
}

export interface McpToolLike {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations?: {readOnlyHint?: boolean | undefined} | undefined;
}

export interface McpToolReferenceInput {
  id: string;
  groups: readonly {title: string; tools: readonly McpToolLike[]}[];
}

const UNCATEGORIZED_CATEGORY = 'tools';

const repositoryCoordinateSamples: Record<string, string> = {
  owner: 'example-owner',
  repo: 'example-repository',
  base_owner: 'example-base-owner',
  base_repo: 'example-base-repository',
  head_owner: 'example-head-owner',
  head_repo: 'example-head-repository',
  repository_owner: 'example-owner',
  repository_name: 'example-repository',
  repository: 'example-owner/example-repository',
};

export function buildIntegrationToolReference(
  input: IntegrationToolReferenceInput,
): ToolReferenceDocument {
  const categoryOf = (entry: CatalogEntryLike) => entry.category ?? UNCATEGORIZED_CATEGORY;
  const categories = [...new Set(input.catalog.map(categoryOf))];
  const groups = categories.map((category) => {
    const title = groupTitle(category);
    return {
      title,
      anchor: slug(title),
      tools: input.catalog
        .filter((entry) => categoryOf(entry) === category)
        .map((entry) => integrationTool(entry, input)),
    };
  });
  return finalize({id: input.id, kind: 'integration', outputLabel: 'Output', groups});
}

export function buildMcpToolReference(input: McpToolReferenceInput): ToolReferenceDocument {
  const groups = input.groups.map((group) => ({
    title: group.title,
    anchor: slug(group.title),
    tools: group.tools.map(mcpTool),
  }));
  return finalize({id: input.id, kind: 'mcp', outputLabel: 'Result', groups});
}

function finalize(document: Omit<ToolReferenceDocument, 'markdown'>): ToolReferenceDocument {
  return {...document, markdown: serializeToolReferenceMarkdown(document)};
}

function integrationTool(
  entry: CatalogEntryLike,
  input: IntegrationToolReferenceInput,
): ToolReferenceTool {
  const fields = schemaFields(entry.inputSchema);
  const methods = entry.methods?.map((method) => integrationMethod(entry, method));
  const firstMethod = methods?.[0];
  const output = entry.outputSchema ? schemaFields(entry.outputSchema) : undefined;
  return {
    id: entry.id,
    anchor: slug(entry.id),
    description: entry.description,
    ...metadata(entry, entry.inputSchema),
    selectors: input.selectors
      .map((selector) => selector.token)
      .filter((token) => token === entry.id || token.startsWith(`${entry.id}.`)),
    input: fields,
    ...optional('inputAlternatives', schemaAlternatives(entry.inputSchema)),
    ...optional('methods', methods),
    ...optional('output', output),
    examples: integrationExamples({
      toolId: entry.id,
      connection: input.connection,
      replaceConnection: input.replaceConnection ?? true,
      access: entry.sensitivity,
      input: fields,
      ...(firstMethod
        ? {
            methodId: firstMethod.id.slice(entry.id.length + 1),
            methodRequiredInput: firstMethod.requiredInput,
          }
        : {}),
      ...optional('output', output),
    }),
  };
}

function integrationMethod(
  entry: CatalogEntryLike,
  method: CatalogMethodLike,
): ToolReferenceMethod {
  const id = `${entry.id}.${method.id}`;
  const option = objects(entry.inputSchema.oneOf).find(
    (candidate) => object(object(candidate.properties).method).const === method.id,
  );
  return {
    id,
    anchor: slug(id),
    description: method.description,
    ...metadata(method, entry.inputSchema),
    requiredInput: option ? strings(option.required) : [],
  };
}

function metadata(
  source: CatalogMetadata,
  inputSchema: JsonSchema,
): Pick<
  ToolReferenceTool,
  'access' | 'sensitive' | 'permissions' | 'alternativePermissions' | 'repository'
> {
  const alternatives = (source.alternativeScopes ?? []).map(formatScope);
  return {
    access: source.sensitivity,
    sensitive: source.sensitive,
    permissions: formatScope(source.requiredScope),
    ...optional('alternativePermissions', alternatives.length > 0 ? alternatives : undefined),
    ...optional('repository', repository(source, inputSchema)),
  };
}

function formatScope(scope: unknown): string[] {
  if (Array.isArray(scope)) {
    return scope.map((entry) => `${object(entry).permission}:${object(entry).access}`);
  }
  return typeof scope === 'string' && scope.length > 0 ? [scope] : [];
}

function repository(
  source: CatalogMetadata,
  inputSchema: JsonSchema,
): ToolReferenceRepository | undefined {
  if (typeof source.repositoryScope !== 'function') return undefined;
  const properties = object(inputSchema.properties);
  const sampleArguments = Object.fromEntries(
    Object.entries(repositoryCoordinateSamples).filter(([name]) => name in properties),
  );
  const directScope = source.repositoryScope(sampleArguments);
  const connectionScope = source.repositoryScope({});
  const indirectTargetNote =
    source.indirectTargetNote ??
    directScope.indirectTargetNote ??
    connectionScope.indirectTargetNote;
  return {
    classification: classification(directScope, connectionScope),
    ...optional('indirectTargetNote', indirectTargetNote),
  };
}

function classification(directScope: RepositoryScope, connectionScope: RepositoryScope): string {
  if (directScope.kind === 'connection') return 'Integration connection.';
  if (connectionScope.kind !== 'connection' || !connectionScope.requiresExplicitRepository) {
    return 'Declared targets.';
  }
  return 'Declared targets with `owner` and `repo`. Selected mode requires both. Without them, all mode uses the integration connection.';
}

function mcpTool(tool: McpToolLike): ToolReferenceTool {
  const resultSchema = object(object(tool.outputSchema.properties).result);
  const variants = schemaVariants(tool.inputSchema);
  const fields = variants ? [] : schemaFields(tool.inputSchema);
  const result = schemaFields(resultSchema);
  return {
    id: tool.name,
    anchor: slug(tool.name),
    description: tool.description,
    access: tool.annotations?.readOnlyHint === false ? 'write' : 'read',
    sensitive: false,
    permissions: [],
    selectors: [],
    input: fields,
    ...optional('inputVariants', variants),
    ...optional('inputAlternatives', variants ? undefined : schemaAlternatives(tool.inputSchema)),
    output: result,
    examples: mcpExamples({
      arguments: variants?.[0]?.fields ?? fields,
      result,
    }),
  };
}

function groupTitle(category: string): string {
  const words = category.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): {[K in Key]?: Value} {
  return value === undefined ? {} : ({[key]: value} as {[K in Key]: Value});
}
