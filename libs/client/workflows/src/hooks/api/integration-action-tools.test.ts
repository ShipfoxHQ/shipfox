import {toIntegrationActionTools} from './integration-action-tools.js';

test('maps resolved attempt configuration and keeps sensitive separate from sensitivity', () => {
  expect(
    toIntegrationActionTools({
      integrations: [
        {
          provider: 'linear',
          connectionId: 'connection-1',
          connectionSlug: 'tickets-main',
          tools: [
            {
              id: 'issues',
              sensitivity: 'write',
              sensitive: true,
              methods: [
                {id: 'get', sensitivity: 'read', sensitive: true},
                {id: 'update', sensitivity: 'write', sensitive: false},
              ],
            },
          ],
        },
      ],
    }),
  ).toEqual([
    {
      provider: 'linear',
      connectionId: 'connection-1',
      connectionSlug: 'tickets-main',
      toolId: 'issues',
      sensitivity: 'write',
      methods: [
        {id: 'get', sensitivity: 'read'},
        {id: 'update', sensitivity: 'write'},
      ],
    },
  ]);
});

test('accepts MCP server configuration and missing configuration', () => {
  expect(
    toIntegrationActionTools({
      mcpServers: [
        {
          name: 'shipfox_integration_tools',
          integrations: [
            {
              provider: 'github',
              connectionId: 'id',
              connectionSlug: 'code',
              tools: [{id: 'read', sensitivity: 'read'}],
            },
          ],
        },
      ],
    }),
  ).toHaveLength(1);
  expect(toIntegrationActionTools(null)).toEqual([]);
  expect(toIntegrationActionTools({integrations: [{provider: 'github', tools: []}]})).toEqual([]);
});
