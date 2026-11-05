import {randomUUID} from 'node:crypto';
import {AzureDevOpsOrganizationAlreadyLinkedError} from '#core/errors.js';
import {
  deleteAzureDevOpsConnectionByConnectionId,
  getAzureDevOpsConnectionByConnectionId,
  getAzureDevOpsConnectionByOrganization,
  upsertAzureDevOpsConnection,
} from './connections.js';
import {db} from './db.js';
import {azureDevOpsConnections} from './schema/connections.js';

describe('azure devops connections persistence', () => {
  beforeEach(async () => {
    await db().delete(azureDevOpsConnections);
  });

  test('upsert stores a connection that can be found by organization and connection id', async () => {
    const connectionId = randomUUID();
    await upsertAzureDevOpsConnection({
      connectionId,
      organization: 'contoso',
      webhookUsername: 'shipfox-1',
    });

    expect((await getAzureDevOpsConnectionByOrganization('contoso'))?.connectionId).toBe(
      connectionId,
    );
    expect((await getAzureDevOpsConnectionByConnectionId(connectionId))?.webhookUsername).toBe(
      'shipfox-1',
    );
  });

  test('reconnecting the same connection keeps its webhook user name, in place', async () => {
    const connectionId = randomUUID();
    await upsertAzureDevOpsConnection({
      connectionId,
      organization: 'contoso',
      webhookUsername: 'a',
    });

    const updated = await upsertAzureDevOpsConnection({
      connectionId,
      organization: 'contoso',
      webhookUsername: 'b',
    });

    expect(updated.webhookUsername).toBe('a');
    expect(await db().select().from(azureDevOpsConnections)).toHaveLength(1);
  });

  test('refuses to re-point an organization owned by another connection', async () => {
    await upsertAzureDevOpsConnection({
      connectionId: randomUUID(),
      organization: 'contoso',
      webhookUsername: 'a',
    });

    await expect(
      upsertAzureDevOpsConnection({
        connectionId: randomUUID(),
        organization: 'contoso',
        webhookUsername: 'b',
      }),
    ).rejects.toBeInstanceOf(AzureDevOpsOrganizationAlreadyLinkedError);
  });

  test('deletes the row of one connection', async () => {
    const connectionId = randomUUID();
    await upsertAzureDevOpsConnection({
      connectionId,
      organization: 'contoso',
      webhookUsername: 'a',
    });

    await deleteAzureDevOpsConnectionByConnectionId(connectionId);

    expect(await getAzureDevOpsConnectionByConnectionId(connectionId)).toBeUndefined();
  });
});
