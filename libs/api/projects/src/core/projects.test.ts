import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {IntegrationProviderError} from '@shipfox/api-integration-core';
import {sql} from 'drizzle-orm';
import {db} from '#db/index.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {createProjectFromSource} from './projects.js';

describe('createProjectFromSource', () => {
  let actorId: string;
  let workspaceId: string;
  let sourceConnectionId: string;
  let sourceControl: IntegrationSourceControlService;

  beforeEach(() => {
    actorId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    sourceControl = {
      getConnection: vi.fn(),
      listRepositories: vi.fn(),
      resolveRepository: vi.fn(async () => {
        await Promise.resolve();
        return {
          connection: {
            id: sourceConnectionId,
            workspaceId,
            provider: 'gitea' as const,
            externalAccountId: 'gitea-owner',
            slug: 'gitea_owner',
            displayName: 'Gitea',
            lifecycleStatus: 'active' as const,
            capabilities: ['source_control' as const],
            createdAt: new Date(),
            updatedAt: new Date(),
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
      listFiles: vi.fn(),
      fetchFile: vi.fn(),
      createCheckoutSpec: vi.fn(),
    };
  });

  test('creates a project bound to a source repository', async () => {
    const project = await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      sourceControl,
    });

    expect(project.workspaceId).toBe(workspaceId);
    expect(project.name).toBe('Platform');
    expect(project.sourceConnectionId).toBe(sourceConnectionId);
    expect(project.sourceExternalRepositoryId).toBe('gitea:gitea-owner/platform');
  });

  test('emits project lifecycle events in the same transaction', async () => {
    const project = await createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      sourceControl,
    });

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${project.id}`);

    expect(events.map((event) => event.eventType).sort()).toEqual([
      'projects.project.created',
      'projects.project.source_bound',
    ]);
    expect(events.map((event) => event.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
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
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      sourceControl,
    });

    const result = createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Platform Again',
      sourceConnectionId,
      sourceExternalRepositoryId: 'gitea:gitea-owner/platform',
      sourceControl,
    });

    await expect(result).rejects.toThrow('Project already exists');
  });

  test('surfaces provider repository access failures', async () => {
    vi.mocked(sourceControl.resolveRepository).mockRejectedValueOnce(
      new IntegrationProviderError('repository-not-found', 'Repository not found'),
    );

    const result = createProjectFromSource({
      actorId,
      workspaceId,
      name: 'Missing',
      sourceConnectionId,
      sourceExternalRepositoryId: 'not-found',
      sourceControl,
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });
});
