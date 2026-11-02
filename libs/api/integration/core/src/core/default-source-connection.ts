import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {listIntegrationConnections} from '#db/connections.js';

/**
 * The workspace's only active source-control connection. Internal providers are left out, so a
 * managed project's hidden connection never counts. With none or several there is no answer.
 */
export async function findSoleSourceControlConnection(params: {
  workspaceId: string;
  registry: IntegrationProviderRegistry;
}): Promise<IntegrationConnection | undefined> {
  const providers = new Set(params.registry.list('source_control').map(({provider}) => provider));
  const connections = (await listIntegrationConnections({workspaceId: params.workspaceId})).filter(
    (connection) => connection.lifecycleStatus === 'active' && providers.has(connection.provider),
  );
  return connections.length === 1 ? connections[0] : undefined;
}

/**
 * The connection a workflow uses when it names none. A project bound to a repository uses its
 * source connection. A managed project has no repository to default to, so it uses the sole
 * source-control connection of its workspace.
 */
export async function resolveDefaultConnection(params: {
  sourceConnection: IntegrationConnection | undefined;
  registry: IntegrationProviderRegistry;
}): Promise<IntegrationConnection | undefined> {
  const {sourceConnection, registry} = params;
  if (sourceConnection === undefined) return undefined;
  if (!registry.find(sourceConnection.provider)?.internal) return sourceConnection;
  return await findSoleSourceControlConnection({
    workspaceId: sourceConnection.workspaceId,
    registry,
  });
}
