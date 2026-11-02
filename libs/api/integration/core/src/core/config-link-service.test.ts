import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {getIntegrationConnectionById, upsertIntegrationConnection} from '#db/connections.js';
import type {IntegrationProvider} from '#index.js';
import {createFakeHost, createFakeProjects} from '#test/fixtures/config-link.js';
import {createConfigLinkService, linkBranchName} from './config-link-service.js';
import {
  ConfigLinkRefusedError,
  ConfigLinkUnconfirmedError,
  IntegrationProviderError,
} from './errors.js';
import {createManagedProjectRepository} from './managed-repositories.js';
import type {ConfigProject} from './project-config-service.js';
import {createIntegrationProviderRegistry} from './providers/registry.js';
import {createSourceControlIntegrationService} from './source-control-service.js';

const WORKFLOW = '.shipfox/workflows/triage.yml';

describe('config link service', () => {
  let workspaceId: string;
  let targetConnectionId: string;
  let managedConnectionId: string | undefined;
  let fake: ReturnType<typeof createFakeHost>;
  let projects: ReturnType<typeof createFakeProjects>;

  beforeEach(async () => {
    workspaceId = crypto.randomUUID();
    managedConnectionId = undefined;
    fake = createFakeHost();
    projects = createFakeProjects(workspaceId);
    const connection = await upsertIntegrationConnection({
      workspaceId,
      provider: 'gitea',
      externalAccountId: `acme-${workspaceId}`,
      slug: 'gitea_acme',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    targetConnectionId = connection.id;
  });

  async function managedProject(
    files: ReadonlyArray<{path: string; content: string}> = [
      {path: WORKFLOW, content: 'name: Triage\n'},
    ],
  ): Promise<string> {
    const projectId = crypto.randomUUID();
    const repository = await createManagedProjectRepository({workspaceId, projectId, files});
    managedConnectionId = repository.connectionId;
    projects.rows.set(projectId, {
      id: projectId,
      workspaceId,
      connectionId: repository.connectionId,
      externalRepositoryId: repository.externalRepositoryId,
      owner: 'shipfox',
      name: repository.externalRepositoryId,
      defaultBranch: 'main',
    });
    return projectId;
  }

  async function service(options: {providers?: IntegrationProvider[]} = {}) {
    const managed = await import('@shipfox/api-integration-managed-vcs');
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'managed-vcs',
        displayName: 'Shipfox',
        internal: true,
        adapters: {
          source_control: new managed.ManagedSourceControlProvider() as NonNullable<
            NonNullable<IntegrationProvider['adapters']>['source_control']
          >,
        },
      },
      ...(options.providers ?? [fake.provider]),
    ]);
    const sourceControl = createSourceControlIntegrationService({
      registry,
      getIntegrationConnectionById,
    });
    return createConfigLinkService({
      registry,
      sourceControl,
      projects: projects.client as unknown as ProjectsModuleClient,
      getManagedConnection: async () =>
        managedConnectionId ? await getIntegrationConnectionById(managedConnectionId) : undefined,
    });
  }

  function current(projectId: string): ConfigProject {
    const project = projects.rows.get(projectId);
    if (!project) throw new Error('unknown project');
    return project;
  }

  function linkInput(overrides: Partial<{dryRun: boolean; externalRepositoryId: string}> = {}) {
    return {
      actorId: 'user-1',
      connectionId: targetConnectionId,
      externalRepositoryId: fake.host.externalRepositoryId,
      dryRun: false,
      ...overrides,
    };
  }

  async function repositoryOf(projectId: string) {
    const managed = await import('@shipfox/api-integration-managed-vcs');
    const repository = await managed.getManagedRepositoryByProject({projectId, workspaceId});
    if (!repository) throw new Error('missing managed repository');
    return repository;
  }

  describe('checks', () => {
    it('passes a dry run without changing anything', async () => {
      const projectId = await managedProject();
      const links = await service();

      const result = await links.link(current(projectId), linkInput({dryRun: true}));

      expect(result).toMatchObject({status: 'ready', fileCount: 1, pullRequest: null});
      expect(result.repository.fullName).toBe('acme/app');
      expect((await repositoryOf(projectId)).status).toBe('active');
      expect(fake.host.opened).toEqual([]);
    });

    it.each([
      ['config-exists', () => (fake.host.existingFiles = [WORKFLOW])],
      ['repository-empty', () => (fake.host.empty = true)],
    ])('refuses with %s', async (code, arrange) => {
      const projectId = await managedProject();
      arrange();
      const links = await service();

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toMatchObject({code});
      expect((await repositoryOf(projectId)).status).toBe('active');
      expect(fake.host.opened).toEqual([]);
    });

    it('refuses a repository another project already uses', async () => {
      const projectId = await managedProject();
      projects.rows.set(crypto.randomUUID(), {
        id: crypto.randomUUID(),
        workspaceId,
        connectionId: targetConnectionId,
        externalRepositoryId: fake.host.externalRepositoryId,
        owner: 'acme',
        name: 'app',
        defaultBranch: 'trunk',
      });
      const links = await service();

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toMatchObject({code: 'repository-in-use'});
    });

    it('refuses an inactive connection', async () => {
      const projectId = await managedProject();
      await upsertIntegrationConnection({
        workspaceId,
        provider: 'gitea',
        externalAccountId: `acme-${workspaceId}`,
        slug: 'gitea_acme',
        displayName: 'Gitea',
        lifecycleStatus: 'error',
        capabilities: ['source_control'],
      });
      const links = await service();

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toMatchObject({code: 'connection-inactive'});
    });

    it('refuses a provider that cannot open a pull request', async () => {
      const projectId = await managedProject();
      const {openConfigPullRequest: _open, ...adapter} =
        fake.provider.adapters?.source_control ?? {};
      const links = await service({
        providers: [
          {
            ...fake.provider,
            adapters: {source_control: adapter as never},
          },
        ],
      });

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toMatchObject({code: 'link-unsupported'});
    });

    it('refuses a project that is not managed', async () => {
      const links = await service();
      const project: ConfigProject = {
        id: crypto.randomUUID(),
        workspaceId,
        connectionId: targetConnectionId,
        externalRepositoryId: 'gitea:acme/other',
        owner: 'acme',
        name: 'other',
        defaultBranch: 'main',
      };

      const result = links.link(project, linkInput());

      await expect(result).rejects.toMatchObject({code: 'project-not-managed'});
    });
  });

  describe('the move', () => {
    it('opens a pull request with the config, moves the source, and finishes linked', async () => {
      const projectId = await managedProject();
      const links = await service();

      const result = await links.link(current(projectId), linkInput());

      expect(result.status).toBe('linked');
      expect(result.pullRequest).toMatchObject({number: 1, state: 'open'});
      const repository = await repositoryOf(projectId);
      expect(repository).toMatchObject({
        status: 'linked',
        link: {
          connectionId: targetConnectionId,
          externalRepositoryId: fake.host.externalRepositoryId,
          startedBy: 'user-1',
        },
        pullRequest: {number: 1},
      });
      const [opened] = fake.host.opened;
      expect(opened?.branch).toBe(linkBranchName(repository.link?.attemptId ?? ''));
      expect(opened?.files).toEqual([{path: WORKFLOW, content: 'name: Triage\n'}]);
      expect(opened?.body).toContain('Merge this pull request');
      expect(current(projectId)).toMatchObject({
        connectionId: targetConnectionId,
        externalRepositoryId: fake.host.externalRepositoryId,
        defaultBranch: 'trunk',
      });
    });

    it('moves a project with no config files without a pull request', async () => {
      const projectId = await managedProject([]);
      const links = await service();

      const result = await links.link(current(projectId), linkInput());

      expect(result).toMatchObject({status: 'linked', fileCount: 0, pullRequest: null});
      expect(fake.host.opened).toEqual([]);
      expect(projects.moves).toEqual([projectId]);
    });

    it('refuses a second move once linked', async () => {
      const projectId = await managedProject();
      const links = await service();
      await links.link(current(projectId), linkInput());

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toMatchObject({code: 'already-moved'});
    });

    it('releases the repository when the provider refuses the pull request', async () => {
      const projectId = await managedProject();
      fake.host.failBeforeOpen = new IntegrationProviderError(
        'access-denied',
        'Resource not accessible',
        undefined,
        403,
        'permission-denied',
      );
      const links = await service();

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toMatchObject({reason: 'access-denied'});
      expect(await repositoryOf(projectId)).toMatchObject({
        status: 'active',
        link: null,
        pullRequest: null,
      });
      expect(projects.moves).toEqual([]);
    });

    it('releases the repository when the pull request was closed without a merge', async () => {
      const projectId = await managedProject();
      fake.host.openState = 'closed';
      const links = await service();

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toMatchObject({code: 'pull-request-closed'});
      expect((await repositoryOf(projectId)).status).toBe('active');
      expect(projects.moves).toEqual([]);
    });

    it('releases the repository when another project took the target first', async () => {
      const projectId = await managedProject();
      projects.rows.set(crypto.randomUUID(), {
        id: crypto.randomUUID(),
        workspaceId,
        connectionId: targetConnectionId,
        externalRepositoryId: fake.host.externalRepositoryId,
        owner: 'acme',
        name: 'app',
        defaultBranch: 'trunk',
      });
      const links = await service();
      // The check ran before the other project bound the target.
      const before = await links
        .link(current(projectId), linkInput({dryRun: true}))
        .catch((e) => e);
      expect(before).toMatchObject({code: 'repository-in-use'});
    });

    it('never releases on an unknown outcome, and a retry finishes with the same pull request', async () => {
      const projectId = await managedProject();
      fake.host.failAfterOpen = new IntegrationProviderError('timeout', 'GitHub request timed out');
      const links = await service();

      const first = links.link(current(projectId), linkInput());

      await expect(first).rejects.toBeInstanceOf(ConfigLinkUnconfirmedError);
      const stopped = await repositoryOf(projectId);
      expect(stopped.status).toBe('linking');
      expect(projects.moves).toEqual([]);

      fake.host.failAfterOpen = undefined;
      const retried = await links.link(current(projectId), linkInput());

      expect(retried.status).toBe('linked');
      expect(fake.host.pullRequests.size).toBe(1);
      expect(fake.host.opened).toHaveLength(1);
      expect((await repositoryOf(projectId)).link?.attemptId).toBe(stopped.link?.attemptId);
    });

    it.each([
      ['provider-unavailable'],
      ['malformed-provider-response'],
    ] as const)('keeps the repository read-only after %s', async (reason) => {
      const projectId = await managedProject();
      fake.host.failBeforeOpen = new IntegrationProviderError(reason, 'down');
      const links = await service();

      const result = links.link(current(projectId), linkInput());

      await expect(result).rejects.toBeInstanceOf(ConfigLinkUnconfirmedError);
      expect((await repositoryOf(projectId)).status).toBe('linking');
    });

    it('keeps the repository read-only when the move itself fails with an unknown error', async () => {
      const projectId = await managedProject();
      const links = await service();
      const original = projects.client.moveProjectSource;
      projects.client.moveProjectSource = () => Promise.reject(new Error('connection reset'));

      const first = links.link(current(projectId), linkInput());

      await expect(first).rejects.toThrow('connection reset');
      expect((await repositoryOf(projectId)).status).toBe('linking');

      projects.client.moveProjectSource = original;
      const retried = await links.link(current(projectId), linkInput());
      expect(retried.status).toBe('linked');
      expect(fake.host.opened).toHaveLength(1);
    });

    it('goes straight to linked when the source already moved', async () => {
      const projectId = await managedProject();
      const links = await service();
      const original = projects.client.moveProjectSource;
      const managed = await import('@shipfox/api-integration-managed-vcs');
      // The move landed but the repository never finished.
      vi.spyOn(managed, 'completeManagedLink').mockResolvedValueOnce(false);
      await links.link(current(projectId), linkInput());
      expect((await repositoryOf(projectId)).status).toBe('linking');
      projects.client.moveProjectSource = () => Promise.reject(new Error('must not move again'));

      const retried = await links.link(current(projectId), linkInput());

      projects.client.moveProjectSource = original;
      expect(retried.status).toBe('linked');
      expect(retried.pullRequest).toMatchObject({number: 1, state: 'open'});
      expect(fake.host.opened).toHaveLength(1);
      expect((await repositoryOf(projectId)).status).toBe('linked');
    });

    it('refuses a dry run while a move is stopped', async () => {
      const projectId = await managedProject();
      fake.host.failBeforeOpen = new IntegrationProviderError('timeout', 'slow');
      const links = await service();
      await links.link(current(projectId), linkInput()).catch(() => undefined);

      const result = links.link(current(projectId), linkInput({dryRun: true}));

      await expect(result).rejects.toBeInstanceOf(ConfigLinkRefusedError);
      await expect(result).rejects.toMatchObject({code: 'move-in-progress'});
    });

    it("lets two projects race for one repository without adopting each other's pull request", async () => {
      const first = await managedProject();
      const second = await managedProject([{path: WORKFLOW, content: 'name: Other\n'}]);
      const links = await service();

      const results = await Promise.allSettled([
        links.link(current(first), linkInput()),
        links.link(current(second), linkInput()),
      ]);

      const winner = results.findIndex((result) => result.status === 'fulfilled');
      const loser = winner === 0 ? 1 : 0;
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results[loser]).toMatchObject({
        status: 'rejected',
        reason: {code: 'source-already-bound'},
      });
      const [winnerId, loserId] = winner === 0 ? [first, second] : [second, first];
      const winning = await repositoryOf(winnerId);
      const losing = await repositoryOf(loserId);
      // Each project opened its own pull request on its own branch.
      expect(fake.host.opened).toHaveLength(2);
      expect(new Set(fake.host.opened.map((pull) => pull.branch)).size).toBe(2);
      expect(winning.status).toBe('linked');
      expect(losing).toMatchObject({status: 'active', pullRequest: null, link: null});
      expect(current(loserId).externalRepositoryId).not.toBe(fake.host.externalRepositoryId);
    });
  });

  describe('reading the move', () => {
    async function linked() {
      const projectId = await managedProject();
      const links = await service();
      await links.link(current(projectId), linkInput());
      return {projectId, links};
    }

    it('reports nothing for a project that never moved', async () => {
      const projectId = await managedProject();
      const links = await service();

      expect(await links.readMoveState(current(projectId))).toEqual({
        move: null,
        pullRequest: null,
      });
    });

    it('reports nothing for a project with no managed repository', async () => {
      const links = await service();

      const state = await links.readMoveState({
        id: crypto.randomUUID(),
        workspaceId,
        connectionId: targetConnectionId,
        externalRepositoryId: 'gitea:acme/x',
        owner: 'acme',
        name: 'x',
        defaultBranch: 'main',
      });

      expect(state).toEqual({move: null, pullRequest: null});
    });

    it.each(['open', 'closed'] as const)('reads a %s pull request', async (state) => {
      const {projectId, links} = await linked();
      const [pull] = [...fake.host.pullRequests.values()];
      if (pull) pull.state = state;

      const result = await links.readMoveState(current(projectId));

      expect(result.pullRequest).toMatchObject({number: 1, state});
      expect(result.move).toMatchObject({status: 'linked', startedBy: 'user-1'});
    });

    it('clears a merged pull request, so the next read does not ask the provider', async () => {
      const {projectId, links} = await linked();
      const [pull] = [...fake.host.pullRequests.values()];
      if (pull) pull.state = 'merged';

      const first = await links.readMoveState(current(projectId));
      fake.host.readError = new Error('must not read again');
      const second = await links.readMoveState(current(projectId));

      expect(first.pullRequest).toBeNull();
      expect(second.pullRequest).toBeNull();
      expect((await repositoryOf(projectId)).pullRequest).toBeNull();
    });

    it('reports an unknown state when the provider fails', async () => {
      const {projectId, links} = await linked();
      fake.host.readError = new IntegrationProviderError('provider-unavailable', 'down');

      const result = await links.readMoveState(current(projectId));

      expect(result.pullRequest).toMatchObject({number: 1, state: 'unknown'});
    });

    it('names the target of a move that is running or stopped', async () => {
      const projectId = await managedProject();
      fake.host.failBeforeOpen = new IntegrationProviderError('timeout', 'slow');
      const links = await service();
      await links.link(current(projectId), linkInput()).catch(() => undefined);

      const result = await links.readMoveState(current(projectId));

      expect(result.move).toMatchObject({
        status: 'linking',
        target: {connectionId: targetConnectionId, fullName: 'acme/app'},
        startedBy: 'user-1',
      });
      expect(result.pullRequest).toBeNull();
    });
  });

  describe('opening a new pull request', () => {
    async function linked() {
      const projectId = await managedProject();
      const links = await service();
      await links.link(current(projectId), linkInput());
      return {projectId, links};
    }

    it('opens one on a new branch after the first closed', async () => {
      const {projectId, links} = await linked();
      const before = await repositoryOf(projectId);
      const [first] = [...fake.host.pullRequests.values()];
      if (first) first.state = 'closed';

      const pullRequest = await links.openNewPullRequest(current(projectId));

      expect(pullRequest).toMatchObject({number: 2, state: 'open'});
      const after = await repositoryOf(projectId);
      expect(after.link?.attemptId).not.toBe(before.link?.attemptId);
      expect(after.pullRequest).toEqual({url: pullRequest.url, number: 2});
      expect(fake.host.opened.at(-1)?.files).toEqual([{path: WORKFLOW, content: 'name: Triage\n'}]);
      expect(after.status).toBe('linked');
    });

    it('refuses while the pull request is open', async () => {
      const {projectId, links} = await linked();

      const result = links.openNewPullRequest(current(projectId));

      await expect(result).rejects.toMatchObject({code: 'pull-request-not-closed'});
    });

    it('refuses a merged pull request and forgets it', async () => {
      const {projectId, links} = await linked();
      const [first] = [...fake.host.pullRequests.values()];
      if (first) first.state = 'merged';

      const result = links.openNewPullRequest(current(projectId));

      await expect(result).rejects.toMatchObject({code: 'pull-request-not-closed'});
      expect((await repositoryOf(projectId)).pullRequest).toBeNull();
    });

    it('refuses a project that never moved', async () => {
      const projectId = await managedProject();
      const links = await service();

      const result = links.openNewPullRequest(current(projectId));

      await expect(result).rejects.toMatchObject({code: 'no-pull-request'});
    });
  });
});
