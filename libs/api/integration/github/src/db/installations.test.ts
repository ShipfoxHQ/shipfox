import {randomUUID} from 'node:crypto';
import {GithubInstallationAlreadyLinkedError} from '#core/errors.js';
import {db} from './db.js';
import {
  getGithubInstallationByInstallationId,
  type UpsertGithubInstallationParams,
  upsertGithubInstallation,
} from './installations.js';
import {githubInstallations} from './schema/installations.js';

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

  test('getGithubInstallationByInstallationId returns undefined for a miss', async () => {
    const result = await getGithubInstallationByInstallationId('missing');

    expect(result).toBeUndefined();
  });
});
