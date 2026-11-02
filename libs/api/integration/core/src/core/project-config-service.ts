import {CONFIG_ROOT} from '@shipfox/api-integration-core-dto';
import {isManagedRepositoryId} from '@shipfox/api-integration-managed-vcs-dto';
import {isValidGitObjectId} from '@shipfox/api-integration-spi';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import type {ConfigMoveState} from './config-link-service.js';
import type {IntegrationConnection} from './entities/connection.js';
import {
  ConfigRepositoryReadOnlyError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationHistoryUnsupportedError,
  IntegrationProviderError,
  IntegrationProviderUnavailableError,
} from './errors.js';
import {commitManagedProjectChanges} from './managed-repositories.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';
import type {CommitPage, FilePage} from './providers/source-control.js';
import type {IntegrationSourceControlService} from './source-control-service.js';

export type ConfigSourceKind = 'managed' | 'linked';

/** The project row's view of where its config lives. */
export interface ConfigProject {
  id: string;
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
  owner: string | null;
  name: string | null;
  defaultBranch: string | null;
}

export interface ConfigSource {
  source: {
    kind: ConfigSourceKind;
    provider: string;
    connectionId: string;
    externalRepositoryId: string;
    owner: string | null;
    name: string | null;
    defaultBranch: string;
  };
  head: {ref: string; commit: string} | null;
  historySupported: boolean;
  move: ConfigMoveState['move'];
  pullRequest: ConfigMoveState['pullRequest'];
}

export interface ListConfigFilesInput {
  ref?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface ReadConfigFileInput {
  path: string;
  ref?: string | undefined;
}

export interface ListConfigCommitsInput {
  path: string;
  ref?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}

export interface CommitConfigChangesInput {
  branch: string;
  expectedHead?: string | undefined;
  message: string;
  changes: ReadonlyArray<{path: string; content: string | null}>;
  actor: {id: string; name: string};
}

export interface ProjectConfigService {
  getConfigSource(project: ConfigProject): Promise<ConfigSource>;
  listConfigFiles(
    project: ConfigProject,
    input: ListConfigFilesInput,
  ): Promise<FilePage & {commit: string}>;
  readConfigFile(
    project: ConfigProject,
    input: ReadConfigFileInput,
  ): Promise<{path: string; commit: string; content: string}>;
  listConfigCommits(
    project: ConfigProject,
    input: ListConfigCommitsInput,
  ): Promise<CommitPage & {commit: string}>;
  commitConfigChanges(
    project: ConfigProject,
    input: CommitConfigChangesInput,
  ): Promise<{branch: string; commit: string; parent: string}>;
}

export function toConfigProject(
  project: Awaited<ReturnType<ProjectsModuleClient['getProjectById']>>['project'] & {},
): ConfigProject {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    connectionId: project.sourceConnectionId,
    externalRepositoryId: project.sourceExternalRepositoryId,
    owner: project.sourceRepositoryOwner ?? null,
    name: project.sourceRepositoryName ?? null,
    defaultBranch: project.sourceDefaultBranch ?? null,
  };
}

export interface CreateProjectConfigServiceOptions {
  registry: IntegrationProviderRegistry;
  sourceControl: IntegrationSourceControlService;
  getIntegrationConnectionById: (
    connectionId: string,
  ) => Promise<IntegrationConnection | undefined>;
  /** Without it, a project reports no move. */
  readMoveState?: ((project: ConfigProject) => Promise<ConfigMoveState>) | undefined;
}

