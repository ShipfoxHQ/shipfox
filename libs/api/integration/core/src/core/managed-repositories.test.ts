import {INTEGRATION_CONNECTION_AVAILABLE} from '@shipfox/api-integration-core-dto';
import {eq} from 'drizzle-orm';
import {getIntegrationConnectionById, listIntegrationConnections} from '#db/connections.js';
import {db} from '#db/db.js';
import {integrationsOutbox} from '#db/schema/outbox.js';
import {ManagedProjectConflictError, ManagedSeedFileRefusedError} from './errors.js';
import {
  createManagedProjectRepository,
  deleteManagedProjectRepository,
} from './managed-repositories.js';

const WORKFLOW = '.shipfox/workflows/triage.yml';

describe('createManagedProjectRepository', () => {
  it('creates the hidden connection on first use and shares it afterward', async () => {
    const workspaceId = crypto.randomUUID();

    const first = await createManagedProjectRepository({
      workspaceId,
      projectId: crypto.randomUUID(),
    });
    const second = await createManagedProjectRepository({
      workspaceId,
      projectId: crypto.randomUUID(),
    });

    expect(second.connectionId).toBe(first.connectionId);
    expect(second.externalRepositoryId).not.toBe(first.externalRepositoryId);
    const connection = await getIntegrationConnectionById(first.connectionId);
    expect(connection).toMatchObject({
      workspaceId,
      provider: 'managed-vcs',
      externalAccountId: workspaceId,
      slug: 'shipfox-managed',
      lifecycleStatus: 'active',
    });
    expect(await listIntegrationConnections({workspaceId})).toHaveLength(1);
  });

  it('announces no available connection', async () => {
    const workspaceId = crypto.randomUUID();

    const {connectionId} = await createManagedProjectRepository({
      workspaceId,
      projectId: crypto.randomUUID(),
    });

    const events = await db()
      .select({id: integrationsOutbox.id, type: integrationsOutbox.eventType})
      .from(integrationsOutbox)
      .where(eq(integrationsOutbox.orderingKey, connectionId));
    expect(events.filter((event) => event.type === INTEGRATION_CONNECTION_AVAILABLE)).toEqual([]);
  });

  it('is idempotent on the project', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    const first = await createManagedProjectRepository({workspaceId, projectId});
    const second = await createManagedProjectRepository({workspaceId, projectId});

    expect(second).toEqual(first);
  });

  it('shares one connection when two projects start together', async () => {
    const workspaceId = crypto.randomUUID();

    const results = await Promise.all([
      createManagedProjectRepository({workspaceId, projectId: crypto.randomUUID()}),
      createManagedProjectRepository({workspaceId, projectId: crypto.randomUUID()}),
    ]);

    expect(results[0].connectionId).toBe(results[1].connectionId);
  });

  it('reports a refused seed file as a typed error', async () => {
    const attempt = createManagedProjectRepository({
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      files: [{path: 'src/index.ts', content: 'x'}],
    });

    await expect(attempt).rejects.toBeInstanceOf(ManagedSeedFileRefusedError);
  });

  it('reports a project that belongs to another workspace', async () => {
    const projectId = crypto.randomUUID();
    await createManagedProjectRepository({workspaceId: crypto.randomUUID(), projectId});

    const attempt = createManagedProjectRepository({workspaceId: crypto.randomUUID(), projectId});

    await expect(attempt).rejects.toBeInstanceOf(ManagedProjectConflictError);
  });

  it('deletes the repository and keeps the connection', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const {connectionId} = await createManagedProjectRepository({
      workspaceId,
      projectId,
      files: [{path: WORKFLOW, content: 'name: Triage\n'}],
    });

    const deleted = await deleteManagedProjectRepository({workspaceId, projectId});

    expect(deleted).toBe(true);
    expect(await getIntegrationConnectionById(connectionId)).toBeDefined();
  });
});
