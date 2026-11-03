import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {getDefaultProject} from '#db/projects.js';
import {onWorkspaceCreated} from './on-workspace-created.js';

describe('onWorkspaceCreated', () => {
  test('creates the default project of the new workspace, and only once', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const integrations = {
      createManagedRepository: vi.fn(({projectId}) =>
        Promise.resolve({connectionId, externalRepositoryId: `managed-vcs:${projectId}`}),
      ),
      resolveSourceRepository: vi.fn(({externalRepositoryId}) =>
        Promise.resolve({
          connection: {id: connectionId, provider: 'managed-vcs', slug: 'shipfox-managed'},
          repository: {
            externalRepositoryId,
            owner: 'shipfox',
            name: externalRepositoryId,
            fullName: `shipfox/${externalRepositoryId}`,
            defaultBranch: 'main',
            visibility: 'private',
            cloneUrl: '',
            htmlUrl: '',
          },
        }),
      ),
      deleteManagedRepository: vi.fn().mockResolvedValue({deleted: true}),
    } as unknown as IntegrationsModuleClient;
    const payload = {workspaceId, name: 'Acme', slug: 'acme', creatorUserId: crypto.randomUUID()};

    await onWorkspaceCreated(payload, {integrations});
    await onWorkspaceCreated(payload, {integrations});

    expect(await getDefaultProject(workspaceId)).toMatchObject({name: 'Default', isDefault: true});
    expect(integrations.createManagedRepository).toHaveBeenCalledTimes(1);
  });
});
