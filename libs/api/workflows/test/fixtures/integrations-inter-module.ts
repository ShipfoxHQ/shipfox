import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError, isInterModuleKnownError} from '@shipfox/inter-module';
import type {AgentToolMaterializationContext} from '#core/agent-tools.js';
import {loadAgentToolMaterializationContext} from '#core/agent-tools.js';

type AgentToolsContext = Awaited<ReturnType<IntegrationsModuleClient['getAgentToolsContext']>>;
type ResolveAgentTools = IntegrationsModuleClient['resolveAgentTools'];
type ResolveAgentToolsBatch = IntegrationsModuleClient['resolveAgentToolsBatch'];
type CatalogTool = AgentToolsContext['catalogs'][number]['tools'][number];

const method = integrationsInterModuleContract.methods.resolveAgentTools;

function invalid(
  integrationIndex: number,
  message: string,
  details: {
    reason?:
      | 'connection-missing'
      | 'connection-provider-mismatch'
      | 'source-connection-missing'
      | 'tool-unknown'
      | 'no-tools-selected';
    connection?: string;
    tool?: string;
  },
) {
  return createInterModuleKnownError(method, 'selection-invalid', {
    integrationIndex,
    message,
    ...details,
  });
}

type Selection = Parameters<ResolveAgentTools>[0]['integrations'][number];
type FakeContext = Pick<
  AgentToolsContext,
  'catalogs' | 'workspaceConnections' | 'defaultConnection'
>;
type Connection = NonNullable<FakeContext['defaultConnection']>;

function findConnection(context: FakeContext, selection: Selection, index: number): Connection {
  const connection =
    selection.connection === undefined
      ? context.defaultConnection
      : context.workspaceConnections.find(({slug}) => slug === selection.connection);
  if (connection === null || connection === undefined) {
    throw invalid(index, `Integration connection ${selection.connection} was not found`, {
      reason:
        selection.connection === undefined ? 'source-connection-missing' : 'connection-missing',
      ...(selection.connection === undefined ? {} : {connection: selection.connection}),
    });
  }
  if (selection.provider !== undefined && selection.provider !== connection.provider) {
    throw invalid(index, 'Provider mismatch', {
      reason: 'connection-provider-mismatch',
      connection: connection.slug,
    });
  }
  return connection;
}

/** Which methods of each tool a selection picks: `all`, or the named ones. */
function pickTools(params: {
  catalog: readonly CatalogTool[];
  selection: Selection;
  connection: Connection;
  index: number;
}): Map<string, Set<string> | 'all'> {
  const picked = new Map<string, Set<string> | 'all'>();
  for (const token of params.selection.include) {
    const [family = '', methodId] = token.split('.');
    const entry = params.catalog.find((candidate) => candidate.id === family);
    if (entry === undefined) {
      throw invalid(params.index, `Unknown integration tool: ${token}`, {
        reason: 'tool-unknown',
        connection: params.connection.slug,
        tool: token,
      });
    }
    const current = picked.get(entry.id);
    if (methodId === undefined || methodId === '*') picked.set(entry.id, 'all');
    else if (current !== 'all') picked.set(entry.id, new Set([...(current ?? []), methodId]));
  }
  for (const token of params.selection.exclude ?? []) excludeToken(params.catalog, picked, token);
  return picked;
}

function excludeToken(
  catalog: readonly CatalogTool[],
  picked: Map<string, Set<string> | 'all'>,
  token: string,
): void {
  const [family = '', methodId] = token.split('.');
  const current = picked.get(family);
  if (current === undefined) return;
  if (methodId === undefined || methodId === '*') {
    picked.delete(family);
    return;
  }
  const methods = catalog.find((entry) => entry.id === family)?.methods ?? [];
  const remaining = new Set(current === 'all' ? methods.map((method) => method.id) : [...current]);
  remaining.delete(methodId);
  picked.set(family, remaining);
}

function methodsSensitivity(writes: boolean | undefined): 'read' | 'write' {
  return writes ? 'write' : 'read';
}

function grantTool(entry: CatalogTool, selected: Set<string> | 'all') {
  const methods = entry.methods
    ?.filter((candidate) => selected === 'all' || selected.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      token: `${entry.id}.${candidate.id}`,
      description: candidate.description,
      sensitivity: candidate.sensitivity,
      sensitive: candidate.sensitive,
      requiredScope: [candidate.requiredScope].flat(),
    }));
  const writes = methods?.some((candidate) => candidate.sensitivity === 'write');
  return {
    id: entry.id,
    description: entry.description,
    sensitivity: methods === undefined ? entry.sensitivity : methodsSensitivity(writes),
    sensitive: methods?.some((candidate) => candidate.sensitive) ?? entry.sensitive,
    requiredScope: mergeScopes(
      methods?.map((candidate) => candidate.requiredScope) ?? [[entry.requiredScope].flat()],
    ),
    inputSchema: entry.inputSchema,
    ...(entry.outputSchema === undefined ? {} : {outputSchema: entry.outputSchema}),
    result: entry.result,
    ...(methods === undefined ? {} : {methods}),
  };
}

