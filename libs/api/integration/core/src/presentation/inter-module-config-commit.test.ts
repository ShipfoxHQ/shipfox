import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {ManagedSourceControlProvider} from '@shipfox/api-integration-managed-vcs';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {createManagedProjectRepository} from '#core/managed-repositories.js';
import {createProjectConfigService} from '#core/project-config-service.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
import {getIntegrationConnectionById} from '#db/connections.js';
import {createIntegrationsInterModulePresentation} from './inter-module.js';

const WORKFLOW = '.shipfox/workflows/triage.yml';
const PROMPT = '.shipfox/prompts/triage.md';
const actor = {id: crypto.randomUUID(), name: 'Ada'};
const method = integrationsInterModuleContract.methods.commitConfigChanges;

function projectsClient(project: Record<string, unknown>): ProjectsModuleClient {
  return {
    getProjectById: async ({projectId}: {projectId: string}) => {
      await Promise.resolve();
      return {project: projectId === project.id ? project : null};
    },
  } as unknown as ProjectsModuleClient;
}

function createClient(projects: ProjectsModuleClient) {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(integrationsInterModuleContract);
  const registry = createIntegrationProviderRegistry([]);
  const sourceControl = createSourceControlIntegrationService({
    registry,
    getIntegrationConnectionById,
  });
  transport.register(
    createIntegrationsInterModulePresentation({
      registry,
      sourceControl,
      projects,
      projectConfig: createProjectConfigService({
        registry,
        sourceControl,
        getIntegrationConnectionById,
      }),
      getIntegrationConnectionById,
    }),
  );
  transport.seal();
  return client;
}

async function createManagedProject() {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const repository = await createManagedProjectRepository({
    workspaceId,
    projectId,
    files: [{path: WORKFLOW, content: 'name: Triage\n'}],
  });
  const client = createClient(
    projectsClient({
      id: projectId,
      workspaceId,
      sourceConnectionId: repository.connectionId,
      sourceExternalRepositoryId: repository.externalRepositoryId,
      sourceDefaultBranch: 'main',
    }),
  );
  return {client, workspaceId, projectId, ...repository};
}

type ManagedProject = Awaited<ReturnType<typeof createManagedProject>>;

function commit(project: ManagedProject, overrides: Partial<Parameters<typeof baseInput>[1]> = {}) {
  return project.client.commitConfigChanges(baseInput(project, overrides));
}

function baseInput(
  project: Pick<ManagedProject, 'workspaceId' | 'projectId'>,
  overrides: {
    branch?: string;
    expectedHead?: string;
    changes?: Array<{path: string; content: string | null}>;
  },
) {
  return {
    workspaceId: project.workspaceId,
    projectId: project.projectId,
    branch: 'shipfox/add-prompt',
    message: 'Add a prompt',
    changes: [{path: PROMPT, content: 'Triage it.\n'}],
    actor,
    ...overrides,
  };
}

async function knownError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (isInterModuleKnownError(method, error)) return {code: error.code, details: error.details};
  throw error ?? new Error('The call did not fail');
}

describe('integrations inter-module config commits', () => {
  it('commits to a new branch of a managed project, and the files read back', async () => {
    const project = await createManagedProject();

    const result = await commit(project);

    expect(result.branch).toBe('shipfox/add-prompt');
    const file = await new ManagedSourceControlProvider().fetchFile({
      connection: (await getIntegrationConnectionById(project.connectionId)) as never,
      externalRepositoryId: project.externalRepositoryId,
      ref: result.commit,
      path: PROMPT,
    });
    expect(file.content).toBe('Triage it.\n');
  });

  it('continues the branch from the head the caller saw', async () => {
    const project = await createManagedProject();
    const first = await commit(project);

    const second = await commit(project, {
      expectedHead: first.commit,
      changes: [{path: WORKFLOW, content: null}],
    });

    expect(second.parent).toBe(first.commit);
  });

  it('gives one stale-head to two racing commits', async () => {
    const project = await createManagedProject();
    const first = await commit(project);

    const results = await Promise.allSettled(
      ['one', 'two'].map((name) =>
        commit(project, {
          expectedHead: first.commit,
          changes: [{path: PROMPT, content: `Racer ${name}.\n`}],
        }),
      ),
    );

    const winners = results.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    const loser = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    const winner = winners[0] as PromiseFulfilledResult<{commit: string}>;
    expect(await knownError(Promise.reject(loser.reason))).toEqual({
      code: 'stale-head',
      details: {branch: 'shipfox/add-prompt', head: winner.value.commit},
    });
  });

  it('refuses the default branch', async () => {
    const project = await createManagedProject();

    expect(await knownError(commit(project, {branch: 'main'}))).toEqual({
      code: 'protected-branch',
      details: {branch: 'main'},
    });
  });

  it('refuses a path outside the config folder, with the path', async () => {
    const project = await createManagedProject();

    expect(
      await knownError(commit(project, {changes: [{path: 'src/index.ts', content: 'x'}]})),
    ).toEqual({code: 'path-not-allowed', details: {path: 'src/index.ts'}});
  });

  it('answers repository-read-only with the repository name for a linked project', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const client = createClient(
      projectsClient({
        id: projectId,
        workspaceId,
        sourceConnectionId: crypto.randomUUID(),
        sourceExternalRepositoryId: 'github:123',
        sourceRepositoryOwner: 'acme',
        sourceRepositoryName: 'app',
        sourceDefaultBranch: 'main',
      }),
    );

    expect(
      await knownError(client.commitConfigChanges(baseInput({workspaceId, projectId}, {}))),
    ).toEqual({
      code: 'repository-read-only',
      details: {repository: 'acme/app'},
    });
  });

  it('answers project-not-found for a project of another workspace', async () => {
    const project = await createManagedProject();

    const error = await knownError(
      project.client.commitConfigChanges(
        baseInput({workspaceId: crypto.randomUUID(), projectId: project.projectId}, {}),
      ),
    );

    expect(error).toEqual({code: 'project-not-found', details: {projectId: project.projectId}});
  });
});
