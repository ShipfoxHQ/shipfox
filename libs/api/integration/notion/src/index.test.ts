import {notionEventCatalog} from '@shipfox/api-integration-notion-dto';
import {createNotionIntegrationProvider, type NotionWebhookProcessor} from './index.js';

describe('createNotionIntegrationProvider', () => {
  it('creates a Notion provider without user-facing routes or adapters', () => {
    const provider = createNotionIntegrationProvider();

    expect(provider).toMatchObject({
      provider: 'notion',
      displayName: 'Notion',
      adapters: {},
      routes: [],
    });
    expect(provider.eventCatalog).toBe(notionEventCatalog);
  });

  it('uses a supplied webhook processor', () => {
    const processor: NotionWebhookProcessor = {
      process: vi.fn(async () => ({outcome: 'processed' as const})),
    };
    const provider = createNotionIntegrationProvider({
      routes: {
        coreDb: vi.fn() as never,
        publishIntegrationEventReceived: vi.fn() as never,
        recordDeliveryOnly: vi.fn() as never,
        getIntegrationConnectionById: vi.fn() as never,
        processor,
      },
    });

    expect(provider.webhookProcessors).toEqual([{routeIds: ['notion'], processor}]);
  });

  it('exposes local connection cleanup hooks', () => {
    const deleteConnectionRecords = vi.fn(() => Promise.resolve());
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const provider = createNotionIntegrationProvider({
      cleanup: {deleteConnectionRecords, deleteConnectionSecrets},
    });

    expect(provider.deleteConnectionRecords).toBe(deleteConnectionRecords);
    expect(provider.deleteConnectionSecrets).toBe(deleteConnectionSecrets);
  });
});
