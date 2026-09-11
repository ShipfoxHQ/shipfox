import {clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {createClickUpIntegrationProvider} from './index.js';

describe('createClickUpIntegrationProvider', () => {
  it('creates a ClickUp provider without user-facing routes', () => {
    const provider = createClickUpIntegrationProvider();

    expect(provider).toMatchObject({
      provider: 'clickup',
      displayName: 'ClickUp',
      adapters: {},
      routes: [],
    });
    expect(provider.eventCatalog).toBe(clickupEventCatalog);
  });

  it('exposes local connection cleanup hooks', () => {
    const deleteConnectionRecords = vi.fn(() => Promise.resolve());
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const provider = createClickUpIntegrationProvider({
      cleanup: {deleteConnectionRecords, deleteConnectionSecrets},
    });

    expect(provider.deleteConnectionRecords).toBe(deleteConnectionRecords);
    expect(provider.deleteConnectionSecrets).toBe(deleteConnectionSecrets);
  });
});
