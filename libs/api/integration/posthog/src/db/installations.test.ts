import {randomUUID} from 'node:crypto';
import {
  createPosthogInstallation,
  deletePosthogInstallationByConnectionId,
  getPosthogInstallationByConnectionId,
  withPosthogCredentialVersion,
} from './installations.js';

describe('PostHog installations', () => {
  it('stores installation metadata with credential version one', async () => {
    const connectionId = randomUUID();

    const created = await createPosthogInstallation({
      connectionId,
      region: 'eu',
      projectId: 'project-1',
      projectName: 'Analytics',
      organizationId: 'organization-1',
      keyHint: 'phx_secret_1234',
    });

    expect(created.credentialVersion).toBe(1);
    expect(await getPosthogInstallationByConnectionId(connectionId)).toMatchObject({
      connectionId,
      region: 'eu',
      projectId: 'project-1',
      keyHint: '1234',
    });

    await deletePosthogInstallationByConnectionId(connectionId);
  });

  it('returns not-found when guarding an unknown connection', async () => {
    const result = await withPosthogCredentialVersion({
      connectionId: randomUUID(),
      credentialVersion: 1,
      callback: async () => 'unused',
    });

    expect(result).toEqual({matched: false, reason: 'not-found'});
  });

  it('runs the callback only for the matching locked credential version', async () => {
    const connectionId = randomUUID();
    await createPosthogInstallation({
      connectionId,
      region: 'us',
      projectId: 'project-2',
      projectName: 'Analytics',
      organizationId: 'organization-2',
      keyHint: '5678',
    });

    const callback = async ({installation}: {installation: {credentialVersion: number}}) =>
      installation.credentialVersion;
    const stale = await withPosthogCredentialVersion({
      connectionId,
      credentialVersion: 2,
      callback,
    });
    const current = await withPosthogCredentialVersion({
      connectionId,
      credentialVersion: 1,
      callback,
    });

    expect(stale).toEqual({matched: false, reason: 'version-mismatch'});
    expect(current).toEqual({matched: true, value: 1});
    await deletePosthogInstallationByConnectionId(connectionId);
  });
});
