import {randomUUID} from 'node:crypto';
import {sql} from 'drizzle-orm';
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
    await db().delete(githubInstallations);
    await db().delete(githubUnlinkedInstallations);
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

  test('upserts an unlinked installation and preserves its first-seen time', async () => {
    const installationId = `${Date.now()}`;
    await upsertGithubUnlinkedInstallation({
      installationId,
      accountLogin: 'shipfox',
      accountType: 'Organization',
      repositorySelection: 'all',
      senderLogin: 'octocat',
      requesterLogin: null,
      lastAction: 'created',
    });
    const [first] = await db()
      .select()
      .from(githubUnlinkedInstallations)
      .where(sql`${githubUnlinkedInstallations.installationId} = ${installationId}`);

    await upsertGithubUnlinkedInstallation({
      installationId,
      accountLogin: 'shipfox-renamed',
      accountType: 'Organization',
      repositorySelection: 'selected',
      senderLogin: 'octocat',
      requesterLogin: 'member',
      lastAction: 'unsuspend',
    });
    const rows = await db()
      .select()
      .from(githubUnlinkedInstallations)
      .where(sql`${githubUnlinkedInstallations.installationId} = ${installationId}`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountLogin: 'shipfox-renamed',
      repositorySelection: 'selected',
      requesterLogin: 'member',
      lastAction: 'unsuspend',
      firstSeenAt: first?.firstSeenAt,
    });
    expect(rows[0]?.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first?.lastSeenAt.getTime() ?? 0);
  });

  test('deletes an unlinked record when an installation is linked', async () => {
    const installation = installationParams();
    await upsertGithubUnlinkedInstallation({
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      senderLogin: 'octocat',
      requesterLogin: null,
      lastAction: 'created',
    });

    await upsertGithubInstallation(installation);

    await expect(db().select().from(githubUnlinkedInstallations)).resolves.toHaveLength(0);
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

  test('the stale gauge ignores a linked installation record', async () => {
    const installation = installationParams();
    await upsertGithubInstallation(installation);
    await db().insert(githubUnlinkedInstallations).values({
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      senderLogin: null,
      requesterLogin: null,
      lastAction: 'created',
      firstSeenAt: sql`now() - interval '2 hours'`,
      lastSeenAt: sql`now() - interval '2 hours'`,
    });

    await expect(countStaleGithubUnlinkedInstallations()).resolves.toBe(0);
  });

  test('counts an old installation with no link', async () => {
    const installation = installationParams();
    await db().insert(githubUnlinkedInstallations).values({
      installationId: installation.installationId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      repositorySelection: installation.repositorySelection,
      senderLogin: null,
      requesterLogin: null,
      lastAction: 'created',
      firstSeenAt: sql`now() - interval '2 hours'`,
      lastSeenAt: sql`now() - interval '2 hours'`,
    });

    await expect(countStaleGithubUnlinkedInstallations()).resolves.toBe(1);
  });

  test('getGithubInstallationByInstallationId returns undefined for a miss', async () => {
    const result = await getGithubInstallationByInstallationId('missing');

    expect(result).toBeUndefined();
  });
});
