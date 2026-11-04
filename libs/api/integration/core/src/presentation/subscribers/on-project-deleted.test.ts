import {getManagedRepositoryByProject} from '@shipfox/api-integration-managed-vcs';
import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {createManagedProjectRepository} from '#core/managed-repositories.js';
import {onProjectDeleted} from './on-project-deleted.js';

function deletedEvent(params: {workspaceId: string; projectId: string}): ProjectDeletedEvent {
  return {...params, deletedBy: 'user-1', deletedAt: new Date().toISOString()};
}

describe('onProjectDeleted', () => {
  it('deletes the managed repository of the project and keeps other projects', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const otherProjectId = crypto.randomUUID();
    await createManagedProjectRepository({workspaceId, projectId});
    await createManagedProjectRepository({workspaceId, projectId: otherProjectId});

    await onProjectDeleted(deletedEvent({workspaceId, projectId}));

    expect(await getManagedRepositoryByProject({workspaceId, projectId})).toBeUndefined();
    expect(
      await getManagedRepositoryByProject({workspaceId, projectId: otherProjectId}),
    ).toBeDefined();
  });

  it('does nothing for a project with no managed repository', async () => {
    const event = deletedEvent({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
    });

    await expect(onProjectDeleted(event)).resolves.toBeUndefined();
  });

  it('is safe to repeat', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    await createManagedProjectRepository({workspaceId, projectId});
    const event = deletedEvent({workspaceId, projectId});

    await onProjectDeleted(event);

    await expect(onProjectDeleted(event)).resolves.toBeUndefined();
  });
});
