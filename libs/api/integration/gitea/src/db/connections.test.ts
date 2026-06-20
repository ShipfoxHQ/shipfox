import {randomUUID} from 'node:crypto';
import {GiteaOrgAlreadyLinkedError} from '#core/errors.js';
import {
  getGiteaConnectionByConnectionId,
  getGiteaConnectionByOrg,
  type UpsertGiteaConnectionParams,
  upsertGiteaConnection,
} from './connections.js';
import {db} from './db.js';
import {giteaConnections} from './schema/connections.js';

function connectionParams(
  overrides: Partial<UpsertGiteaConnectionParams> = {},
): UpsertGiteaConnectionParams {
  return {
    connectionId: randomUUID(),
    org: `org-${Math.floor(Math.random() * 1_000_000)}`,
    webhookId: '1',
    ...overrides,
  };
}

describe('gitea connections persistence', () => {
  beforeEach(async () => {
    await db().delete(giteaConnections);
  });

  test('upsert updates in place when the same connection reconnects, without duplicating', async () => {
    const org = `org-${Date.now()}`;
    const connectionId = randomUUID();
    await upsertGiteaConnection(connectionParams({connectionId, org, webhookId: '1'}));

    const updated = await upsertGiteaConnection(
      connectionParams({connectionId, org, webhookId: '2'}),
    );

    expect(updated.connectionId).toBe(connectionId);
    expect(updated.webhookId).toBe('2');
    const fetched = await getGiteaConnectionByOrg(org);
    expect(fetched?.webhookId).toBe('2');
  });

  test('upsert rejects linking an org already owned by another connection (TOCTOU guard)', async () => {
    const org = `org-${Date.now()}`;
    const firstConnectionId = randomUUID();
    const secondConnectionId = randomUUID();
    await upsertGiteaConnection(connectionParams({connectionId: firstConnectionId, org}));

    const takeover = upsertGiteaConnection(
      connectionParams({connectionId: secondConnectionId, org}),
    );

    await expect(takeover).rejects.toBeInstanceOf(GiteaOrgAlreadyLinkedError);
    const fetched = await getGiteaConnectionByOrg(org);
    expect(fetched?.connectionId).toBe(firstConnectionId);
  });

  test('getGiteaConnectionByConnectionId returns the row for a known connection', async () => {
    const connectionId = randomUUID();
    const org = `org-${Date.now()}`;
    await upsertGiteaConnection(connectionParams({connectionId, org}));

    const fetched = await getGiteaConnectionByConnectionId(connectionId);

    expect(fetched?.org).toBe(org);
  });

  test('getGiteaConnectionByOrg returns undefined for a miss', async () => {
    const result = await getGiteaConnectionByOrg('missing');

    expect(result).toBeUndefined();
  });
});
