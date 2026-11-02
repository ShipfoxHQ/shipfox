import {CONFIG_ROOT} from '@shipfox/api-integration-core-dto';
import type {ManagedRepository} from '@shipfox/api-integration-managed-vcs';
import {
  MANAGED_DEFAULT_BRANCH,
  MANAGED_VCS_PROVIDER,
} from '@shipfox/api-integration-managed-vcs-dto';
import {buildProviderRepositoryId} from '@shipfox/api-integration-spi';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {recordIntegrationConfigLink} from '#metrics/instance.js';
import type {IntegrationConnection} from './entities/connection.js';
import {
  ConfigLinkRefusedError,
  ConfigLinkUnconfirmedError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
} from './errors.js';
import type {ConfigProject} from './project-config-service.js';
import type {IntegrationProviderRegistry} from './providers/registry.js';
import type {
  ConfigPullRequest,
  RepositorySnapshot,
  SourceControlProvider,
} from './providers/source-control.js';
import type {IntegrationSourceControlService} from './source-control-service.js';

const PAGE_SIZE = 200;
const PULL_REQUEST_TITLE = 'Add Shipfox config';

export type ConfigPullRequestState = ConfigPullRequest['state'] | 'unknown';

export interface ConfigMove {
  status: 'linking' | 'linked';
  target: {connectionId: string; externalRepositoryId: string; fullName: string | null};
  startedBy: string | null;
  startedAt: string | null;
}

export interface ConfigMoveState {
  move: ConfigMove | null;
  pullRequest: {url: string; number: number; state: ConfigPullRequestState} | null;
}

export interface LinkConfigInput {
  actorId: string;
  connectionId: string;
  externalRepositoryId: string;
  dryRun: boolean;
}

export interface LinkConfigResult {
  status: 'ready' | 'linked';
  repository: RepositorySnapshot;
  fileCount: number;
  pullRequest: ConfigPullRequest | null;
}

export interface ConfigLinkService {
  /** The move and pull request a project's config page shows. Clears a merged pull request. */
  readMoveState(project: ConfigProject): Promise<ConfigMoveState>;
  link(project: ConfigProject, input: LinkConfigInput): Promise<LinkConfigResult>;
  /** Opens a new pull request after the current one closed, with a new attempt. */
  openNewPullRequest(project: ConfigProject): Promise<ConfigPullRequest>;
}

export interface CreateConfigLinkServiceOptions {
  registry: IntegrationProviderRegistry;
  sourceControl: IntegrationSourceControlService;
  projects: ProjectsModuleClient;
  /** The connection that holds the workspace's managed repositories. */
  getManagedConnection: (workspaceId: string) => Promise<IntegrationConnection | undefined>;
}

type ManagedStore = typeof import('@shipfox/api-integration-managed-vcs');
type TargetAdapter = Required<
  Pick<SourceControlProvider, 'openConfigPullRequest' | 'getConfigPullRequest'>
> &
  SourceControlProvider;

/** One branch per attempt, so a project can only ever find its own pull request. */
export function linkBranchName(attemptId: string): string {
  return `shipfox/link-config-${attemptId}`;
}

// A failure after which the provider may have done the work.
const UNKNOWN_OUTCOME_REASONS: ReadonlySet<string> = new Set([
  'timeout',
  'provider-unavailable',
  'malformed-provider-response',
]);

