import {
  INTEGRATION_CONNECTION_DELETED,
  type IntegrationConnectionDeletedEvent,
} from '@shipfox/api-integration-core-dto';
import {db} from '#db/db.js';
import {loadProjectAccessByIds, replaceProjectAccess} from '#db/project-access.js';
import {projectFactory} from '#test/index.js';
import {onConnectionDeleted} from './on-connection-deleted.js';

function deletedEvent(connectionId: string): IntegrationConnectionDeletedEvent {
  return {
    provider: 'github',
    workspaceId: crypto.randomUUID(),
    connectionId,
    slug: INTEGRATION_CONNECTION_DELETED,
  };
}

const sdk = {
  kind: 'repository',
  externalId: 'github:1',
  lookupName: 'acme/sdk',
  displayName: 'acme/sdk',
};

describe('onConnectionDeleted', () => {
  it('removes the connection and its resources from every project that lists it', async () => {
    const workspaceId = crypto.randomUUID();
    const deleted = crypto.randomUUID();
    const kept = crypto.randomUUID();
    const first = await projectFactory.create({workspaceId});
    const second = await projectFactory.create({workspaceId});
    for (const project of [first, second]) {
      await db().transaction((tx) =>
        replaceProjectAccess({
          tx,
          projectId: project.id,
          access: {
            connectionAccess: 'selected',
            scopes: [
              {connectionId: deleted, resources: [sdk]},
              {connectionId: kept, resources: 'all'},
            ],
          },
        }),
      );
    }

    await onConnectionDeleted(deletedEvent(deleted));

    const access = await loadProjectAccessByIds([first.id, second.id]);
    expect(access.get(first.id)).toEqual({
      connectionAccess: 'selected',
      scopes: [{connectionId: kept, resources: 'all'}],
    });
    expect(access.get(second.id)?.scopes).toEqual([{connectionId: kept, resources: 'all'}]);
  });

  it('leaves a project that listed only the connection reaching only its config source', async () => {
    const connectionId = crypto.randomUUID();
    const project = await projectFactory.create();
    await db().transaction((tx) =>
      replaceProjectAccess({
        tx,
        projectId: project.id,
        access: {
          connectionAccess: 'selected',
          scopes: [{connectionId, resources: [sdk]}],
        },
      }),
    );

    await onConnectionDeleted(deletedEvent(connectionId));

    const access = await loadProjectAccessByIds([project.id]);
    expect(access.get(project.id)).toEqual({connectionAccess: 'selected', scopes: []});
  });

  it('ignores a connection that no project lists', async () => {
    await expect(onConnectionDeleted(deletedEvent(crypto.randomUUID()))).resolves.toBeUndefined();
  });
});