export function createProjectConfigService({
  registry,
  sourceControl,
  getIntegrationConnectionById,
  readMoveState,
}: CreateProjectConfigServiceOptions): ProjectConfigService {
  async function loadConnection(project: ConfigProject): Promise<IntegrationConnection> {
    const connection = await getIntegrationConnectionById(project.connectionId);
    if (!connection) throw new IntegrationConnectionNotFoundError(project.connectionId);
    if (connection.workspaceId !== project.workspaceId) {
      throw new IntegrationConnectionWorkspaceMismatchError(project.connectionId);
    }
    return connection;
  }

  async function resolveDefaultBranch(project: ConfigProject): Promise<string> {
    if (project.defaultBranch !== null) return project.defaultBranch;
    // Rows written before the default branch was stored.
    const {repository} = await sourceControl.resolveRepository({
      workspaceId: project.workspaceId,
      connectionId: project.connectionId,
      externalRepositoryId: project.externalRepositoryId,
    });
    return repository.defaultBranch;
  }

  /** Pins the ref to a commit, so every page of one view reads the same tree. */
  async function resolveCommit(
    project: ConfigProject,
    ref: string | undefined,
  ): Promise<{ref: string; commit: string}> {
    if (ref !== undefined && isValidGitObjectId(ref)) return {ref, commit: ref};
    const resolved = await sourceControl.resolveSourceRef({
      workspaceId: project.workspaceId,
      connectionId: project.connectionId,
      externalRepositoryId: project.externalRepositoryId,
      ref: ref ?? `refs/heads/${await resolveDefaultBranch(project)}`,
    });
    return {ref: resolved.ref, commit: resolved.commit};
  }

  return {
    async getConfigSource(project) {
      const connection = await loadConnection(project);
      const defaultBranch = await resolveDefaultBranch(project);
      // An unregistered provider must not hide the project row's source.
      const adapter = registry
        .list('source_control')
        .find(({provider}) => provider === connection.provider)?.adapters.source_control;

      return {
        source: {
          kind: isManagedRepositoryId(project.externalRepositoryId) ? 'managed' : 'linked',
          provider: connection.provider,
          connectionId: connection.id,
          externalRepositoryId: project.externalRepositoryId,
          owner: project.owner,
          name: project.name,
          defaultBranch,
        },
        head: await resolveHead({project, resolveCommit}),
        historySupported: adapter?.listCommits !== undefined,
        ...((await readMoveState?.(project)) ?? {move: null, pullRequest: null}),
      };
    },

    async listConfigFiles(project, {ref, limit, cursor}) {
      const {commit} = await resolveCommit(project, ref);
      const page = await sourceControl.listFiles({
        workspaceId: project.workspaceId,
        connectionId: project.connectionId,
        externalRepositoryId: project.externalRepositoryId,
        ref: commit,
        prefix: `${CONFIG_ROOT}/`,
        limit,
        cursor,
      });
      return {...page, commit};
    },

    async readConfigFile(project, {path, ref}) {
      const {commit} = await resolveCommit(project, ref);
      const file = await sourceControl.fetchFile({
        workspaceId: project.workspaceId,
        connectionId: project.connectionId,
        externalRepositoryId: project.externalRepositoryId,
        ref: commit,
        path,
      });
      return {path: file.path, commit, content: file.content};
    },

    async listConfigCommits(project, {path, ref, limit, cursor}) {
      const connection = await sourceControl.getConnection(project.connectionId);
      if (connection.workspaceId !== project.workspaceId) {
        throw new IntegrationConnectionWorkspaceMismatchError(project.connectionId);
      }
      const adapter = registry.getAdapter(connection.provider, 'source_control');
      if (!adapter.listCommits) throw new IntegrationHistoryUnsupportedError(connection.provider);

      const {commit} = await resolveCommit(project, ref);
      const page = await adapter.listCommits({
        connection,
        externalRepositoryId: project.externalRepositoryId,
        ref: commit,
        path,
        limit,
        cursor,
      });
      return {...page, commit};
    },

    async commitConfigChanges(project, input) {
      if (!isManagedRepositoryId(project.externalRepositoryId)) {
        const repository =
          project.owner !== null && project.name !== null
            ? `${project.owner}/${project.name}`
            : project.externalRepositoryId;
        throw new ConfigRepositoryReadOnlyError(repository);
      }
      return await commitManagedProjectChanges({
        workspaceId: project.workspaceId,
        externalRepositoryId: project.externalRepositoryId,
        ...input,
      });
    },
  };
}

/** The header must render during a provider outage, so a failed head read is a null head. */
async function resolveHead(params: {
  project: ConfigProject;
  resolveCommit: (
    project: ConfigProject,
    ref: string | undefined,
  ) => Promise<{ref: string; commit: string}>;
}): Promise<{ref: string; commit: string} | null> {
  try {
    return await params.resolveCommit(params.project, undefined);
  } catch (error) {
    if (
      error instanceof IntegrationProviderError ||
      error instanceof IntegrationConnectionInactiveError ||
      error instanceof IntegrationProviderUnavailableError
    ) {
      logger().warn(
        {projectId: params.project.id, err: error},
        'Could not read the head of a project config source',
      );
      return null;
    }
    throw error;
  }
}
