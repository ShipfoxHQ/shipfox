import type {JiraInstallation} from '#db/installations.js';
import {JIRA_WEBHOOK_RENEWAL_THRESHOLD_MS} from '#temporal/constants.js';
import {createJiraWebhookRenewalActivities} from './renew-jira-webhooks.js';

function installation(
  connectionId: string,
  overrides: Partial<JiraInstallation> = {},
): JiraInstallation {
  const now = new Date('2026-08-01T00:00:00.000Z');
  return {
    id: crypto.randomUUID(),
    connectionId,
    cloudId: crypto.randomUUID(),
    siteUrl: 'https://acme.atlassian.net',
    siteName: 'Acme',
    authorizingAccountId: crypto.randomUUID(),
    scopes: ['manage:jira-webhook'],
    webhookIds: [123],
    webhookExpiresAt: new Date('2026-08-05T00:00:00.000Z'),
    webhookDeliveryBound: true,
    status: 'installed',
    tokenExpiresAt: now,
    refreshTokenLastUsedAt: now,
    refreshTokenLastAttemptedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('Jira webhook renewal activity', () => {
  it('refreshes due token-bound webhooks and skips outside-threshold or inactive connections', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const dueConnectionId = crypto.randomUUID();
    const outsideConnectionId = crypto.randomUUID();
    const inactiveConnectionId = crypto.randomUUID();
    const due = installation(dueConnectionId);
    const outside = installation(outsideConnectionId, {
      webhookExpiresAt: new Date(now.getTime() + JIRA_WEBHOOK_RENEWAL_THRESHOLD_MS + 1),
    });
    const inactive = installation(inactiveConnectionId);
    const expirationDate = new Date('2026-08-31T00:00:00.000Z');
    const getAccessToken = vi.fn().mockResolvedValue('fresh-access-token');
    const refreshDynamicWebhooks = vi.fn().mockResolvedValue(expirationDate);
    const registerWebhook = vi.fn();
    const updateInstallation = vi.fn().mockResolvedValue({id: 'installation-1'});
    const resolveConnection = vi
      .fn()
      .mockImplementation(async (connectionId: string) =>
        connectionId === inactiveConnectionId
          ? {lifecycleStatus: 'error'}
          : {lifecycleStatus: 'active'},
      );
    const listInstallations = vi.fn().mockResolvedValue([due, outside, inactive]);
    const activities = createJiraWebhookRenewalActivities({
      tokenStore: {getAccessToken},
      jira: {
        refreshDynamicWebhooks,
        registerDynamicWebhook: vi.fn(),
        deleteDynamicWebhook: vi.fn(),
      },
      webhookUrlForConnection: (connectionId) =>
        `https://shipfox.example.test/webhooks/integrations/jira/${connectionId}`,
      resolveConnection,
      listInstallations,
      updateInstallation,
      registerWebhook,
      now: () => now,
    });

    const result = await activities.renewJiraWebhooksActivity();

    expect(listInstallations).toHaveBeenCalledWith({
      before: new Date(now.getTime() + JIRA_WEBHOOK_RENEWAL_THRESHOLD_MS),
      limit: 20,
    });
    expect(getAccessToken).toHaveBeenCalledWith({connectionId: dueConnectionId});
    expect(refreshDynamicWebhooks).toHaveBeenCalledWith({
      accessToken: 'fresh-access-token',
      cloudId: due.cloudId,
      webhookIds: due.webhookIds,
    });
    expect(registerWebhook).not.toHaveBeenCalled();
    expect(updateInstallation).toHaveBeenCalledWith({
      connectionId: dueConnectionId,
      webhookIds: due.webhookIds,
      webhookExpiresAt: expirationDate,
      expectedWebhookIds: due.webhookIds,
      expectedWebhookExpiresAt: due.webhookExpiresAt,
    });
    expect(result).toEqual({renewed: 1, reregistered: 0, skipped: 2, failed: 0});
  });

  it('re-registers a legacy webhook even when its expiry is outside the refresh window', async () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const connectionId = crypto.randomUUID();
    const legacy = installation(connectionId, {
      webhookDeliveryBound: false,
      webhookExpiresAt: new Date(now.getTime() + JIRA_WEBHOOK_RENEWAL_THRESHOLD_MS + 1),
    });
    const refreshDynamicWebhooks = vi.fn();
    const registerWebhook = vi.fn().mockResolvedValue({
      webhookId: 456,
      webhookExpiresAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    const activities = createJiraWebhookRenewalActivities({
      tokenStore: {getAccessToken: vi.fn().mockResolvedValue('fresh-access-token')},
      jira: {
        refreshDynamicWebhooks,
        registerDynamicWebhook: vi.fn(),
        deleteDynamicWebhook: vi.fn(),
      },
      webhookUrlForConnection: (id) =>
        `https://shipfox.example.test/webhooks/integrations/jira/${id}?delivery=token`,
      resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'active'}),
      listInstallations: vi.fn().mockResolvedValue([legacy]),
      registerWebhook,
      now: () => now,
    });

    const result = await activities.renewJiraWebhooksActivity();

    expect(refreshDynamicWebhooks).not.toHaveBeenCalled();
    expect(registerWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId,
        webhookUrl: `https://shipfox.example.test/webhooks/integrations/jira/${connectionId}?delivery=token`,
        replaceExistingWebhooks: true,
      }),
    );
    expect(result).toEqual({renewed: 0, reregistered: 1, skipped: 0, failed: 0});
  });

  it('clears the expiry of an inactive legacy webhook so it leaves the front of the batch', async () => {
    const connectionId = crypto.randomUUID();
    const legacy = installation(connectionId, {webhookDeliveryBound: false});
    const registerWebhook = vi.fn();
    const updateInstallation = vi.fn().mockResolvedValue(undefined);
    const activities = createJiraWebhookRenewalActivities({
      tokenStore: {getAccessToken: vi.fn()},
      jira: {
        refreshDynamicWebhooks: vi.fn(),
        registerDynamicWebhook: vi.fn(),
        deleteDynamicWebhook: vi.fn(),
      },
      webhookUrlForConnection: (id) =>
        `https://shipfox.example.test/webhooks/integrations/jira/${id}`,
      resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'error'}),
      listInstallations: vi.fn().mockResolvedValue([legacy]),
      registerWebhook,
      updateInstallation,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });

    const result = await activities.renewJiraWebhooksActivity();

    expect(registerWebhook).not.toHaveBeenCalled();
    expect(updateInstallation).toHaveBeenCalledWith({
      connectionId,
      webhookIds: legacy.webhookIds,
      webhookExpiresAt: null,
      expectedWebhookIds: legacy.webhookIds,
      expectedWebhookExpiresAt: legacy.webhookExpiresAt,
      expectedWebhookDeliveryBound: false,
    });
    expect(result).toEqual({renewed: 0, reregistered: 0, skipped: 1, failed: 0});
  });

  it('re-registers and replaces webhook metadata when Jira no longer refreshes the ids', async () => {
    const connectionId = crypto.randomUUID();
    const due = installation(connectionId);
    const registerWebhook = vi.fn().mockResolvedValue({
      webhookId: 456,
      webhookExpiresAt: new Date('2026-08-31T00:00:00.000Z'),
    });
    const now = new Date('2026-08-01T00:00:00.000Z');
    const jira = {
      refreshDynamicWebhooks: vi.fn().mockResolvedValue(undefined),
      registerDynamicWebhook: vi.fn(),
      deleteDynamicWebhook: vi.fn(),
    };
    const activities = createJiraWebhookRenewalActivities({
      tokenStore: {getAccessToken: vi.fn().mockResolvedValue('fresh-access-token')},
      jira,
      webhookUrlForConnection: (id) =>
        `https://shipfox.example.test/webhooks/integrations/jira/${id}`,
      resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'active'}),
      listInstallations: vi.fn().mockResolvedValue([due]),
      registerWebhook,
      now: () => now,
    });

    const result = await activities.renewJiraWebhooksActivity();

    expect(registerWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId,
        cloudId: due.cloudId,
        accessToken: 'fresh-access-token',
        webhookUrl: `https://shipfox.example.test/webhooks/integrations/jira/${connectionId}`,
        replaceExistingWebhooks: true,
      }),
    );
    expect(result).toEqual({renewed: 0, reregistered: 1, skipped: 0, failed: 0});
  });

  it('skips a stale refresh result when webhook metadata changed during the request', async () => {
    const connectionId = crypto.randomUUID();
    const due = installation(connectionId);
    const updateInstallation = vi.fn().mockResolvedValue(undefined);
    const activities = createJiraWebhookRenewalActivities({
      tokenStore: {getAccessToken: vi.fn().mockResolvedValue('fresh-access-token')},
      jira: {
        refreshDynamicWebhooks: vi.fn().mockResolvedValue(new Date('2026-08-31T00:00:00.000Z')),
        registerDynamicWebhook: vi.fn(),
        deleteDynamicWebhook: vi.fn(),
      },
      webhookUrlForConnection: (id) => `https://shipfox.example.test/${id}`,
      resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'active'}),
      listInstallations: vi.fn().mockResolvedValue([due]),
      updateInstallation,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });

    await expect(activities.renewJiraWebhooksActivity()).resolves.toEqual({
      renewed: 0,
      reregistered: 0,
      skipped: 1,
      failed: 0,
    });
    expect(updateInstallation).toHaveBeenCalledWith({
      connectionId,
      webhookIds: due.webhookIds,
      webhookExpiresAt: new Date('2026-08-31T00:00:00.000Z'),
      expectedWebhookIds: due.webhookIds,
      expectedWebhookExpiresAt: due.webhookExpiresAt,
    });
  });

  it('counts a failure and keeps sweeping when one connection cannot be renewed', async () => {
    const brokenConnectionId = crypto.randomUUID();
    const healthyConnectionId = crypto.randomUUID();
    const broken = installation(brokenConnectionId);
    const healthy = installation(healthyConnectionId);
    const expirationDate = new Date('2026-08-31T00:00:00.000Z');
    const refreshDynamicWebhooks = vi
      .fn()
      .mockImplementation(({cloudId}: {cloudId: string}) =>
        cloudId === broken.cloudId
          ? Promise.reject(new Error('Jira rejected'))
          : Promise.resolve(expirationDate),
      );
    const updateInstallation = vi.fn().mockResolvedValue({id: 'installation-1'});
    const activities = createJiraWebhookRenewalActivities({
      tokenStore: {getAccessToken: vi.fn().mockResolvedValue('fresh-access-token')},
      jira: {
        refreshDynamicWebhooks,
        registerDynamicWebhook: vi.fn(),
        deleteDynamicWebhook: vi.fn(),
      },
      webhookUrlForConnection: (id) =>
        `https://shipfox.example.test/webhooks/integrations/jira/${id}`,
      resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'active'}),
      listInstallations: vi.fn().mockResolvedValue([broken, healthy]),
      updateInstallation,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });

    const result = await activities.renewJiraWebhooksActivity();

    expect(updateInstallation).toHaveBeenCalledOnce();
    expect(updateInstallation).toHaveBeenCalledWith(
      expect.objectContaining({connectionId: healthyConnectionId}),
    );
    expect(result).toEqual({renewed: 1, reregistered: 0, skipped: 0, failed: 1});
  });

  it('fails the sweep entry when webhook renewal dependencies are not configured', async () => {
    const due = installation(crypto.randomUUID());
    const activities = createJiraWebhookRenewalActivities({
      tokenStore: {getAccessToken: vi.fn()},
      resolveConnection: vi.fn().mockResolvedValue({lifecycleStatus: 'active'}),
      listInstallations: vi.fn().mockResolvedValue([due]),
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });

    await expect(activities.renewJiraWebhooksActivity()).resolves.toEqual({
      renewed: 0,
      reregistered: 0,
      skipped: 0,
      failed: 1,
    });
  });
});
