import {
  type AgentToolCatalogEntry,
  type AgentToolJsonSchema,
  type AgentToolSelectionCatalog,
  type AgentToolSelector,
  isSafeCheckoutRef,
} from '@shipfox/api-integration-spi';

export type AzureDevOpsAgentToolRequiredScope = 'read' | 'write';
export type AzureDevOpsAgentToolCatalogEntry =
  AgentToolCatalogEntry<AzureDevOpsAgentToolRequiredScope>;

interface AzureDevOpsAgentToolCatalogInput {
  id: string;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: AzureDevOpsAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
}

const NAME_MAX_LENGTH = 256;
const BRANCH_FIELDS = new Set(['source_branch', 'target_branch']);
const NAME_FIELDS = new Set(['project', 'repo']);

const projectSchema = {
  ...stringSchema('Project name within the connected Azure DevOps organization, such as Fabrikam'),
  maxLength: NAME_MAX_LENGTH,
};
const repoSchema = {
  ...stringSchema('Repository name within the project, such as platform'),
  maxLength: NAME_MAX_LENGTH,
};
const pullRequestIdSchema = integerSchema('Pull request id, such as 42');
const branchSchema = (description: string) => ({
  ...stringSchema(description),
  maxLength: NAME_MAX_LENGTH,
});

// Connections are organization-scoped: every call targets the connected organization, which the
// server takes from the connection. The organization is never a tool input.
export const azureDevOpsAgentToolCatalog = [
  tool({
    id: 'get_pull_request',
    description:
      'Read an Azure Repos pull request in the connected organization: title, description, status, draft flag, source and target branch, author, and web URL.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {project: projectSchema, repo: repoSchema, pull_request_id: pullRequestIdSchema},
      ['project', 'repo', 'pull_request_id'],
    ),
  }),
  tool({
    id: 'create_pull_request',
    description:
      'Open a pull request in an Azure Repos repository of the connected organization. It is a draft unless is_draft is false. Push the source branch first. Returns the pull request with its web URL.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        project: projectSchema,
        repo: repoSchema,
        source_branch: branchSchema('Branch with the changes, such as feat/ID-123-short-name'),
        target_branch: branchSchema('Branch to merge into, such as main'),
        title: {...stringSchema('Pull request title'), maxLength: 400},
        description: {
          ...stringSchema('Pull request description, written as Markdown'),
          maxLength: 4000,
        },
        is_draft: {type: 'boolean', description: 'Open as a draft. Defaults to true.'},
      },
      ['project', 'repo', 'source_branch', 'target_branch', 'title'],
    ),
  }),
  tool({
    id: 'comment_on_pull_request',
    description:
      'Add a comment to an Azure Repos pull request in the connected organization, as a new active thread. Returns the thread and comment ids.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        project: projectSchema,
        repo: repoSchema,
        pull_request_id: pullRequestIdSchema,
        content: {...stringSchema('Comment, written as Markdown'), maxLength: 12_000},
      },
      ['project', 'repo', 'pull_request_id', 'content'],
    ),
  }),
] as const satisfies readonly AzureDevOpsAgentToolCatalogEntry[];

export type AzureDevOpsAgentToolId = (typeof azureDevOpsAgentToolCatalog)[number]['id'];

export const azureDevOpsAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: azureDevOpsAgentToolCatalog.map(
    (entry): AgentToolSelector => ({
      token: entry.id,
      kind: 'standalone',
      sensitivity: entry.sensitivity,
      sensitive: entry.sensitive,
    }),
  ),
};

export function validateAzureDevOpsToolArguments(
  tool: AzureDevOpsAgentToolCatalogEntry,
  args: Record<string, unknown>,
): string | undefined {
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  for (const name of required) {
    if (typeof name === 'string' && args[name] === undefined) {
      return `Missing required parameter: ${name}`;
    }
  }
  const properties = tool.inputSchema.properties;
  if (!isRecord(properties)) return undefined;
  for (const [name, value] of Object.entries(args)) {
    const schema = properties[name];
    if (!isRecord(schema)) return `Unknown parameter: ${name}`;
    const invalid = validateArgument(name, value, schema);
    if (invalid !== undefined) return invalid;
  }
  return undefined;
}

function validateArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (schema.type === 'string') return validateStringArgument(name, value, schema);
  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      return `Parameter ${name} must be a positive integer`;
    }
    return undefined;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return `Parameter ${name} must be a boolean`;
  }
  return undefined;
}

function validateStringArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (typeof value !== 'string') return `Parameter ${name} must be a string`;
  // A description may be empty; every other string must say something.
  if (name !== 'description' && value.trim().length === 0) {
    return `Parameter ${name} must not be empty`;
  }
  if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) {
    return `Parameter ${name} must be at most ${schema.maxLength} characters`;
  }
  if (NAME_FIELDS.has(name) && !isSafeName(value)) {
    return `Parameter ${name} must be a single project or repository name`;
  }
  if (BRANCH_FIELDS.has(name) && !isSafeCheckoutRef(value)) {
    return `Parameter ${name} must be a valid branch name`;
  }
  return undefined;
}

export function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string') throw new TypeError(`Parameter ${name} must be a string`);
  return value;
}

export function integerArgument(args: Record<string, unknown>, name: string): number {
  const value = args[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Parameter ${name} must be a positive integer`);
  }
  return value;
}

function isSafeName(value: string): boolean {
  return value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');
}

function tool<const Entry extends AzureDevOpsAgentToolCatalogInput>(input: Entry): Entry {
  return input;
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

function stringSchema(description: string): AgentToolJsonSchema {
  return {type: 'string', description};
}

function integerSchema(description: string): AgentToolJsonSchema {
  return {type: 'integer', minimum: 1, description};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
