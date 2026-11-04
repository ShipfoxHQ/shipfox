import type {ProjectDeletedEvent} from '@shipfox/api-projects-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {recordIntegrationEventForProject} from '#db/integration-event-dedup.js';
import {loadProjectAccessByIds, replaceProjectAccess} from '#db/project-access.js';
import {projectsConnectionResources} from '#db/schema/connection-resources.js';
import {projectsConnectionScopes} from '#db/schema/connection-scopes.js';
import {projectsIntegrationEventDedup} from '#db/schema/integration-event-dedup.js';
import {projectFactory} from '#test/index.js';
import {onProjectDeleted} from './on-project-deleted.js';

const sdk = {
  kind: 'repository',
  externalId: 'github:1',
  lookupName: 'acme/sdk',
  displayName: 'acme/sdk',
};

function deletedEvent(projectId: string): ProjectDeletedEvent {
  return {
    workspaceId: crypto.randomUUID(),
    projectId,
    deletedBy: 'user-1',
    deletedAt: new Date().toISOString(),
  };
}

async function arrange(projectId: string) {
  await db().transaction(async (tx) => {
    await replaceProjectAccess({
      tx,
      projectId,
      access: {
        connectionAccess: 'selected',
        scopes: [{connectionId: crypto.randomUUID(), resources: [sdk]}],
      },
    });
    for (let index = 0; index < 3; index += 1) {
      await recordIntegrationEventForProject({
        tx,
        integrationEventId: crypto.randomUUID(),
        projectId,
      });
    }
  });
}

describe('onProjectDeleted', () => {
  it('deletes the access and the event dedup rows of the project only', async () => {
    const deleted = await projectFactory.create();
    const other = await projectFactory.create();
    await arrange(deleted.id);
    await arrange(other.id);

    await onProjectDeleted(deletedEvent(deleted.id));

    expect(
      await db()
        .select()
        .from(projectsConnectionScopes)
        .where(eq(projectsConnectionScopes.projectId, deleted.id)),
    ).toEqual([]);
    expect(
      await db()
        .select()
        .from(projectsConnectionResources)
        .where(eq(projectsConnectionResources.projectId, deleted.id)),
    ).toEqual([]);
    expect(
      await db()
        .select()
        .from(projectsIntegrationEventDedup)
        .where(eq(projectsIntegrationEventDedup.projectId, deleted.id)),
    ).toEqual([]);
    expect(
      await db()
        .select()
        .from(projectsIntegrationEventDedup)
        .where(eq(projectsIntegrationEventDedup.projectId, other.id)),
    ).toHaveLength(3);
    expect((await loadProjectAccessByIds([other.id])).get(other.id)?.scopes).toHaveLength(1);
  });

  it('is safe to run again', async () => {
    const project = await projectFactory.create();
    await arrange(project.id);

    await onProjectDeleted(deletedEvent(project.id));

    await expect(onProjectDeleted(deletedEvent(project.id))).resolves.toBeUndefined();
  });
});
