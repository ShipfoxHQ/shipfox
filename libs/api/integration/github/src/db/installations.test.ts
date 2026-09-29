import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {GithubInstallationAlreadyLinkedError} from '#core/errors.js';
import {db} from './db.js';
import {
  deleteGithubInstallationByConnectionId,
  getGithubInstallationByInstallationId,
  type UpsertGithubInstallationParams,
  upsertGithubInstallation,
} from './installations.js';
import {githubInstallations} from './schema/installations.js';
import {githubUnlinkedInstallations} from './schema/unlinked-installations.js';
import {
  countStaleGithubUnlinkedInstallations,
  upsertGithubUnlinkedInstallation,
} from './unlinked-installations.js';

function installationParams(
  overrides: Partial<UpsertGithubInstallationParams> = {},
): UpsertGithubInstallationParams {
  return {
    connectionId: randomUUID(),
    installationId: `${Math.floor(Math.random() * 1_000_000)}`,
    accountLogin: 'shipfox',
    accountType: 'Organization',
    repositorySelection: 'all',
    latestEvent: {id: 1},
    ...overrides,
  };
}

describe('github installations persistence', () => {
  beforeEach(async () => {
    await db().delete(githubUnlinkedInstallations);
    await db().delete(githubInstallations);
  });

  test('upsert updates in place when the same connection reconnects, without duplicating', async () => {
    const installationId = `${Date.now()}`;
    const connectionId = randomUUID();
    await upsertGithubInstallation(installationParams({connectionId, installationId}));

    const updated = await upsertGithubInstallation(
      installationParams({connectionId, installationId, accountLogin: 'shipfox-renamed'}),
    );

    expect(updated.connectionId).toBe(connectionId);
    expect(updated.accountLogin).toBe('shipfox-renamed');
    const fetched = await getGithubInstallationByInstallationId(installationId);
    expect(fetched?.accountLogin).toBe('shipfox-renamed');
  });

  test('upsert rejects repointing an installation to a different connection (TOCTOU guard)', async () => {
    const installationId = `${Date.now()}`;
    const firstConnectionId = randomUUID();
    const secondConnectionId = randomUUID();
    await upsertGithubInstallation(
      installationParams({connectionId: firstConnectionId, installationId}),
    );

    const repoint = upsertGithubInstallation(
      installationParams({connectionId: secondConnectionId, installationId}),
    );

    await expect(repoint).rejects.toBeInstanceOf(GithubInstallationAlreadyLinkedError);
    const fetched = await getGithubInstallationByInstallationId(installationId);
    expect(fetched?.connectionId).toBe(firstConnectionId);
  });

  test('upserts lifecycle details while retaining the first-seen timestamp', async () => {
    const installationId = `${Date.now()}`;
    await upsertGithubUnlinkedInstallation({
      installationId,
      accountLogin: 'shipfox',
      accountType: 'Organization',
      repositorySelection: 'selected',
      senderLogin: 'octocat',
      lastAction: 'created',
    });
    const [first] = await db()
      .select()
      .from(githubUnlinkedInstallations)
      .where(eq(githubUnlinkedInstallations.installationId, installationId));

    await upsertGithubUnlinkedInstallation({
      installationId,
      accountLogin: 'shipfox-renamed',
      accountType: 'Organization',
      repositorySelection: 'all',
      requesterLogin: 'member',
      lastAction: 'new_permissions_accepted',
    });
    const [updated] = await db()
      .select()
      .from(githubUnlinkedInstallations)
      .where(eq(githubUnlinkedInstallations.installationId, installationId));

    expect(updated).toMatchObject({
      installationId,
      accountLogin: 'shipfox-renamed',
      repositorySelection: 'all',
      senderLogin: null,
      requesterLogin: 'member',
      lastAction: 'new_permissions_accepted',
    });
    expect(updated?.firstSeenAt).toEqual(first?.firstSeenAt);
  });

  test('deletes an installation by connection', async () => {
    const installation = installationParams();
    await upsertGithubInstallation(installation);

    await expect(deleteGithubInstallationByConnectionId(installation.connectionId)).resolves.toBe(
      true,
    );
    await expect(getGithubInstallationByInstallationId(installation.installationId)).resolves.toBe(
      undefined,
    );
  });

  test('deletes an unlinked record when an installation is linked', async () => {
    const installation = installationParams();
    await upsertGithubUnlinkedInstallation({
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      lastAction: 'created',
    });

    await upsertGithubInstallation(installation);

    expect(
      await db()
        .select()
        .from(githubUnlinkedInstallations)
        .where(eq(githubUnlinkedInstallations.installationId, installation.installationId)),
    ).toHaveLength(0);
  });

  test('counts only stale installations that are still unlinked', async () => {
    const staleInstallationId = `${Date.now()}`;
    const linkedInstallationId = `${Date.now() + 1}`;
    const firstSeenAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    await upsertGithubInstallation(installationParams({installationId: linkedInstallationId}));
    await db()
      .insert(githubUnlinkedInstallations)
      .values([
        {
          installationId: staleInstallationId,
          accountLogin: 'orphan',
          accountType: 'Organization',
          repositorySelection: 'all',
          lastAction: 'created',
          firstSeenAt,
          lastSeenAt: firstSeenAt,
        },
        {
          installationId: linkedInstallationId,
          accountLogin: 'linked',
          accountType: 'Organization',
          repositorySelection: 'all',
          lastAction: 'created',
          firstSeenAt,
          lastSeenAt: firstSeenAt,
        },
      ]);

    await expect(countStaleGithubUnlinkedInstallations()).resolves.toBe(1);
  });

  test('getGithubInstallationByInstallationId returns undefined for a miss', async () => {
    const result = await getGithubInstallationByInstallationId('missing');

    expect(result).toBeUndefined();
  });
});
