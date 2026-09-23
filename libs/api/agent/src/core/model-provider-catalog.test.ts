import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {buildModelProviderCatalog} from './model-provider-catalog.js';

describe('buildModelProviderCatalog', () => {
  it('deep-freezes managed provider entries in both policy modes', () => {
    const managedProvider = {
      id: 'shipfox-managed',
      label: 'Shipfox Managed',
      models: [
        {
          id: 'managed-claude',
          label: 'Managed Claude',
          api: 'anthropic-messages' as const,
          references: [
            {
              thinking: 'high' as const,
              intelligence_index: 80,
              cost_per_task_usd: 0.1,
              scale: 'aa-v1-swe-bench',
            },
          ],
        },
      ],
      defaultModel: 'managed-claude',
      resolveCredentials: async () => ({
        api: 'anthropic-messages' as const,
        baseUrl: 'https://gateway.example.com',
        credentials: {api_key: 'token'},
      }),
    } satisfies ManagedModelProvider;

    for (const workspaceProviders of ['enabled', 'disabled'] as const) {
      const catalog = buildModelProviderCatalog({managedProvider, workspaceProviders});
      const managedEntry = catalog.find((entry) => entry.id === managedProvider.id);

      if (managedEntry === undefined) throw new Error('Missing managed provider catalog entry');

      expect(Object.isFrozen(managedEntry)).toBe(true);
      expect(Object.isFrozen(managedEntry.models)).toBe(true);
      expect(Object.isFrozen(managedEntry.models[0])).toBe(true);
      expect(managedEntry.models[0]?.api).toBe('anthropic-messages');
      expect(managedEntry.models[0]?.references).toEqual([
        {
          thinking: 'high',
          intelligence_index: 80,
          cost_per_task_usd: 0.1,
          scale: 'aa-v1-swe-bench',
        },
      ]);
    }
  });
});
