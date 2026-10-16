import {randomUUID} from 'node:crypto';
import {
  createClaapInstallation,
  deleteClaapInstallationByConnectionId,
  getClaapInstallationByConnectionId,
  withClaapCredentialVersion,
} from './installations.js';

describe('Claap installations', () => {
  it('stores installation metadata with credential version one', async () => {
    const connectionId = randomUUID();

    const created = await createClaapInstallation({
      connectionId,
      workspaceId: 'workspace-1',
      workspaceName: 'Mercateam',
      keyHint: 'cla_secret_1234',
    });

    expect(created.credentialVersion).toBe(1);
    expect(await getClaapInstallationByConnectionId(connectionId)).toMatchObject({
      connectionId,
      workspaceId: 'workspace-1',
      keyHint: '1234',
    });

    await deleteClaapInstallationByConnectionId(connectionId);
  });

  it('returns not-found when guarding an unknown connection', async () => {
    const result = await withClaapCredentialVersion({
      connectionId: randomUUID(),
      credentialVersion: 1,
      callback: async () => 'unused',
    });

    expect(result).toEqual({matched: false, reason: 'not-found'});
  });

  it('runs the callback only for the matching locked credential version', async () => {
    const connectionId = randomUUID();
    await createClaapInstallation({
      connectionId,
      workspaceId: 'workspace-2',
      workspaceName: 'Mercateam',
      keyHint: '5678',
    });

    const callback = async ({installation}: {installation: {credentialVersion: number}}) =>
      installation.credentialVersion;
    const stale = await withClaapCredentialVersion({
      connectionId,
      credentialVersion: 2,
      callback,
    });
    const current = await withClaapCredentialVersion({
      connectionId,
      credentialVersion: 1,
      callback,
    });

    expect(stale).toEqual({matched: false, reason: 'version-mismatch'});
    expect(current).toEqual({matched: true, value: 1});
    await deleteClaapInstallationByConnectionId(connectionId);
  });
});
