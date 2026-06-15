import {randomUUID} from 'node:crypto';
import {db} from './db.js';
import {
  getSentryInstallationByInstallationUuid,
  listUnclaimedSentryInstallations,
  markSentryInstallationDeleted,
  persistVerifiedUnclaimedInstallation,
  pruneUnclaimedSentryInstallations,
  upsertSentryInstallation,
} from './installations.js';
import {sentryInstallations} from './schema/installations.js';

describe('sentry installations persistence', () => {
  beforeEach(async () => {
    await db().delete(sentryInstallations);
  });

  test('upsert inserts then updates on conflicting installation_uuid without duplicating', async () => {
    const installationUuid = randomUUID();
    const firstConnectionId = randomUUID();
    const secondConnectionId = randomUUID();

    await upsertSentryInstallation({
      connectionId: firstConnectionId,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });
    const updated = await upsertSentryInstallation({
      connectionId: secondConnectionId,
      installationUuid,
      orgSlug: 'acme-renamed',
      status: 'installed',
    });

    expect(updated.connectionId).toBe(secondConnectionId);
    expect(updated.orgSlug).toBe('acme-renamed');
    const fetched = await getSentryInstallationByInstallationUuid(installationUuid);
    expect(fetched?.orgSlug).toBe('acme-renamed');
  });

  test('markSentryInstallationDeleted sets status and returns the updated row', async () => {
    const installationUuid = randomUUID();
    const connectionId = randomUUID();
    await upsertSentryInstallation({
      connectionId,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });

    const deleted = await markSentryInstallationDeleted({installationUuid});

    expect(deleted?.status).toBe('deleted');
    expect(deleted?.connectionId).toBe(connectionId);
  });

  test('markSentryInstallationDeleted returns undefined when no row matches', async () => {
    const result = await markSentryInstallationDeleted({installationUuid: 'never-installed'});

    expect(result).toBeUndefined();
  });

  test('getSentryInstallationByInstallationUuid returns undefined for a miss', async () => {
    const result = await getSentryInstallationByInstallationUuid('missing');

    expect(result).toBeUndefined();
  });

  test('persistVerifiedUnclaimedInstallation inserts an unclaimed row with a code hash', async () => {
    const installationUuid = randomUUID();

    const persisted = await persistVerifiedUnclaimedInstallation({
      installationUuid,
      orgSlug: 'acme',
      codeHash: 'hash-1',
    });

    expect(persisted.connectionId).toBeNull();
    expect(persisted.status).toBe('installed');
    expect(persisted.codeHash).toBe('hash-1');
  });

  test('persistVerifiedUnclaimedInstallation never clobbers a claimed connection or downgrades status', async () => {
    const installationUuid = randomUUID();
    const connectionId = randomUUID();
    await upsertSentryInstallation({
      connectionId,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
      codeHash: 'claimed-hash',
    });

    const reconciled = await persistVerifiedUnclaimedInstallation({
      installationUuid,
      orgSlug: 'acme-renamed',
      codeHash: 'webhook-hash',
    });

    // A late webhook refreshes the slug/hash but leaves the claim intact.
    expect(reconciled.connectionId).toBe(connectionId);
    expect(reconciled.status).toBe('installed');
    expect(reconciled.orgSlug).toBe('acme-renamed');
    expect(reconciled.codeHash).toBe('webhook-hash');
  });

  test('listUnclaimedSentryInstallations returns only rows with no connection', async () => {
    const claimedUuid = randomUUID();
    const unclaimedUuid = randomUUID();
    await upsertSentryInstallation({
      connectionId: randomUUID(),
      installationUuid: claimedUuid,
      orgSlug: 'acme',
      status: 'installed',
    });
    await persistVerifiedUnclaimedInstallation({
      installationUuid: unclaimedUuid,
      orgSlug: 'acme',
      codeHash: 'hash',
    });

    const unclaimed = await listUnclaimedSentryInstallations();

    expect(unclaimed.map((row) => row.installationUuid)).toEqual([unclaimedUuid]);
  });

  test('listUnclaimedSentryInstallations filters by age when olderThan is given', async () => {
    const unclaimedUuid = randomUUID();
    await persistVerifiedUnclaimedInstallation({
      installationUuid: unclaimedUuid,
      orgSlug: 'acme',
      codeHash: 'hash',
    });

    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    expect(await listUnclaimedSentryInstallations({olderThan: future})).toHaveLength(1);
    expect(await listUnclaimedSentryInstallations({olderThan: past})).toHaveLength(0);
  });

  test('pruneUnclaimedSentryInstallations tombstones stale unclaimed rows and leaves fresh ones', async () => {
    const staleUuid = randomUUID();
    await persistVerifiedUnclaimedInstallation({
      installationUuid: staleUuid,
      orgSlug: 'acme',
      codeHash: 'hash',
    });

    const youngResult = await pruneUnclaimedSentryInstallations({
      olderThan: new Date(Date.now() - 60_000),
    });
    expect(youngResult.tombstoned).toBe(0);

    const staleResult = await pruneUnclaimedSentryInstallations({
      olderThan: new Date(Date.now() + 60_000),
    });
    expect(staleResult.tombstoned).toBe(1);
    expect((await getSentryInstallationByInstallationUuid(staleUuid))?.status).toBe('deleted');
    expect(await listUnclaimedSentryInstallations()).toHaveLength(0);
  });

  test('pruneUnclaimedSentryInstallations never tombstones a claimed install', async () => {
    const claimedUuid = randomUUID();
    await upsertSentryInstallation({
      connectionId: randomUUID(),
      installationUuid: claimedUuid,
      orgSlug: 'acme',
      status: 'installed',
    });

    const result = await pruneUnclaimedSentryInstallations({
      olderThan: new Date(Date.now() + 60_000),
    });

    expect(result.tombstoned).toBe(0);
    expect((await getSentryInstallationByInstallationUuid(claimedUuid))?.status).toBe('installed');
  });
});
