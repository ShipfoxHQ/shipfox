import {randomUUID} from 'node:crypto';
import {insertConnection, truncateIntegrationsState} from '#test/fixtures/core-fixtures.js';
import {
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
  upsertSentryInstallation,
} from './installations.js';

describe('sentry installations persistence', () => {
  beforeEach(async () => {
    await truncateIntegrationsState();
  });

  test('upsert inserts then updates on conflicting installation_uuid without duplicating', async () => {
    const installationUuid = randomUUID();
    const first = await insertConnection({externalAccountId: installationUuid});
    const second = await insertConnection({externalAccountId: `${installationUuid}-2`});

    await upsertSentryInstallation({
      connectionId: first.id,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });
    const updated = await upsertSentryInstallation({
      connectionId: second.id,
      installationUuid,
      orgSlug: 'acme-renamed',
      status: 'installed',
    });

    expect(updated.connectionId).toBe(second.id);
    expect(updated.orgSlug).toBe('acme-renamed');
    const fetched = await getSentryInstallationByInstallationUuid(installationUuid);
    expect(fetched?.orgSlug).toBe('acme-renamed');
  });

  test('markSentryInstallationDeleted sets status and returns the updated row', async () => {
    const installationUuid = randomUUID();
    const connection = await insertConnection({externalAccountId: installationUuid});
    await upsertSentryInstallation({
      connectionId: connection.id,
      installationUuid,
      orgSlug: 'acme',
      status: 'installed',
    });

    const deleted = await markSentryInstallationDeleted({installationUuid});

    expect(deleted?.status).toBe('deleted');
    expect(deleted?.connectionId).toBe(connection.id);
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
