import {createIntegrationActionPresentationLookup, pairSessionRows} from '@shipfox/client-logs';
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
  ).toEqual([
    {
      provider: 'github',
      connectionId: 'id',
      connectionSlug: 'code',
      toolId: 'read',
      sensitivity: 'read',
    },
  ]);
  expect(toIntegrationActionTools(null)).toEqual([]);
  expect(toIntegrationActionTools({integrations: [{provider: 'github', tools: []}]})).toEqual([]);
});

test('presents a tool step using its frozen connection and method', () => {
  const tools = toIntegrationActionTools({
    tool: {
      provider: 'linear',
      connection_id: 'connection-1',
      connection_slug: 'tickets-main',
      id: 'issues',
      method: 'get',
      sensitivity: 'read',
      sensitive: true,
    },
  });
  const [item] = pairSessionRows([
    {
      seq: 0,
      lineNumber: 1,
      row: {
        kind: 'tool-call',
        timestamp: 1000,
        id: 'call-1',
        name: 'tickets_main__issues',
        input: '{"method":"get","identifier":"ENG-1"}',
      },
    },
    {
      seq: 1,
      lineNumber: 2,
      row: {
        kind: 'tool-result',
        timestamp: 1250,
        toolCallId: 'call-1',
        toolName: 'tickets_main__issues',
        output: '{"title":"Fix logs"}',
        isError: false,
      },
    },
  ]);
  if (item?.kind !== 'action') throw new Error('Expected an action');

  const presentation = createIntegrationActionPresentationLookup(tools)(item.action);

  expect(presentation).toMatchObject({
    label: 'Issues Get',
    target: 'ENG-1',
    iconKind: 'integration',
    readClassification: 'read',
    integration: {provider: 'linear', connectionId: 'connection-1', methodId: 'get'},
    detail: {label: 'Result', kind: 'structured', value: '{"title":"Fix logs"}'},
  });
  expect(item.action).toMatchObject({state: 'succeeded', durationMs: 250});
});
