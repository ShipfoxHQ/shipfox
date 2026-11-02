import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {sql} from 'drizzle-orm';
import {db} from '#db/index.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects} from '#db/schema/projects.js';
import {
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  ProjectSourceChangedError,
} from './errors.js';
import {createProjectFromSource, moveProjectSource} from './projects.js';

describe('createProjectFromSource', () => {
  let actorId: string;
  let workspaceId: string;
  let sourceConnectionId: string;
  let integrations: Pick<IntegrationsModuleClient, 'resolveSourceRepository'>;

  beforeEach(() => {
    actorId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    integrations = {
      resolveSourceRepository: vi.fn(async () => {
        await Promise.resolve();
        return {
          connection: {
            id: sourceConnectionId,
            provider: 'gitea' as const,
            slug: 'gitea_owner',
          },
          repository: {
            externalRepositoryId: 'gitea:gitea-owner/platform',
            owner: 'gitea-owner',
            name: 'platform',
            fullName: 'gitea-owner/platform',
            defaultBranch: 'main',
            visibility: 'private' as const,
            cloneUrl: 'https://gitea.local/gitea-owner/platform.git',
            htmlUrl: 'https://gitea.local/gitea-owner/platform',
          },
        };
      }),
    };
  });

  test('creates a project bound to a source repository', async () => {
    const project = await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    expect(project.workspaceId).toBe(workspaceId);
    expect(project.name).toBe('Platform');
    expect(project.slug).toBe('platform');
    expect(project.sourceConnectionId).toBe(sourceConnectionId);
    expect(project.sourceExternalRepositoryId).toBe('gitea:gitea-owner/platform');
    expect(project.sourceRepositoryOwner).toBe('gitea-owner');
    expect(project.sourceRepositoryName).toBe('platform');
    expect(project.sourceDefaultBranch).toBe('main');
  });

  test('emits project lifecycle events in the same transaction', async () => {
    const project = await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${project.id}`);

    expect(events.map((event) => event.eventType).sort()).toEqual([
      'projects.project.created',
      'projects.project.source_bound',
    ]);
    expect(events.every((event) => event.orderingKey === project.id)).toBe(true);
    expect(events.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: 'platform',
          sourceConnectionId,
          sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
        }),
        expect.objectContaining({
          sourceConnectionId,
          externalRepositoryId: 'gitea:gitea-owner/platform',
          provider: 'gitea',
        }),
      ]),
    );
  });

  test('rejects a second project for the same source repository', async () => {
    await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      slug: 'platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    const result = createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform Again',
      slug: 'platform-again',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      integrations: integrations as IntegrationsModuleClient,
    });

    await expect(result).rejects.toThrow('Project already exists');
  });

  test('surfaces provider repository access failures', async () => {
    vi.mocked(integrations.resolveSourceRepository).mockRejectedValueOnce(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        'provider-failure',
        {reason: 'repository-not-found'},
      ),
    );

    const result = createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Missing',
      slug: 'missing',
      sourceConnectionId,
      sourceExternalRepositoryId: 'not-found',
      integrations: integrations as IntegrationsModuleClient,
    });

    await expect(result).rejects.toMatchObject({
      code: 'provider-failure',
      details: {reason: 'repository-not-found'},
    });
  });
});

describe('moveProjectSource', () => {
  const managed = 'managed-vcs:00000000-0000-4000-8000-000000000001';
  let workspaceId: string;
  let managedConnectionId: string;
  let githubConnectionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    managedConnectionId = crypto.randomUUID();
    githubConnectionId = crypto.randomUUID();
  });

  async function createManagedProject(slug: string, externalRepositoryId = managed) {
    const [project] = await db()
      .insert(projects)
      .values({
        workspaceId,
        sourceConnectionId: managedConnectionId,
        sourceExternalRepositoryId: externalRepositoryId,
        sourceRepositoryOwner: 'shipfox',
        sourceRepositoryName: externalRepositoryId,
        sourceDefaultBranch: 'main',
        name: slug,
        slug,
      })
      .returning();
    if (!project) throw new Error('Project insert returned no row');
    return project;
  }

  function move(projectId: string, repositoryId = 'github:42', from = managed) {
    return {
      actorId: 'user-1',
      workspaceId,
      projectId,
      from: {connectionId: managedConnectionId, externalRepositoryId: from},
      to: {
        connectionId: githubConnectionId,
        provider: 'github',
        externalRepositoryId: repositoryId,
        owner: 'acme',
        name: 'app',
        defaultBranch: 'trunk',
      },
    };
  }

  async function events(projectId: string) {
    return await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${projectId}`);
  }

  test('moves the source and announces it as a bind', async () => {
    const project = await createManagedProject('managed');

    const result = await moveProjectSource(move(project.id));

    expect(result).toEqual({moved: true});
    const [row] = await db().select().from(projects).where(sql`${projects.id} = ${project.id}`);
    expect(row).toMatchObject({
      sourceConnectionId: githubConnectionId,
      sourceExternalRepositoryId: 'github:42',
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'app',
      sourceDefaultBranch: 'trunk',
    });
    expect((await events(project.id)).map((event) => event.payload)).toEqual([
      expect.objectContaining({
        actorId: 'user-1',
        sourceConnectionId: githubConnectionId,
        provider: 'github',
        externalRepositoryId: 'github:42',
      }),
    ]);
  });

  test('succeeds without a second bind when the target is already set', async () => {
    const project = await createManagedProject('managed');
    await moveProjectSource(move(project.id));

    const result = await moveProjectSource(move(project.id));

    expect(result).toEqual({moved: false});
    expect(await events(project.id)).toHaveLength(1);
  });

  test('refuses when the source is neither the expected one nor the target', async () => {
    const project = await createManagedProject('managed');

    const result = moveProjectSource(move(project.id, 'github:42', 'managed-vcs:other'));

    await expect(result).rejects.toBeInstanceOf(ProjectSourceChangedError);
    expect(await events(project.id)).toHaveLength(0);
  });

  test('refuses a project of another workspace', async () => {
    const project = await createManagedProject('managed');

    const result = moveProjectSource({...move(project.id), workspaceId: crypto.randomUUID()});

    await expect(result).rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  test('gives the repository to one of two projects racing for it', async () => {
    const first = await createManagedProject('first', 'managed-vcs:first');
    const second = await createManagedProject('second', 'managed-vcs:second');

    const results = await Promise.allSettled([
      moveProjectSource(move(first.id, 'github:42', 'managed-vcs:first')),
      moveProjectSource(move(second.id, 'github:42', 'managed-vcs:second')),
    ]);

    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result) => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.reason).toBeInstanceOf(ProjectAlreadyExistsError);
    const loserId = results[0]?.status === 'rejected' ? first.id : second.id;
    expect(await events(loserId)).toHaveLength(0);
  });
});
