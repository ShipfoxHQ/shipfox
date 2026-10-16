import {randomUUID} from 'node:crypto';
import {
  createJamInstallation,
  deleteJamInstallationByConnectionId,
  getJamInstallationByConnectionId,
  updateJamInstallationCredential,
  withJamCredentialVersion,
} from './installations.js';

describe('Jam installations', () => {
  it('stores installation metadata with credential version one and a four character hint', async () => {
    const connectionId = randomUUID();

    const created = await createJamInstallation({
      connectionId,
      teamId: 'team-1',
      userId: 'user-1',
      userName: 'Ada',
      userEmail: null,
      token: 'jam_pat_secret_1234',
    });

    expect(created.credentialVersion).toBe(1);
    expect(await getJamInstallationByConnectionId(connectionId)).toMatchObject({
      connectionId,
      teamId: 'team-1',
      userId: 'user-1',
      userName: 'Ada',
      userEmail: null,
      tokenHint: '1234',
    });

    await deleteJamInstallationByConnectionId(connectionId);
  });

  it('returns not-found when guarding an unknown connection', async () => {
    const result = await withJamCredentialVersion({
      connectionId: randomUUID(),
      credentialVersion: 1,
      callback: async () => 'unused',
    });

    expect(result).toEqual({matched: false, reason: 'not-found'});
  });

  it('runs the callback only for the matching locked credential version', async () => {
    const connectionId = randomUUID();
    await createJamInstallation({
      connectionId,
      teamId: 'team-2',
      userId: 'user-2',
      userName: 'Grace',
      userEmail: 'grace@example.com',
      token: 'jam_pat_5678',
    });

    const callback = async ({installation}: {installation: {credentialVersion: number}}) =>
      installation.credentialVersion;
    const stale = await withJamCredentialVersion({connectionId, credentialVersion: 2, callback});
    const current = await withJamCredentialVersion({connectionId, credentialVersion: 1, callback});

    expect(stale).toEqual({matched: false, reason: 'version-mismatch'});
    expect(current).toEqual({matched: true, value: 1});
    await deleteJamInstallationByConnectionId(connectionId);
  });

  it('updates the user, hint and version on a credential replacement', async () => {
    const connectionId = randomUUID();
    await createJamInstallation({
      connectionId,
      teamId: 'team-3',
      userId: 'user-3',
      userName: 'Ada',
      userEmail: 'ada@example.com',
      token: 'jam_pat_aaaa',
    });

    const updated = await withJamCredentialVersion({
      connectionId,
      credentialVersion: 1,
      callback: ({tx}) =>
        updateJamInstallationCredential({
          connectionId,
          token: 'jam_pat_bbbb',
          userId: 'user-4',
          userName: 'Grace',
          userEmail: null,
          credentialVersion: 2,
          tx,
        }),
    });

    expect(updated).toMatchObject({
      matched: true,
      value: {
        teamId: 'team-3',
        userId: 'user-4',
        userName: 'Grace',
        userEmail: null,
        tokenHint: 'bbbb',
        credentialVersion: 2,
      },
    });
    await deleteJamInstallationByConnectionId(connectionId);
  });
});
