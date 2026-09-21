import {
  deleteNotionInstallationByConnectionId,
  getNotionInstallationByConnectionId,
  getNotionInstallationByWorkspaceId,
  restoreNotionInstallation,
  upsertNotionInstallation,
} from './installations.js';

function input(overrides: Partial<Parameters<typeof upsertNotionInstallation>[0]> = {}) {
  return {
    connectionId: crypto.randomUUID(),
    notionWorkspaceId: crypto.randomUUID(),
    workspaceName: 'Acme',
    botId: crypto.randomUUID(),
    authorizedByUserId: crypto.randomUUID(),
    tokenExpiresAt: null,
    status: 'installed' as const,
    ...overrides,
  };
}

describe('Notion installations', () => {
  it('persists and maps an installation by connection and workspace', async () => {
    const installation = await upsertNotionInstallation(input());

    await expect(
      getNotionInstallationByConnectionId(installation.connectionId),
    ).resolves.toMatchObject(installation);
    await expect(
      getNotionInstallationByWorkspaceId(installation.notionWorkspaceId),
    ).resolves.toMatchObject(installation);
  });

  it('refreshes installation metadata for the same connection and workspace', async () => {
    const initial = input();
    await upsertNotionInstallation(initial);

    const refreshed = await upsertNotionInstallation({
      ...initial,
      workspaceName: 'Updated Acme',
      botId: crypto.randomUUID(),
      tokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(refreshed).toMatchObject({
      connectionId: initial.connectionId,
      notionWorkspaceId: initial.notionWorkspaceId,
      workspaceName: 'Updated Acme',
      tokenExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
      status: 'installed',
    });
  });

  it('deletes an installation by connection so the workspace can be reinstalled', async () => {
    const initial = input();
    const installation = await upsertNotionInstallation(initial);

    await expect(deleteNotionInstallationByConnectionId(installation.connectionId)).resolves.toBe(
      true,
    );
    await expect(
      getNotionInstallationByWorkspaceId(initial.notionWorkspaceId),
    ).resolves.toBeUndefined();

    await expect(upsertNotionInstallation(initial)).resolves.toMatchObject(initial);
  });

  it('reports a rollback failure when the installation disappeared', async () => {
    const installation = await upsertNotionInstallation(input());
    await deleteNotionInstallationByConnectionId(installation.connectionId);

    await expect(restoreNotionInstallation(installation)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
  });
});