export function createConfigLinkService({
  registry,
  sourceControl,
  projects,
  getManagedConnection,
}: CreateConfigLinkServiceOptions): ConfigLinkService {
  async function managedStore(): Promise<ManagedStore> {
    return await import('@shipfox/api-integration-managed-vcs');
  }

  function targetAdapter(connection: IntegrationConnection): TargetAdapter {
    const adapter = registry.find(connection.provider)?.adapters.source_control;
    if (!adapter?.openConfigPullRequest || !adapter.getConfigPullRequest) {
      throw new ConfigLinkRefusedError(
        'link-unsupported',
        'This connection cannot receive a pull request yet',
      );
    }
    return adapter as TargetAdapter;
  }

  async function requireManagedRepository(
    project: ConfigProject,
    store: ManagedStore,
  ): Promise<ManagedRepository> {
    const repository = await store.getManagedRepositoryByProject({
      projectId: project.id,
      workspaceId: project.workspaceId,
    });
    if (!repository) {
      throw new ConfigLinkRefusedError(
        'project-not-managed',
        'Only a project whose config Shipfox hosts can move to a repository',
      );
    }
    return repository;
  }

  /** Every file under `.shipfox/` on the head of the managed `main`, read at one commit. */
  async function readManagedTree(params: {
    workspaceId: string;
    managedConnectionId: string;
    managedRepositoryId: string;
    withContent: boolean;
  }): Promise<{commit: string; files: Array<{path: string; content: string}>}> {
    const base = {
      workspaceId: params.workspaceId,
      connectionId: params.managedConnectionId,
      externalRepositoryId: params.managedRepositoryId,
    };
    const {commit} = await sourceControl.resolveSourceRef({
      ...base,
      ref: `refs/heads/${MANAGED_DEFAULT_BRANCH}`,
    });
    const paths: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await sourceControl.listFiles({
        ...base,
        ref: commit,
        prefix: `${CONFIG_ROOT}/`,
        limit: PAGE_SIZE,
        cursor,
      });
      paths.push(...page.files.filter((file) => file.type === 'file').map((file) => file.path));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const files: Array<{path: string; content: string}> = [];
    for (const path of paths) {
      const content = params.withContent
        ? (await sourceControl.fetchFile({...base, ref: commit, path})).content
        : '';
      files.push({path, content});
    }
    return {commit, files};
  }

  async function requireTargetConnection(
    project: ConfigProject,
    connectionId: string,
  ): Promise<{connection: IntegrationConnection; adapter: TargetAdapter}> {
    let connection: IntegrationConnection;
    try {
      connection = await sourceControl.getConnection(connectionId);
    } catch (error) {
      if (error instanceof IntegrationConnectionInactiveError) {
        throw new ConfigLinkRefusedError('connection-inactive', 'The connection is not active');
      }
      throw error;
    }
    if (connection.workspaceId !== project.workspaceId) {
      throw new IntegrationConnectionWorkspaceMismatchError(connection.id);
    }
    if (registry.find(connection.provider)?.internal) {
      throw new ConfigLinkRefusedError('link-unsupported', 'Pick a repository connection');
    }
    return {connection, adapter: targetAdapter(connection)};
  }

  async function checkTarget(
    project: ConfigProject,
    input: LinkConfigInput,
  ): Promise<{
    connection: IntegrationConnection;
    adapter: TargetAdapter;
    repository: RepositorySnapshot;
  }> {
    const {connection, adapter} = await requireTargetConnection(project, input.connectionId);
    const {repository} = await sourceControl.resolveRepository({
      workspaceId: project.workspaceId,
      connectionId: connection.id,
      externalRepositoryId: input.externalRepositoryId,
    });

    const {project: owner} = await projects.getProjectBySource({
      workspaceId: project.workspaceId,
      sourceConnectionId: connection.id,
      sourceExternalRepositoryId: repository.externalRepositoryId,
    });
    if (owner) {
      throw new ConfigLinkRefusedError(
        'repository-in-use',
        'Another project already uses this repository',
      );
    }

    const head = await resolveDefaultBranchHead({connection, adapter, repository});
    const existing = await adapter.listFiles({
      connection,
      externalRepositoryId: repository.externalRepositoryId,
      ref: head,
      prefix: `${CONFIG_ROOT}/`,
      limit: 1,
    });
    if (existing.files.length > 0) {
      throw new ConfigLinkRefusedError(
        'config-exists',
        `The repository already has a ${CONFIG_ROOT}/ directory on its default branch`,
      );
    }
    return {connection, adapter, repository};
  }

  async function resolveDefaultBranchHead(params: {
    connection: IntegrationConnection;
    adapter: TargetAdapter;
    repository: RepositorySnapshot;
  }): Promise<string> {
    try {
      const resolved = await params.adapter.resolveRef({
        connection: params.connection,
        externalRepositoryId: params.repository.externalRepositoryId,
        ref: `refs/heads/${params.repository.defaultBranch}`,
      });
      return resolved.commit;
    } catch (error) {
      if (!isEmptyRepositoryError(error)) throw error;
      throw new ConfigLinkRefusedError(
        'repository-empty',
        'The repository has no commits, so a pull request has no base',
      );
    }
  }

  async function openPullRequest(params: {
    project: ConfigProject;
    managedConnectionId: string;
    managedRepositoryId: string;
    attemptId: string;
    connection: IntegrationConnection;
    adapter: TargetAdapter;
    externalRepositoryId: string;
  }): Promise<{pullRequest: ConfigPullRequest | null; fileCount: number}> {
    const tree = await readManagedTree({
      workspaceId: params.project.workspaceId,
      managedConnectionId: params.managedConnectionId,
      managedRepositoryId: params.managedRepositoryId,
      withContent: true,
    });
    // An empty tree has nothing to review, and the move still binds the new source.
    if (tree.files.length === 0) return {pullRequest: null, fileCount: 0};

    const pullRequest = await params.adapter.openConfigPullRequest({
      connection: params.connection,
      externalRepositoryId: params.externalRepositoryId,
      branch: linkBranchName(params.attemptId),
      files: tree.files,
      title: PULL_REQUEST_TITLE,
      body: [
        `Adds the \`${CONFIG_ROOT}/\` directory of a Shipfox project, from its managed repository at commit \`${tree.commit}\`.`,
        'Merge this pull request to finish moving the project to this repository.',
      ].join('\n\n'),
    });
    return {pullRequest, fileCount: tree.files.length};
  }

  async function resolveTarget(
    project: ConfigProject,
    link: NonNullable<ManagedRepository['link']>,
  ) {
    const {connection, repository} = await sourceControl.resolveRepository({
      workspaceId: project.workspaceId,
      connectionId: link.connectionId,
      externalRepositoryId: link.externalRepositoryId,
    });
    return {connection, repository, adapter: targetAdapter(connection)};
  }

  /** Runs the steps after the repository went read-only. Every step is safe to repeat. */
  async function runMove(params: {
    project: ConfigProject;
    store: ManagedStore;
    repository: ManagedRepository;
    link: NonNullable<ManagedRepository['link']>;
    actorId: string;
  }): Promise<LinkConfigResult> {
    const {project, store, repository, link} = params;
    const target = await resolveTarget(project, link);
    const moved = hasMoved(project, link);

    let pullRequest: ConfigPullRequest | null = null;
    let fileCount = 0;
    if (!moved) {
      const opened = await openPullRequest({
        project,
        managedConnectionId: project.connectionId,
        managedRepositoryId: project.externalRepositoryId,
        attemptId: link.attemptId,
        connection: target.connection,
        adapter: target.adapter,
        externalRepositoryId: link.externalRepositoryId,
      });
      pullRequest = opened.pullRequest;
      fileCount = opened.fileCount;
      if (pullRequest?.state === 'closed') {
        throw new ConfigLinkRefusedError(
          'pull-request-closed',
          `Pull request #${pullRequest.number} was closed without merging. Start the move again.`,
        );
      }
      if (pullRequest) {
        await store.recordManagedLinkPullRequest({
          repositoryId: repository.id,
          attemptId: link.attemptId,
          url: pullRequest.url,
          number: pullRequest.number,
        });
      }
      await moveSource({project, link, target, actorId: link.startedBy ?? params.actorId});
    } else if (repository.pullRequest) {
      const state = await readPullRequestState(project, link);
      pullRequest = state === 'unknown' ? null : {...repository.pullRequest, state};
    }

    await store.completeManagedLink({repositoryId: repository.id, attemptId: link.attemptId});
    return {status: 'linked', repository: target.repository, fileCount, pullRequest};
  }

  async function moveSource(params: {
    project: ConfigProject;
    link: NonNullable<ManagedRepository['link']>;
    target: Awaited<ReturnType<typeof resolveTarget>>;
    actorId: string;
  }): Promise<void> {
    const {project, link, target} = params;
    try {
      await projects.moveProjectSource({
        projectId: project.id,
        workspaceId: project.workspaceId,
        actorId: params.actorId,
        from: {
          connectionId: project.connectionId,
          externalRepositoryId: project.externalRepositoryId,
        },
        to: {
          connectionId: link.connectionId,
          provider: target.connection.provider,
          externalRepositoryId: link.externalRepositoryId,
          owner: target.repository.owner,
          name: target.repository.name,
          defaultBranch: target.repository.defaultBranch,
        },
      });
    } catch (error) {
      const method = projectsInterModuleContract.methods.moveProjectSource;
      if (isInterModuleKnownError(method, error) && error.code === 'source-already-bound') {
        throw new ConfigLinkRefusedError(
          'source-already-bound',
          'Another project took this repository first. Close the pull request on the repository.',
        );
      }
      if (isInterModuleKnownError(method, error) && error.code === 'source-changed') {
        throw new ConfigLinkRefusedError(
          'source-changed',
          "The project's config source changed during the move",
        );
      }
      throw error;
    }
  }

  /** Releases the repository after a definite refusal. Any other failure keeps it read-only. */
  async function releaseOnRefusal<T>(
    params: {store: ManagedStore; repositoryId: string; attemptId: string; moved: boolean},
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      // After the source moved there is nothing to give back.
      if (!params.moved && isDefiniteRefusal(error)) {
        await params.store.releaseManagedLink({
          repositoryId: params.repositoryId,
          attemptId: params.attemptId,
        });
        recordIntegrationConfigLink('failed');
        throw error;
      }
      if (error instanceof ConfigLinkRefusedError || error instanceof ConfigLinkUnconfirmedError) {
        throw error;
      }
      recordIntegrationConfigLink('failed');
      if (error instanceof IntegrationProviderError) {
        throw new ConfigLinkUnconfirmedError({cause: error});
      }
      throw error;
    }
  }

  return {
    async readMoveState(project) {
      const store = await managedStore();
      const repository = await store.getManagedRepositoryByProject({
        projectId: project.id,
        workspaceId: project.workspaceId,
      });
      if (!repository || (repository.status === 'active' && !repository.pullRequest)) {
        return {move: null, pullRequest: null};
      }

      const move = await describeMove(project, repository);
      const {link, pullRequest} = repository;
      if (!pullRequest || !link) return {move, pullRequest: null};
      const state = await readPullRequestState(project, link);
      if (state === 'merged') {
        await store.clearManagedLinkPullRequest({
          repositoryId: repository.id,
          number: pullRequest.number,
        });
        return {move, pullRequest: null};
      }
      return {move, pullRequest: {...pullRequest, state}};
    },

    async link(project, input) {
      const store = await managedStore();
      const repository = await requireManagedRepository(project, store);
      if (repository.status === 'linked') {
        throw new ConfigLinkRefusedError('already-moved', 'This project already moved');
      }

      if (repository.status === 'linking') {
        if (input.dryRun) {
          throw new ConfigLinkRefusedError('move-in-progress', 'A move is already running');
        }
        return await resume({project, store, repository, actorId: input.actorId});
      }

      const checked = await checkTarget(project, input);
      if (input.dryRun) {
        const tree = await readManagedTree({
          workspaceId: project.workspaceId,
          managedConnectionId: project.connectionId,
          managedRepositoryId: project.externalRepositoryId,
          withContent: false,
        });
        return {
          status: 'ready',
          repository: checked.repository,
          fileCount: tree.files.length,
          pullRequest: null,
        };
      }

      const begun = await store.beginManagedLink({
        repositoryId: repository.id,
        attemptId: crypto.randomUUID(),
        connectionId: checked.connection.id,
        externalRepositoryId: checked.repository.externalRepositoryId,
        startedBy: input.actorId,
      });
      if (!begun || begun.kind === 'linked') {
        throw new ConfigLinkRefusedError('already-moved', 'This project already moved');
      }
      return await resume({
        project,
        store,
        repository: begun.repository,
        actorId: input.actorId,
      });
    },

    async openNewPullRequest(project) {
      const store = await managedStore();
      const repository = await requireManagedRepository(project, store);
      const link = repository.link;
      if (repository.status !== 'linked' || !link || !repository.pullRequest) {
        throw new ConfigLinkRefusedError(
          'no-pull-request',
          'This project has no pull request to replace',
        );
      }
      const state = await readPullRequestState(project, link);
      if (state === 'merged') {
        await store.clearManagedLinkPullRequest({
          repositoryId: repository.id,
          number: repository.pullRequest.number,
        });
      }
      if (state !== 'closed') {
        throw new ConfigLinkRefusedError(
          'pull-request-not-closed',
          `Pull request #${repository.pullRequest.number} is not closed`,
        );
      }

      const managedConnection = await getManagedConnection(project.workspaceId);
      if (!managedConnection) {
        throw new ConfigLinkRefusedError('project-not-managed', 'The managed repository is gone');
      }
      const target = await resolveTarget(project, link);
      const attemptId = crypto.randomUUID();
      const {pullRequest} = await openPullRequest({
        project,
        managedConnectionId: managedConnection.id,
        managedRepositoryId: buildProviderRepositoryId(MANAGED_VCS_PROVIDER, repository.id),
        attemptId,
        connection: target.connection,
        adapter: target.adapter,
        externalRepositoryId: link.externalRepositoryId,
      });
      if (!pullRequest) {
        throw new ConfigLinkRefusedError('no-pull-request', 'The managed config has no files');
      }
      const replaced = await store.replaceManagedLinkPullRequest({
        repositoryId: repository.id,
        expectedAttemptId: link.attemptId,
        attemptId,
        url: pullRequest.url,
        number: pullRequest.number,
      });
      if (!replaced) {
        throw new ConfigLinkRefusedError(
          'pull-request-not-closed',
          'Another member already opened a new pull request',
        );
      }
      return pullRequest;
    },
  };

  async function resume(params: {
    project: ConfigProject;
    store: ManagedStore;
    repository: ManagedRepository;
    actorId: string;
  }): Promise<LinkConfigResult> {
    const {link} = params.repository;
    if (!link) throw new Error('A move in progress has no stored target');
    const result = await releaseOnRefusal(
      {
        store: params.store,
        repositoryId: params.repository.id,
        attemptId: link.attemptId,
        moved: hasMoved(params.project, link),
      },
      async () => await runMove({...params, link}),
    );
    recordIntegrationConfigLink('completed');
    return result;
  }

  async function describeMove(
    project: ConfigProject,
    repository: ManagedRepository,
  ): Promise<ConfigMove | null> {
    const {link, status} = repository;
    if (status === 'active' || !link) return null;
    return {
      status,
      target: {
        connectionId: link.connectionId,
        externalRepositoryId: link.externalRepositoryId,
        fullName: status === 'linking' ? await readTargetName(project, link) : null,
      },
      startedBy: link.startedBy,
      startedAt: link.startedAt?.toISOString() ?? null,
    };
  }

  async function readTargetName(
    project: ConfigProject,
    link: NonNullable<ManagedRepository['link']>,
  ): Promise<string | null> {
    try {
      const {repository} = await sourceControl.resolveRepository({
        workspaceId: project.workspaceId,
        connectionId: link.connectionId,
        externalRepositoryId: link.externalRepositoryId,
      });
      return repository.fullName;
    } catch {
      return null;
    }
  }

  async function readPullRequestState(
    project: ConfigProject,
    link: NonNullable<ManagedRepository['link']>,
  ): Promise<ConfigPullRequestState> {
    try {
      const target = await resolveTarget(project, link);
      const pullRequest = await target.adapter.getConfigPullRequest({
        connection: target.connection,
        externalRepositoryId: link.externalRepositoryId,
        branch: linkBranchName(link.attemptId),
      });
      return pullRequest?.state ?? 'unknown';
    } catch (error) {
      logger().warn(
        {projectId: project.id, err: error},
        'Could not read the pull request of a config move',
      );
      return 'unknown';
    }
  }
}

function hasMoved(project: ConfigProject, link: NonNullable<ManagedRepository['link']>): boolean {
  return (
    project.connectionId === link.connectionId &&
    project.externalRepositoryId === link.externalRepositoryId
  );
}

function isEmptyRepositoryError(error: unknown): boolean {
  return (
    error instanceof IntegrationProviderError &&
    (error.reason === 'ref-not-found' ||
      (error.reason === 'provider-rejected' && error.status === 409))
  );
}

/** Whether the provider or a check answered no, so nothing happened and a retry is not needed. */
function isDefiniteRefusal(error: unknown): boolean {
  if (error instanceof ConfigLinkRefusedError) {
    return error.code === 'pull-request-closed' || error.code === 'source-already-bound';
  }
  if (error instanceof IntegrationProviderError) return !UNKNOWN_OUTCOME_REASONS.has(error.reason);
  return (
    error instanceof IntegrationConnectionInactiveError ||
    error instanceof IntegrationConnectionNotFoundError
  );
}
