import type {IntegrationConnection} from './entities/connection.js';
import {
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
} from './errors.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';
import type {
  FilePage,
  FileSnapshot,
  RepositoryPage,
  RepositorySnapshot,
} from './providers/source-control.js';

export interface IntegrationSourceControlService {
  getConnection(connectionId: string): Promise<IntegrationConnection>;
  listRepositories(input: ListSourceRepositoriesInput): Promise<RepositoryPage>;
  resolveRepository(input: ResolveSourceRepositoryInput): Promise<ResolvedSourceRepository>;
  listFiles(input: ListSourceFilesInput): Promise<FilePage>;
  fetchFile(input: FetchSourceFileInput): Promise<FileSnapshot>;
}

export interface ListSourceRepositoriesInput {
  connection: IntegrationConnection;
  limit: number;
  cursor?: string | undefined;
  search?: string | undefined;
}

export interface ResolveSourceRepositoryInput {
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
}

export interface ListSourceFilesInput extends ResolveSourceRepositoryInput {
  ref: string;
  prefix: string;
  limit: number;
  cursor?: string | undefined;
}

export interface FetchSourceFileInput extends ResolveSourceRepositoryInput {
  ref: string;
  path: string;
}

export interface ResolvedSourceRepository {
  connection: IntegrationConnection;
  repository: RepositorySnapshot;
}

export interface CreateIntegrationSourceControlServiceOptions {
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: (
    connectionId: string,
  ) => Promise<IntegrationConnection | undefined>;
}

export function createSourceControlIntegrationService({
  registry,
  getIntegrationConnectionById,
}: CreateIntegrationSourceControlServiceOptions): IntegrationSourceControlService {
  async function getConnection(connectionId: string): Promise<IntegrationConnection> {
    const connection = await getIntegrationConnectionById(connectionId);
    if (!connection) throw new IntegrationConnectionNotFoundError(connectionId);
    if (connection.lifecycleStatus !== 'active') {
      throw new IntegrationConnectionInactiveError(connection.id);
    }

    return connection;
  }

  return {
    getConnection,

    async listRepositories({connection, limit, cursor, search}) {
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');
      return await sourceControl.listRepositories({
        connection,
        limit,
        cursor,
        search,
      });
    },

    async resolveRepository({workspaceId, connectionId, externalRepositoryId}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');

      const repository = await sourceControl.resolveRepository({
        connection,
        externalRepositoryId,
      });

      return {connection, repository};
    },

    async listFiles({workspaceId, connectionId, externalRepositoryId, ref, prefix, limit, cursor}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');

      return await sourceControl.listFiles({
        connection,
        externalRepositoryId,
        ref,
        prefix,
        limit,
        cursor,
      });
    },

    async fetchFile({workspaceId, connectionId, externalRepositoryId, ref, path}) {
      const connection = await getConnection(connectionId);
      if (connection.workspaceId !== workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(connectionId);
      }
      const sourceControl = registry.getAdapter(connection.provider, 'source_control');

      return await sourceControl.fetchFile({
        connection,
        externalRepositoryId,
        ref,
        path,
      });
    },
  };
}
