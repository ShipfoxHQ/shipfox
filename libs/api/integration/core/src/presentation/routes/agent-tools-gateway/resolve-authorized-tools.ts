import {
  type MaterializedAgentIntegrationConfigDto,
  type MaterializedAgentIntegrationToolConfigDto,
  materializedAgentStepConfigSchema,
} from '@shipfox/api-agent-dto';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {ClientError} from '@shipfox/node-fastify';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationProviderKind} from '#core/entities/provider.js';
import type {AgentToolCatalogEntry, AgentToolJsonSchema} from '#core/providers/agent-tools.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {GetIntegrationConnectionByIdFn} from '#db/connections.js';

export type LeasedAgentStepLoader = (params: {
  request: object;
  stepId: string;
  attempt: number;
}) => Promise<{
  step: {type: string; config: Record<string, unknown>};
  workspaceId: string;
}>;

export interface AuthorizedIntegrationTool {
  mcpName: string;
  integration: MaterializedAgentIntegrationConfigDto;
  tool: MaterializedAgentIntegrationToolConfigDto;
  connection: IntegrationConnection;
  description: string;
  inputSchema: AgentToolJsonSchema;
  outputSchema?: AgentToolJsonSchema | undefined;
}

export type AuthorizedIntegrationToolMap = Map<string, AuthorizedIntegrationTool>;

