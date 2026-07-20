import {randomUUID} from 'node:crypto';
import {db} from '#db/db.js';
import {getSentryInstallationByInstallationUuid} from '#db/installations.js';
import {sentryInstallations} from '#db/schema/installations.js';
import {pruneUnclaimedSentryInstallationsActivity} from './prune-unclaimed-installations.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// The activity derives its cutoff from SENTRY_UNCLAIMED_INSTALLATION_RETENTION_DAYS
// (default 7), so rows are seeded with an explicit updatedAt to straddle it.
describe('pruneUnclaimedSentryInstallationsActivity', () => {
  beforeEach(async () => {
    await db().delete(sentryInstallations);
  });

  test('tombstones unclaimed installs older than the retention window', async () => {
    const staleUuid = randomUUID();
    await db()
      .insert(sentryInstallations)
      .values({
        connectionId: null,
        installationUuid: staleUuid,
        orgSlug: 'acme',
        status: 'installed',
        createdAt: new Date(Date.now() - 8 * DAY_MS),
        updatedAt: new Date(Date.now() - 8 * DAY_MS),
      });

    const result = await pruneUnclaimedSentryInstallationsActivity();

    expect(result.tombstoned).toBe(1);
    expect(result.releasedPending).toBe(0);
    expect((await getSentryInstallationByInstallationUuid(staleUuid))?.status).toBe('deleted');
  });

  test('leaves unclaimed installs within the retention window untouched', async () => {
    const freshUuid = randomUUID();
    await db().insert(sentryInstallations).values({
      connectionId: null,
      installationUuid: freshUuid,
      orgSlug: 'acme',
      status: 'installed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await pruneUnclaimedSentryInstallationsActivity();

    expect(result.tombstoned).toBe(0);
    expect(result.releasedPending).toBe(0);
    expect((await getSentryInstallationByInstallationUuid(freshUuid))?.status).toBe('installed');
  });

  test('releases pending claims older than the retention window', async () => {
    const staleUuid = randomUUID();
    await db()
      .insert(sentryInstallations)
      .values({
        connectionId: null,
        installationUuid: staleUuid,
        orgSlug: 'acme',
        status: 'pending',
        codeHash: 'hash',
        createdAt: new Date(Date.now() - 8 * DAY_MS),
        updatedAt: new Date(Date.now() - 8 * DAY_MS),
      });

    const result = await pruneUnclaimedSentryInstallationsActivity();
    const installation = await getSentryInstallationByInstallationUuid(staleUuid);

    expect(result).toEqual({releasedPending: 1, tombstoned: 0});
    expect(installation).toBeUndefined();
  });
});
