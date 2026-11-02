import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {IntegrationProviderError} from '#core/errors.js';
import type {ConfigProject} from '#core/project-config-service.js';
import type {IntegrationProvider} from '#index.js';

export const HEAD = 'a'.repeat(40);

export type PullRequestState = 'open' | 'merged' | 'closed';
interface FakePullRequest {
  url: string;
  number: number;
  state: PullRequestState;
}

/** A repository host that opens pull requests and can be told to fail. */
export function createFakeHost() {
  const pullRequests = new Map<string, FakePullRequest>();
  const opened: Array<{
    branch: string;
    files: ReadonlyArray<{path: string; content: string}>;
    body: string;
  }> = [];
  const host = {
    pullRequests,
    opened,
    existingFiles: [] as string[],
    empty: false,
    /** Fails after the pull request exists, like a lost response. */
    failAfterOpen: undefined as Error | undefined,
    failBeforeOpen: undefined as Error | undefined,
    openState: 'open' as PullRequestState,
    readError: undefined as Error | undefined,
    owner: 'acme',
    name: 'app',
    externalRepositoryId: 'gitea:acme/app',
  };
  const provider: IntegrationProvider = {
    provider: 'gitea',
    displayName: 'Gitea',
    adapters: {
      source_control: {
        listRepositories: () => Promise.resolve({repositories: [], nextCursor: null}),
        resolveRepository: ({externalRepositoryId}) =>
          Promise.resolve({
            externalRepositoryId,
            owner: host.owner,
            name: host.name,
            fullName: `${host.owner}/${host.name}`,
            defaultBranch: 'trunk',
            visibility: 'private',
            cloneUrl: 'https://gitea.local/acme/app.git',
            htmlUrl: 'https://gitea.local/acme/app',
          }),
        listFiles: () =>
          Promise.resolve({
            files: host.existingFiles.map((path) => ({path, type: 'file' as const, size: 1})),
            nextCursor: null,
          }),
        fetchFile: () => Promise.reject(new Error('not used')),
        resolveTriggerReference: () => null,
        resolveRef: ({ref}) => {
          if (host.empty) {
            return Promise.reject(new IntegrationProviderError('ref-not-found', 'No commits'));
          }
          return Promise.resolve({ref, commit: HEAD});
        },
        openConfigPullRequest: async ({branch, files, body}) => {
          await Promise.resolve();
          if (host.failBeforeOpen) throw host.failBeforeOpen;
          let pullRequest = pullRequests.get(branch);
          if (!pullRequest) {
            const number = pullRequests.size + 1;
            pullRequest = {
              url: `https://gitea.local/acme/app/pulls/${number}`,
              number,
              state: host.openState,
            };
            pullRequests.set(branch, pullRequest);
            opened.push({branch, files, body});
          }
          if (host.failAfterOpen) throw host.failAfterOpen;
          return pullRequest;
        },
        getConfigPullRequest: async ({branch}) => {
          await Promise.resolve();
          if (host.readError) throw host.readError;
          return pullRequests.get(branch) ?? null;
        },
      },
    },
  };
  return {host, provider};
}

/** Projects with a compare-and-set move and one project per source, like the real module. */
export function createFakeProjects(workspaceId: string) {
  const rows = new Map<string, ConfigProject>();
  const moves: string[] = [];
  const client = {
    getProjectById: ({projectId}: {projectId: string}) => {
      const project = rows.get(projectId);
      return Promise.resolve({
        project: project
          ? {
              id: project.id,
              workspaceId,
              sourceConnectionId: project.connectionId,
              sourceExternalRepositoryId: project.externalRepositoryId,
              sourceRepositoryOwner: project.owner,
              sourceRepositoryName: project.name,
              sourceDefaultBranch: project.defaultBranch,
              name: 'Project',
            }
          : null,
      });
    },
    getProjectBySource: ({
      sourceConnectionId,
      sourceExternalRepositoryId,
    }: {
      sourceConnectionId: string;
      sourceExternalRepositoryId: string;
    }) => {
      const project = [...rows.values()].find(
        (row) =>
          row.connectionId === sourceConnectionId &&
          row.externalRepositoryId === sourceExternalRepositoryId,
      );
      return Promise.resolve({
        project: project
          ? {
              id: project.id,
              workspaceId,
              sourceConnectionId,
              sourceExternalRepositoryId,
              name: 'Project',
            }
          : null,
      });
    },
    moveProjectSource: (input: Parameters<ProjectsModuleClient['moveProjectSource']>[0]) => {
      const method = projectsInterModuleContract.methods.moveProjectSource;
      const row = rows.get(input.projectId);
      if (!row)
        throw createInterModuleKnownError(method, 'project-not-found', {
          projectId: input.projectId,
        });
      if (
        row.connectionId === input.to.connectionId &&
        row.externalRepositoryId === input.to.externalRepositoryId
      ) {
        return Promise.resolve({moved: false});
      }
      if (
        row.connectionId !== input.from.connectionId ||
        row.externalRepositoryId !== input.from.externalRepositoryId
      ) {
        throw createInterModuleKnownError(method, 'source-changed', {projectId: input.projectId});
      }
      const owner = [...rows.values()].find(
        (other) =>
          other.connectionId === input.to.connectionId &&
          other.externalRepositoryId === input.to.externalRepositoryId,
      );
      if (owner) {
        throw createInterModuleKnownError(method, 'source-already-bound', {
          existingProjectId: owner.id,
        });
      }
      rows.set(input.projectId, {
        ...row,
        connectionId: input.to.connectionId,
        externalRepositoryId: input.to.externalRepositoryId,
        owner: input.to.owner,
        name: input.to.name,
        defaultBranch: input.to.defaultBranch,
      });
      moves.push(input.projectId);
      return Promise.resolve({moved: true});
    },
  };
  return {rows, moves, client};
}
