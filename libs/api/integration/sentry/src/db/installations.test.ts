import {randomUUID} from 'node:crypto';
import {db} from './db.js';
import {
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
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
});
