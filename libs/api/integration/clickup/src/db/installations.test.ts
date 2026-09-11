import {
  deleteClickUpInstallationByConnectionId,
  getClickUpInstallationByConnectionId,
  getClickUpInstallationByTeamId,
  upsertClickUpInstallation,
  withClickUpInstallationLock,
} from './installations.js';

function input(overrides: Partial<Parameters<typeof upsertClickUpInstallation>[0]> = {}) {
  return {
    connectionId: crypto.randomUUID(),
    teamId: `team-${crypto.randomUUID()}`,
    teamName: 'Acme',
    authorizingUserId: `user-${crypto.randomUUID()}`,
    webhookId: 'webhook-id',
    status: 'installed' as const,
    ...overrides,
  };
}

describe('ClickUp installations', () => {
  it('persists and maps an installation by connection and team', async () => {
    const installation = await upsertClickUpInstallation(input());

    await expect(
      getClickUpInstallationByConnectionId(installation.connectionId),
    ).resolves.toMatchObject(installation);
    await expect(getClickUpInstallationByTeamId(installation.teamId)).resolves.toMatchObject(
      installation,
    );
  });

  it('refreshes installation metadata for the same connection and team', async () => {
    const initial = input();
    await upsertClickUpInstallation(initial);

    const refreshed = await upsertClickUpInstallation({
      ...initial,
      teamName: 'Updated Acme',
      authorizingUserId: 'updated-user',
      webhookId: 'updated-webhook-id',
    });

    expect(refreshed).toMatchObject({
      connectionId: initial.connectionId,
      teamId: initial.teamId,
      teamName: 'Updated Acme',
      authorizingUserId: 'updated-user',
      webhookId: 'updated-webhook-id',
      status: 'installed',
    });
  });

  it('deletes an installation by connection', async () => {
    const installation = await upsertClickUpInstallation(input());

    await expect(deleteClickUpInstallationByConnectionId(installation.connectionId)).resolves.toBe(
      true,
    );
    await expect(getClickUpInstallationByTeamId(installation.teamId)).resolves.toBeUndefined();
  });

  it('serializes work for the same ClickUp workspace', async () => {
    const events: string[] = [];
    let resolveFirstLockAcquired: () => void = () => undefined;
    const firstLockAcquired = new Promise<void>((resolve) => {
      resolveFirstLockAcquired = resolve;
    });
    const first = withClickUpInstallationLock('same-team', async () => {
      resolveFirstLockAcquired();
      events.push('first-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push('first-end');
    });
    await Promise.race([firstLockAcquired, first]);
    const second = withClickUpInstallationLock('same-team', () => {
      events.push('second-start');
      return Promise.resolve();
    });

    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });
});
