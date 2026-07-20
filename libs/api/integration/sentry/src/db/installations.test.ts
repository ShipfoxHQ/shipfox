import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {SentryInstallationAlreadyLinkedError} from '#core/errors.js';
import {db} from './db.js';
import {
  claimSentryInstallationVerification,
  completeSentryInstallationVerification,
  getSentryInstallationByInstallationUuid,
  listUnclaimedSentryInstallations,
  markSentryInstallationDeleted,
  markSentryInstallationExchangeSucceeded,
  persistVerifiedUnclaimedInstallation,
  pruneUnclaimedSentryInstallations,
  upsertSentryInstallation,
} from './installations.js';
import {sentryInstallations} from './schema/installations.js';

describe('sentry installations persistence', () => {
  beforeEach(async () => {
    await db().delete(sentryInstallations);
  });

  test('upsert updates in place when the same connection reconnects, without duplicating', async () => {
    const installationUuid = randomUUID();
    const connectionId = randomUUID();

    await upsertSentryInstallation({
      connectionId,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });
    const updated = await upsertSentryInstallation({
      connectionId,
      installationUuid,
      orgSlug: 'acme-renamed',
      status: 'installed',
    });

    expect(updated.connectionId).toBe(connectionId);
    expect(updated.orgSlug).toBe('acme-renamed');
    const fetched = await getSentryInstallationByInstallationUuid(installationUuid);
    expect(fetched?.orgSlug).toBe('acme-renamed');
  });

  test('upsert rejects repointing an installation to a different connection (TOCTOU guard)', async () => {
    const installationUuid = randomUUID();
    const firstConnectionId = randomUUID();
    const secondConnectionId = randomUUID();
    await upsertSentryInstallation({
      connectionId: firstConnectionId,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });

    const repoint = upsertSentryInstallation({
      connectionId: secondConnectionId,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });

    await expect(repoint).rejects.toBeInstanceOf(SentryInstallationAlreadyLinkedError);
    const fetched = await getSentryInstallationByInstallationUuid(installationUuid);
    expect(fetched?.connectionId).toBe(firstConnectionId);
  });

  test('upsert claims a verified-unclaimed row by setting connection_id (first claim)', async () => {
    const installationUuid = randomUUID();
    const connectionId = randomUUID();
    await persistVerifiedUnclaimedInstallation({
      installationUuid,
      orgSlug: 'acme',
      codeHash: 'webhook-hash',
    });

    const claimed = await upsertSentryInstallation({
      connectionId,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });

    expect(claimed.connectionId).toBe(connectionId);
    const fetched = await getSentryInstallationByInstallationUuid(installationUuid);
    expect(fetched?.connectionId).toBe(connectionId);
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

  test('markSentryInstallationDeleted creates a tombstone when no row matches', async () => {
    const result = await markSentryInstallationDeleted({installationUuid: 'never-installed'});

    expect(result.status).toBe('deleted');
    expect(result.connectionId).toBeNull();
    expect(result.orgSlug).toBe('');
  });

  test('upsert never restores a deleted tombstone', async () => {
    const installationUuid = randomUUID();
    await markSentryInstallationDeleted({installationUuid});

    const reconnect = upsertSentryInstallation({
      connectionId: randomUUID(),
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });

    await expect(reconnect).rejects.toBeInstanceOf(SentryInstallationAlreadyLinkedError);
    expect((await getSentryInstallationByInstallationUuid(installationUuid))?.status).toBe(
      'deleted',
    );
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

  test('claimSentryInstallationVerification preserves the first pending code', async () => {
    const installationUuid = randomUUID();
    const first = await claimSentryInstallationVerification({
      installationUuid,
      orgSlug: 'acme',
      codeHash: 'hash-1',
    });

    const second = await claimSentryInstallationVerification({
      installationUuid,
      orgSlug: 'other',
      codeHash: 'hash-2',
    });

    expect(first.status).toBe('pending');
    expect(second.status).toBe('pending');
    expect(second.orgSlug).toBe('acme');
    expect(second.codeHash).toBe('hash-1');
  });

  test('verification advances only from a matching pending claim through the exchange checkpoint', async () => {
    const installationUuid = randomUUID();
    await claimSentryInstallationVerification({
      installationUuid,
      orgSlug: 'acme',
      codeHash: 'hash-1',
    });

    const prematureCompletion = await completeSentryInstallationVerification({
      installationUuid,
      codeHash: 'hash-1',
    });
    const mismatch = await markSentryInstallationExchangeSucceeded({
      installationUuid,
      codeHash: 'hash-2',
    });
    const exchanged = await markSentryInstallationExchangeSucceeded({
      installationUuid,
      codeHash: 'hash-1',
    });
    const completed = await completeSentryInstallationVerification({
      installationUuid,
      codeHash: 'hash-1',
    });

    expect(prematureCompletion).toBeUndefined();
    expect(mismatch).toBeUndefined();
    expect(exchanged?.status).toBe('exchange-succeeded');
    expect(completed?.status).toBe('installed');
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

  test('listUnclaimedSentryInstallations returns every non-deleted row with no connection', async () => {
    const claimedUuid = randomUUID();
    const pendingUuid = randomUUID();
    const exchangedUuid = randomUUID();
    const installedUuid = randomUUID();
    await upsertSentryInstallation({
      connectionId: randomUUID(),
      installationUuid: claimedUuid,
      orgSlug: 'acme',
      status: 'installed',
    });
    await claimSentryInstallationVerification({
      installationUuid: pendingUuid,
      orgSlug: 'acme',
      codeHash: 'pending-hash',
    });
    await claimSentryInstallationVerification({
      installationUuid: exchangedUuid,
      orgSlug: 'acme',
      codeHash: 'exchanged-hash',
    });
    await markSentryInstallationExchangeSucceeded({
      installationUuid: exchangedUuid,
      codeHash: 'exchanged-hash',
    });
    await persistVerifiedUnclaimedInstallation({
      installationUuid: installedUuid,
      orgSlug: 'acme',
      codeHash: 'hash',
    });

    const unclaimed = await listUnclaimedSentryInstallations();

    expect(unclaimed.map((row) => row.installationUuid).sort()).toEqual(
      [pendingUuid, exchangedUuid, installedUuid].sort(),
    );
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

  test('pruneUnclaimedSentryInstallations releases stale pending claims', async () => {
    const installationUuid = randomUUID();
    await claimSentryInstallationVerification({
      installationUuid,
      orgSlug: 'acme',
      codeHash: 'stale-hash',
    });

    const result = await pruneUnclaimedSentryInstallations({
      olderThan: new Date(Date.now() + 60_000),
    });
    const reclaimed = await claimSentryInstallationVerification({
      installationUuid,
      orgSlug: 'acme',
      codeHash: 'fresh-hash',
    });

    expect(result).toEqual({releasedPending: 1, tombstoned: 0});
    expect(reclaimed.status).toBe('pending');
    expect(reclaimed.codeHash).toBe('fresh-hash');
  });

  test('pruneUnclaimedSentryInstallations tombstones stale exchanged and installed rows', async () => {
    const exchangedUuid = randomUUID();
    const installedUuid = randomUUID();
    await claimSentryInstallationVerification({
      installationUuid: exchangedUuid,
      orgSlug: 'acme',
      codeHash: 'exchanged-hash',
    });
    await markSentryInstallationExchangeSucceeded({
      installationUuid: exchangedUuid,
      codeHash: 'exchanged-hash',
    });
    await persistVerifiedUnclaimedInstallation({
      installationUuid: installedUuid,
      orgSlug: 'acme',
      codeHash: 'hash',
    });

    const result = await pruneUnclaimedSentryInstallations({
      olderThan: new Date(Date.now() + 60_000),
    });

    expect(result).toEqual({releasedPending: 0, tombstoned: 2});
    expect((await getSentryInstallationByInstallationUuid(exchangedUuid))?.status).toBe('deleted');
    expect((await getSentryInstallationByInstallationUuid(installedUuid))?.status).toBe('deleted');
    expect(await listUnclaimedSentryInstallations()).toHaveLength(0);
  });

  test('completing an old claim starts a fresh installed retention window', async () => {
    const installationUuid = randomUUID();
    const oldTimestamp = new Date(Date.now() - 120_000);
    await claimSentryInstallationVerification({
      installationUuid,
      orgSlug: 'acme',
      codeHash: 'hash',
    });
    await db()
      .update(sentryInstallations)
      .set({createdAt: oldTimestamp, updatedAt: oldTimestamp})
      .where(eq(sentryInstallations.installationUuid, installationUuid));
    await markSentryInstallationExchangeSucceeded({installationUuid, codeHash: 'hash'});
    await completeSentryInstallationVerification({installationUuid, codeHash: 'hash'});

    const result = await pruneUnclaimedSentryInstallations({
      olderThan: new Date(Date.now() - 60_000),
    });

    expect(result).toEqual({releasedPending: 0, tombstoned: 0});
    expect((await getSentryInstallationByInstallationUuid(installationUuid))?.status).toBe(
      'installed',
    );
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