/**
 * A stand-in for Integrations' `resolveAgentTools` that grants whole tools or `family.method`
 * tokens by id. Selector semantics are Integrations' own and are tested there. Workflows tests
 * only need grants and refusals that have the contract's shape.
 */
export function fakeResolveAgentTools(context: FakeContext): ResolveAgentTools {
  return ((input) => {
    const integrations = input.integrations.map((selection, index) => {
      const connection = findConnection(context, selection, index);
      const catalog: CatalogTool[] =
        context.catalogs.find(({provider}) => provider === connection.provider)?.tools ?? [];
      const picked = pickTools({catalog, selection, connection, index});
      const tools = catalog.flatMap((entry) => {
        const selected = picked.get(entry.id);
        return selected === undefined ? [] : grantTool(entry, selected);
      });
      if (tools.length === 0) {
        throw invalid(index, 'Agent integration selection resolved to no tools', {
          reason: 'no-tools-selected',
          connection: connection.slug,
        });
      }
      return {
        connectionId: connection.id,
        connectionSlug: connection.slug,
        provider: connection.provider,
        requiredScope: mergeScopes(tools.map((tool) => tool.requiredScope)),
        tools,
      };
    });
    return Promise.resolve({integrations});
  }) as ResolveAgentTools;
}

/**
 * The batch form of {@link fakeResolveAgentTools}: each request is granted or refused on its own,
 * as Integrations answers it.
 */
export function fakeResolveAgentToolsBatch(context: FakeContext): ResolveAgentToolsBatch {
  const resolve = fakeResolveAgentTools(context);
  return (async (input) => {
    const outcomes = await Promise.all(
      input.requests.map(async ({integrations}) => {
        try {
          const granted = await resolve({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            integrations,
          });
          return {kind: 'granted' as const, integrations: granted.integrations};
        } catch (error) {
          if (!isInterModuleKnownError(method, error) || error.code !== 'selection-invalid') {
            throw error;
          }
          return {kind: 'refused' as const, refusal: error.details};
        }
      }),
    );
    return {outcomes};
  }) as ResolveAgentToolsBatch;
}

/** The Integrations output shape of a hand-built materialization context. */
export function toAgentToolsContext(context: AgentToolMaterializationContext): AgentToolsContext {
  return {
    selectionCatalogs: [],
    catalogs: [...context.catalogs].map(([provider, tools]) => ({provider, tools})),
    workspaceConnections: [...context.workspaceConnectionSnapshot].map(([slug, connection]) => ({
      slug,
      ...connection,
      capabilities: [...connection.capabilities],
    })),
    eventCatalogs: [],
    fixedEventProviders: [],
    defaultConnection: context.defaultConnection,
  } as unknown as AgentToolsContext;
}

/**
 * Gives a hand-built context the integration outcomes that run creation loads for `model`, so a
 * test materializes through the same path as production.
 */
export async function withIntegrationOutcomes(
  model: WorkflowModel,
  context: AgentToolMaterializationContext,
): Promise<AgentToolMaterializationContext> {
  const agentTools = toAgentToolsContext(context);
  const loaded = await loadAgentToolMaterializationContext({
    model,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    integrations: {
      getAgentToolsContext: () => Promise.resolve(agentTools),
      resolveAgentToolsBatch: fakeResolveAgentToolsBatch(agentTools),
    } as unknown as IntegrationsModuleClient,
    projects: {
      getProjectById: () =>
        Promise.resolve({
          project: {sourceConnectionId: 'source', sourceExternalRepositoryId: 'acme/api'},
        }),
    } as never,
  });
  return {...context, integrationOutcomes: loaded?.integrationOutcomes};
}

function mergeScopes(scopes: readonly unknown[][]): unknown[] {
  const items = scopes.flat();
  const permissions = items.filter(
    (item): item is {permission: string; access: 'read' | 'write'} =>
      typeof item === 'object' && item !== null && 'permission' in item,
  );
  if (permissions.length > 0 && permissions.length === items.length) {
    const byPermission = new Map<string, 'read' | 'write'>();
    for (const item of permissions) {
      if (byPermission.get(item.permission) !== 'write') {
        byPermission.set(item.permission, item.access);
      }
    }
    return [...byPermission].map(([permission, access]) => ({permission, access}));
  }
  return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
}
