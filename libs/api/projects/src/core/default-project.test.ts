import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/index.js';
import {projects} from '#db/schema/projects.js';
import {projectFactory} from '#test/index.js';
import {ensureDefaultProject} from './default-project.js';
import {updateProjectDetails} from './projects.js';

type Integrations = Pick<
  IntegrationsModuleClient,
  'createManagedRepository' | 'resolveSourceRepository' | 'deleteManagedRepository'
>;

function createIntegrations(): Integrations {
  const connectionId = crypto.randomUUID();
  return {
    createManagedRepository: vi.fn(({projectId}) =>
      Promise.resolve({connectionId, externalRepositoryId: `managed-vcs:${projectId}`}),
    ),
    resolveSourceRepository: vi.fn(({externalRepositoryId}) =>
      Promise.resolve({
        connection: {id: connectionId, provider: 'managed-vcs' as const, slug: 'shipfox-managed'},
        repository: {
          externalRepositoryId,
          owner: 'shipfox',
          name: externalRepositoryId,
          fullName: `shipfox/${externalRepositoryId}`,
          defaultBranch: 'main',
          visibility: 'private' as const,
          cloneUrl: '',
          htmlUrl: '',
        },
      }),
    ),
    deleteManagedRepository: vi.fn().mockResolvedValue({deleted: true}),
  };
}

describe('ensureDefaultProject', () => {
  let workspaceId: string;
  let actorId: string;
  let integrations: Integrations;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    actorId = crypto.randomUUID();
    integrations = createIntegrations();
  });

  function ensure() {
    return ensureDefaultProject({
      actorId,
      workspaceId,
      integrations: integrations as IntegrationsModuleClient,
    });
  }

  test('creates an empty managed project named Default', async () => {
    const {project, created} = await ensure();

    expect(created).toBe(true);
    expect(project).toMatchObject({workspaceId, name: 'Default', slug: 'default', isDefault: true});
    expect(integrations.createManagedRepository).toHaveBeenCalledWith({
      workspaceId,
      projectId: project.id,
    });
  });

  test('returns the existing default and creates nothing the second time', async () => {
    const first = await ensure();

    const second = await ensure();

    expect(second).toEqual({project: first.project, created: false});
    expect(integrations.createManagedRepository).toHaveBeenCalledTimes(1);
  });

  test('takes the next free slug when default is taken', async () => {
    await projectFactory.create({workspaceId, slug: 'default'});
    await projectFactory.create({workspaceId, slug: 'default-2'});

    const {project} = await ensure();

    expect(project.slug).toBe('default-3');
  });

  test('ends with one default when two calls race', async () => {
    const results = await Promise.all([ensure(), ensure()]);

    expect(results[0].project.id).toBe(results[1].project.id);
    const rows = await db().select().from(projects).where(eq(projects.workspaceId, workspaceId));
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });

  test('keeps the default when it is renamed', async () => {
    const {project} = await ensure();

    await updateProjectDetails({
      actorId,
      projectId: project.id,
      name: 'Platform',
      slug: 'platform',
    });

    const again = await ensure();
    expect(again).toMatchObject({
      created: false,
      project: {id: project.id, name: 'Platform', slug: 'platform', isDefault: true},
    });
  });

  test('gives each workspace its own default', async () => {
    const other = await ensureDefaultProject({
      actorId,
      workspaceId: crypto.randomUUID(),
      integrations: integrations as IntegrationsModuleClient,
    });
    const mine = await ensure();

    expect(other.project.id).not.toBe(mine.project.id);
    expect(other.project.slug).toBe('default');
    expect(mine.project.slug).toBe('default');
  });
});
