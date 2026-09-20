import {randomUUID} from 'node:crypto';
import {
  deletePosthogInstallationByConnectionId,
  getPosthogInstallationByConnectionId,
  upsertPosthogInstallation,
  withPosthogCredentialVersion,
} from './installations.js';

describe('PostHog installations', () => {
  it('stores installation metadata with credential version one', async () => {
    const connectionId = randomUUID();

    const created = await upsertPosthogInstallation({
      connectionId,
      projectId: 'project-1',
      projectName: 'Analytics',
      organizationId: 'organization-1',
      keyHint: '1234',
    });

    expect(created.credentialVersion).toBe(1);
    expect(await getPosthogInstallationByConnectionId(connectionId)).toMatchObject({
      connectionId,
      projectId: 'project-1',
      keyHint: '1234',
    });

    await deletePosthogInstallationByConnectionId(connectionId);
  });

  it('runs the callback only for the matching locked credential version', async () => {
    const connectionId = randomUUID();
    await upsertPosthogInstallation({
      connectionId,
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
