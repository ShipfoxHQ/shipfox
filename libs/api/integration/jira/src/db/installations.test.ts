import {JiraInstallationSiteMismatchError} from '#core/errors.js';
import {
  getJiraInstallationByConnectionId,
  getJiraInstallationByWebhookId,
  markJiraInstallationRevoked,
  upsertJiraInstallation,
} from './installations.js';

function createInstallationInput(
  overrides: Partial<Parameters<typeof upsertJiraInstallation>[0]> = {},
) {
  return {
    connectionId: crypto.randomUUID(),
    cloudId: crypto.randomUUID(),
    siteUrl: 'https://acme.atlassian.net',
    siteName: 'Acme',
    authorizingAccountId: crypto.randomUUID(),
    scopes: ['read:jira-work'],
    webhookIds: [Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)],
    status: 'installed' as const,
    ...overrides,
  };
}

describe('jira installations', () => {
  it('inserts an installation and reads it by connection and webhook id', async () => {
    const webhookId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const input = createInstallationInput({webhookIds: [webhookId]});

    const installation = await upsertJiraInstallation(input);
    const byConnection = await getJiraInstallationByConnectionId(input.connectionId);
    const byWebhook = await getJiraInstallationByWebhookId(webhookId);

    expect(byConnection).toEqual(installation);
    expect(byWebhook).toEqual(installation);
  });

  it('updates mutable metadata for the same connection and Jira site', async () => {
    const input = createInstallationInput();
    await upsertJiraInstallation(input);

    const result = await upsertJiraInstallation({
      ...input,
      siteUrl: 'https://renamed.atlassian.net',
      siteName: 'Acme renamed',
      authorizingAccountId: crypto.randomUUID(),
      scopes: ['read:jira-work', 'write:jira-work'],
      webhookIds: [123],
    });

    expect(result).toMatchObject({
      siteUrl: 'https://renamed.atlassian.net',
      siteName: 'Acme renamed',
      scopes: ['read:jira-work', 'write:jira-work'],
      webhookIds: [123],
    });
  });

  it('refuses to repoint a connection to a different Jira site', async () => {
    const first = createInstallationInput();
    await upsertJiraInstallation(first);
    const second = createInstallationInput({connectionId: first.connectionId});

    const result = upsertJiraInstallation(second);

    await expect(result).rejects.toBeInstanceOf(JiraInstallationSiteMismatchError);
    await expect(getJiraInstallationByConnectionId(first.connectionId)).resolves.toMatchObject({
      cloudId: first.cloudId,
    });
  });

  it('returns undefined for unknown connection and webhook ids', async () => {
    const connectionId = crypto.randomUUID();
    const webhookId = Number.MAX_SAFE_INTEGER;

    const byConnection = await getJiraInstallationByConnectionId(connectionId);
    const byWebhook = await getJiraInstallationByWebhookId(webhookId);

    expect(byConnection).toBeUndefined();
    expect(byWebhook).toBeUndefined();
  });

  it('marks an installation revoked and returns undefined for an unknown connection', async () => {
    const input = createInstallationInput();
    await upsertJiraInstallation(input);

    const revoked = await markJiraInstallationRevoked(input.connectionId);
    const missing = await markJiraInstallationRevoked(crypto.randomUUID());

    expect(revoked?.status).toBe('revoked');
    expect(missing).toBeUndefined();
  });
});
