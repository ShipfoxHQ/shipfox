import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {projects} from '#db/schema/projects.js';
import {projectFactory} from '#test/index.js';
import {backfillDefaultProjects} from './default-project-backfill.js';

function workspace(id: string) {
  return {
    id,
    name: 'Workspace',
    slug: 'workspace',
    status: 'active' as const,
    memberCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('backfillDefaultProjects', () => {
  let connectionId: string;
  let integrations: Pick<
    IntegrationsModuleClient,
    'createManagedRepository' | 'resolveSourceRepository' | 'deleteManagedRepository'
  >;

  function resolved(externalRepositoryId: string, owner = 'shipfox', name = externalRepositoryId) {
    return {
      connection: {id: connectionId, provider: 'github' as const, slug: 'github_shipfox'},
      repository: {
        externalRepositoryId,
        owner,
        name,
        fullName: `${owner}/${name}`,
        defaultBranch: 'main',
        visibility: 'private' as const,
        cloneUrl: '',
        htmlUrl: '',
      },
    };
  }

  beforeEach(() => {
    connectionId = crypto.randomUUID();
    integrations = {
      createManagedRepository: vi.fn(({projectId}) =>
        Promise.resolve({connectionId, externalRepositoryId: `managed-vcs:${projectId}`}),
      ),
      resolveSourceRepository: vi.fn(({externalRepositoryId}) =>
        Promise.resolve(resolved(externalRepositoryId)),
      ),
      deleteManagedRepository: vi.fn().mockResolvedValue({deleted: true}),
    };
  });

  function workspacesWith(
    byStatus: Partial<Record<'active' | 'suspended', string[]>>,
  ): Pick<WorkspacesInterModuleClient, 'listAdminWorkspaces'> {
    return {
      listAdminWorkspaces: vi.fn(({status}) =>
        Promise.resolve({
          workspaces: (byStatus[status as 'active' | 'suspended'] ?? []).map(workspace),
          nextCursor: null,
        }),
      ),
    };
  }

  function run(workspaces: Pick<WorkspacesInterModuleClient, 'listAdminWorkspaces'>) {
    return backfillDefaultProjects({
      actorId: crypto.randomUUID(),
      workspaces,
      integrations: integrations as IntegrationsModuleClient,
    });
  }

  test('gives a default project to every workspace that is not deleted', async () => {
    const active = crypto.randomUUID();
    const suspended = crypto.randomUUID();

    const result = await run(workspacesWith({active: [active], suspended: [suspended]}));

    expect(result).toMatchObject({workspacesChecked: 2, defaultsCreated: 2, failures: 0});
    for (const workspaceId of [active, suspended]) {
      const rows = await db().select().from(projects).where(eq(projects.workspaceId, workspaceId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({isDefault: true, name: 'Default'});
    }
  });

  test('does nothing the second time', async () => {
    const workspaces = workspacesWith({active: [crypto.randomUUID()]});
    await run(workspaces);

    const result = await run(workspaces);

    expect(result).toMatchObject({workspacesChecked: 1, defaultsCreated: 0, failures: 0});
  });

  test('keeps going when one workspace fails', async () => {
    const broken = crypto.randomUUID();
    const healthy = crypto.randomUUID();
    vi.mocked(integrations.createManagedRepository).mockImplementation(
      ({workspaceId, projectId}) =>
        workspaceId === broken
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({connectionId, externalRepositoryId: `managed-vcs:${projectId}`}),
    );

    const result = await run(workspacesWith({active: [broken, healthy]}));

    expect(result).toMatchObject({defaultsCreated: 1, failures: 1});
    const rows = await db().select().from(projects).where(eq(projects.workspaceId, healthy));
    expect(rows).toHaveLength(1);
  });

  test('fills the owner and name of a config repository that lacks them', async () => {
    const workspaceId = crypto.randomUUID();
    const project = await projectFactory.create({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: 'github:42',
    });
    vi.mocked(integrations.resolveSourceRepository).mockResolvedValue(
      resolved('github:42', 'acme', 'app'),
    );

    const result = await run(workspacesWith({}));

    expect(result.repositoriesFilled).toBe(1);
    const [row] = await db().select().from(projects).where(eq(projects.id, project.id));
    expect(row).toMatchObject({
      sourceRepositoryOwner: 'acme',
      sourceRepositoryName: 'app',
      sourceDefaultBranch: 'main',
    });
  });

  test('leaves a repository that no longer resolves as it is', async () => {
    const project = await projectFactory.create({
      workspaceId: crypto.randomUUID(),
      sourceConnectionId: connectionId,
    });
    vi.mocked(integrations.resolveSourceRepository).mockRejectedValue(new Error('gone'));

    const result = await run(workspacesWith({}));

    expect(result).toMatchObject({repositoriesFilled: 0, failures: 1});
    const [row] = await db().select().from(projects).where(eq(projects.id, project.id));
    expect(row?.sourceRepositoryOwner).toBeNull();
  });
});