export interface ResolveAuthorizedToolsParams {
  request: object;
  loadLeasedAgentStep: LeasedAgentStepLoader;
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export async function resolveAuthorizedIntegrationTools(
  params: ResolveAuthorizedToolsParams,
): Promise<AuthorizedIntegrationToolMap> {
  const leasedJob = requireLeasedJobContext(params.request);
  if (!leasedJob.currentStepId || leasedJob.currentStepAttempt === undefined) {
    throw new ClientError('Lease does not identify a current step', 'lease-missing-step', {
      status: 409,
    });
  }

  const {step, workspaceId} = await params.loadLeasedAgentStep({
    request: params.request,
    stepId: leasedJob.currentStepId,
    attempt: leasedJob.currentStepAttempt,
  });
  if (step.type !== 'agent') {
    throw new ClientError('Current leased step is not an agent step', 'leased-step-not-agent', {
      status: 409,
    });
  }

  const integrations = parseAgentIntegrations(step.config);
  const authorizedTools: AuthorizedIntegrationToolMap = new Map();

  for (const integration of integrations) {
    const connection = await loadAuthorizedConnection({
      integration,
      workspaceId,
      registry: params.registry,
      getIntegrationConnectionById: params.getIntegrationConnectionById,
    });
    const catalog = await params.registry.getAdapter(integration.provider, 'agent_tools').catalog();
    const catalogByToolId = new Map(catalog.map((entry) => [entry.id, entry]));

    for (const tool of integration.tools) {
      const catalogTool = catalogByToolId.get(tool.id);
      const mcpName = mcpToolName(integration.connectionSlug, tool.id);
      if (authorizedTools.has(mcpName)) {
        throw new ClientError(
          'Integration tool names collide after MCP namespacing',
          'integration-tool-name-collision',
          {
            status: 409,
          },
        );
      }

      authorizedTools.set(mcpName, {
        mcpName,
        integration,
        tool,
        connection,
        // The live catalog enriches display metadata only. Frozen step config remains the allowlist.
        description: catalogTool?.description ?? tool.id,
        inputSchema: tool.methods ? toolInputSchema(tool, catalogTool) : tool.inputSchema,
        outputSchema: tool.outputSchema ?? catalogTool?.outputSchema,
      });
    }
  }

  return authorizedTools;
}

export function sanitizeSlug(slug: string): string {
  return slug.replaceAll('-', '_');
}

export function mcpToolName(connectionSlug: string, toolId: string): string {
  return `${sanitizeSlug(connectionSlug)}__${toolId}`;
}

export function narrowMethodEnum(
  inputSchema: AgentToolJsonSchema,
  authorizedMethods: readonly string[],
  methodDescriptions: ReadonlyMap<string, string> = new Map(),
): AgentToolJsonSchema {
  const schema = cloneSchema(inputSchema);
  const methodSchema = getObjectProperty(schema, 'method');
  if (methodSchema) {
    narrowEnumOrConst(methodSchema, authorizedMethods);
  }

  const oneOf = schema.oneOf;
  if (Array.isArray(oneOf)) {
    schema.oneOf = oneOf.filter((entry) => {
      if (!isRecord(entry)) return true;
      const entryMethod = getObjectProperty(entry, 'method');
      if (!entryMethod) return true;
      const methodConst = entryMethod?.const;
      if (typeof methodConst !== 'string') return true;
      if (!authorizedMethods.includes(methodConst)) return false;

      const description = methodDescriptions.get(methodConst);
      if (description) entryMethod.description = description;
      return true;
    });
  } else if (methodDescriptions.size > 0) {
    schema.oneOf = authorizedMethods.map((method) => ({
      properties: {
        method: {
          const: method,
          description: methodDescriptions.get(method) ?? method,
        },
      },
    }));
  }

  return schema;
}

function toolInputSchema(
  tool: MaterializedAgentIntegrationToolConfigDto,
  catalogTool: AgentToolCatalogEntry | undefined,
): AgentToolJsonSchema {
  const authorizedMethods = tool.methods?.map((method) => method.id) ?? [];
  const methodDescriptions = new Map(
    catalogTool?.methods?.map((method) => [method.id, method.description]) ?? [],
  );
  return narrowMethodEnum(tool.inputSchema, authorizedMethods, methodDescriptions);
}

function parseAgentIntegrations(
  config: Record<string, unknown>,
): MaterializedAgentIntegrationConfigDto[] {
  try {
    return materializedAgentStepConfigSchema.parse(config).integrations ?? [];
  } catch (error) {
    throw new ClientError('Agent step config is invalid', 'agent-step-config-invalid', {
      status: 409,
      cause: error,
    });
  }
}

async function loadAuthorizedConnection(params: {
  integration: MaterializedAgentIntegrationConfigDto;
  workspaceId: string;
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}): Promise<IntegrationConnection> {
  const connection = await params.getIntegrationConnectionById(params.integration.connectionId);
  if (!connection) {
    throw new ClientError(
      'Integration connection is no longer available',
      'integration-tool-connection-unavailable',
      {
        status: 409,
      },
    );
  }
  if (connection.workspaceId !== params.workspaceId) {
    throw new ClientError(
      'Integration connection does not belong to the leased workspace',
      'integration-tool-connection-unavailable',
      {
        status: 409,
      },
    );
  }
  if (connection.lifecycleStatus !== 'active') {
    throw new ClientError(
      'Integration connection is not active',
      'integration-tool-connection-unavailable',
      {
        status: 409,
      },
    );
  }
  if (connection.provider !== params.integration.provider) {
    throw new ClientError(
      'Integration connection provider changed',
      'integration-tool-connection-unavailable',
      {
        status: 409,
      },
    );
  }
  if (!providerSupportsAgentTools(params.registry, params.integration.provider)) {
    throw new ClientError(
      'Integration provider no longer exposes agent tools',
      'integration-tool-connection-unavailable',
      {
        status: 409,
      },
    );
  }

  return connection;
}

function providerSupportsAgentTools(
  registry: IntegrationProviderRegistry,
  provider: IntegrationProviderKind,
): boolean {
  try {
    return registry.get(provider).capabilities.includes('agent_tools');
  } catch {
    return false;
  }
}

function cloneSchema(schema: AgentToolJsonSchema): AgentToolJsonSchema {
  return structuredClone(schema);
}

function getObjectProperty(
  schema: AgentToolJsonSchema,
  property: string,
): AgentToolJsonSchema | null {
  const properties = schema.properties;
  if (!isRecord(properties)) return null;
  const value = properties[property];
  return isRecord(value) ? value : null;
}

function narrowEnumOrConst(
  schema: AgentToolJsonSchema,
  authorizedMethods: readonly string[],
): void {
  if (Array.isArray(schema.enum)) {
    schema.enum = schema.enum.filter(
      (value): value is string => typeof value === 'string' && authorizedMethods.includes(value),
    );
  }
  if (typeof schema.const === 'string' && !authorizedMethods.includes(schema.const)) {
    delete schema.const;
  }
}

function isRecord(value: unknown): value is AgentToolJsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
