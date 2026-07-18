import {
  SlackConnectionAlreadyLinkedError,
  SlackInstallationAlreadyLinkedError,
} from '#core/errors.js';
import {
  getSlackInstallationByConnectionId,
  getSlackInstallationByTeamId,
  markSlackInstallationRevoked,
  upsertSlackInstallation,
} from './installations.js';

function createInstallationInput(
  overrides: Partial<Parameters<typeof upsertSlackInstallation>[0]> = {},
) {
  return {
    connectionId: crypto.randomUUID(),
    teamId: `T${crypto.randomUUID()}`,
    teamName: 'Acme',
    appId: 'A123',
    botUserId: 'U123',
    scopes: ['app_mentions:read'],
    status: 'installed' as const,
    ...overrides,
  };
}

describe('slack installations', () => {
  it('upserts and reads an installation by connection and team id', async () => {
    const input = createInstallationInput();

    const installation = await upsertSlackInstallation(input);
    const byConnection = await getSlackInstallationByConnectionId(input.connectionId);
    const byTeam = await getSlackInstallationByTeamId(input.teamId);

    expect(byConnection).toEqual(installation);
    expect(byTeam).toEqual(installation);
  });

  it('updates mutable metadata for an existing installation', async () => {
    const input = createInstallationInput();
    await upsertSlackInstallation(input);

    const result = await upsertSlackInstallation({
      ...input,
      teamName: 'Acme renamed',
      appId: 'A456',
      botUserId: 'U456',
      scopes: ['app_mentions:read', 'chat:write'],
    });

    expect(result).toMatchObject({
      teamName: 'Acme renamed',
      appId: 'A456',
      botUserId: 'U456',
      scopes: ['app_mentions:read', 'chat:write'],
    });
  });

  it('refuses to claim a team already linked to another connection', async () => {
    const first = createInstallationInput();
    await upsertSlackInstallation(first);
    const second = createInstallationInput({teamId: first.teamId});

    const result = upsertSlackInstallation(second);

    await expect(result).rejects.toBeInstanceOf(SlackInstallationAlreadyLinkedError);
    await expect(getSlackInstallationByTeamId(first.teamId)).resolves.toMatchObject({
      connectionId: first.connectionId,
    });
  });

  it('refuses to repoint an existing connection to another team', async () => {
    const first = createInstallationInput();
    await upsertSlackInstallation(first);
    const second = createInstallationInput({connectionId: first.connectionId});

    const result = upsertSlackInstallation(second);

    await expect(result).rejects.toBeInstanceOf(SlackConnectionAlreadyLinkedError);
    await expect(getSlackInstallationByConnectionId(first.connectionId)).resolves.toMatchObject({
      teamId: first.teamId,
    });
  });

  it('marks an installation revoked by connection id', async () => {
    const input = createInstallationInput();
    await upsertSlackInstallation(input);

    const result = await markSlackInstallationRevoked(input.connectionId);

    expect(result?.status).toBe('revoked');
  });
});
