import {
  AzureDevOpsAgentToolsProvider,
  AzureDevOpsSourceControlProvider,
  createAzureDevOpsIntegrationProvider,
} from '#index.js';
import {memorySecrets} from '#test/index.js';

describe('createAzureDevOpsIntegrationProvider', () => {
  it('exposes the adapters, the event catalog and the connection and webhook route groups', () => {
    const provider = createAzureDevOpsIntegrationProvider({
      secrets: memorySecrets(),
      getExistingAzureDevOpsConnection: vi.fn(() => Promise.resolve(undefined)),
      connectAzureDevOpsConnection: vi.fn() as never,
      discardAzureDevOpsConnection: vi.fn() as never,
      coreDb: vi.fn() as never,
      publishSourcePush: vi.fn() as never,
      publishIntegrationEventReceived: vi.fn() as never,
      recordDeliveryOnly: vi.fn() as never,
      getIntegrationConnectionById: vi.fn() as never,
    });

    expect(provider.provider).toBe('azure-devops');
    expect(provider.displayName).toBe('Azure DevOps');
    expect(provider.eventCatalog.events.map((event) => event.name)).toContain('git.push');
    expect(provider.adapters.source_control).toBeInstanceOf(AzureDevOpsSourceControlProvider);
    expect(provider.adapters.source_control.checkoutRepositoryAuthorization).toBe('enforced');
    expect(provider.adapters.agent_tools).toBeInstanceOf(AzureDevOpsAgentToolsProvider);
    expect(provider.routes.map((group) => group.prefix)).toEqual([
      '/integrations/azure-devops',
      '/webhooks/integrations/azure-devops',
    ]);
    expect(provider.webhookProcessors.map((registration) => registration.routeIds)).toEqual([
      ['azure-devops'],
    ]);
  });
});
