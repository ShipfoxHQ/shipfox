import {defaultConnectionId, type ProjectAccessPolicy} from '@shipfox/api-projects-dto';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {listIntegrationConnections} from '#db/connections.js';

/**
 * The workspace's active source-control connections. Internal providers are left out, so a
 * managed project's hidden connection never counts.
 */
export async function listActiveSourceControlConnections(params: {
  workspaceId: string;
  registry: IntegrationProviderRegistry;
}): Promise<IntegrationConnection[]> {
  const providers = new Set(params.registry.list('source_control').map(({provider}) => provider));
  const connections = await listIntegrationConnections({workspaceId: params.workspaceId});
  return connections.filter(
    (connection) => connection.lifecycleStatus === 'active' && providers.has(connection.provider),
  );
}

/** The workspace's only active source-control connection. With none or several there is no answer. */
export async function findSoleSourceControlConnection(params: {
  workspaceId: string;
  registry: IntegrationProviderRegistry;
}): Promise<IntegrationConnection | undefined> {
  const connections = await listActiveSourceControlConnections(params);
  return connections.length === 1 ? connections[0] : undefined;
}

/**
 * The connection a workflow uses when it names none. A project bound to a repository uses its
 * source connection. A managed project has no repository to default to, so it uses the one
 * source-control connection its access lists, or the workspace's only one when its access covers
 * all connections.
 */
export async function resolveDefaultConnection(params: {
  sourceConnection: IntegrationConnection | undefined;
  /** Read only for a managed project, which is the one that needs the policy. */
  loadPolicy: () => Promise<ProjectAccessPolicy>;
  registry: IntegrationProviderRegistry;
}): Promise<IntegrationConnection | undefined> {
  const {sourceConnection, loadPolicy, registry} = params;
  if (sourceConnection === undefined) return undefined;
  if (!registry.find(sourceConnection.provider)?.internal) return sourceConnection;
  const connections = await listActiveSourceControlConnections({
    workspaceId: sourceConnection.workspaceId,
    registry,
  });
  const connectionId = defaultConnectionId(await loadPolicy(), {
    sourceControlConnectionIds: connections.map(({id}) => id),
  });
  return connections.find(({id}) => id === connectionId);
}
