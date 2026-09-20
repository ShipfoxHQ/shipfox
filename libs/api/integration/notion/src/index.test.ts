import {notionEventCatalog} from '@shipfox/api-integration-notion-dto';
import {createNotionIntegrationProvider} from './index.js';

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
