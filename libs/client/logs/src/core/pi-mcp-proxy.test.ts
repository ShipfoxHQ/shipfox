import {
  buildActivityNodes,
  groupActivityReads,
  pairSessionRows,
  resolveActionPresentation,
} from './activity.js';
import {createIntegrationActionPresentationLookup} from './integration-action.js';
import type {LogRecord, SessionViewRow} from './log-model.js';
import {buildLogTree} from './log-tree.js';
import {piMcpProxySearchPresentation, unwrapPiMcpProxyAction} from './pi-mcp-proxy.js';

function action(name: string, input: unknown, output = '{"channel":{"id":"C1"}}') {
  const rows: {seq: number; lineNumber: number; row: SessionViewRow}[] = [
    {
      seq: 1,
      lineNumber: 1,
      row: {kind: 'tool-call', timestamp: 10, id: 'call', name, input: JSON.stringify(input)},
    },
    {
      seq: 2,
      lineNumber: 2,
      row: {
        kind: 'tool-result',
        timestamp: 20,
        toolCallId: 'call',
        toolName: name,
        output,
        isError: false,
      },
    },
  ];
  const [item] = pairSessionRows(rows);
  if (item?.kind !== 'action') throw new Error('expected paired action');
  return item.action;
}

const slackLookup = createIntegrationActionPresentationLookup([
  {
    provider: 'slack',
    connectionId: 'slack-connection',
    connectionSlug: 'slack-shipfox',
    toolId: 'read_channel_info',
    sensitivity: 'read',
  },
]);

describe('unwrapPiMcpProxyAction', () => {
  test('exposes the inner tool name and JSON string arguments', () => {
    const proxied = action('mcp', {
      tool: 'slack_shipfox__read_channel_info',
      args: '{"channel_id":"C1"}',
    });

    expect(unwrapPiMcpProxyAction(proxied)?.request).toMatchObject({
      name: 'slack_shipfox__read_channel_info',
      input: '{"channel_id":"C1"}',
    });
  });

  test('serialises object arguments and defaults missing arguments to an empty object', () => {
    expect(
      unwrapPiMcpProxyAction(action('mcp', {tool: 'x__list', args: {limit: 2}}))?.request?.input,
    ).toBe('{"limit":2}');
    expect(unwrapPiMcpProxyAction(action('mcp', {tool: 'x__list'}))?.request?.input).toBe('{}');
  });

  test('ignores direct calls and proxy actions without a tool', () => {
    expect(unwrapPiMcpProxyAction(action('read', {path: 'a.ts'}))).toBeNull();
    expect(unwrapPiMcpProxyAction(action('mcp', {search: 'slack'}))).toBeNull();
    expect(unwrapPiMcpProxyAction(action('mcp', {action: 'auth-start'}))).toBeNull();
  });
});

describe('resolveActionPresentation through the proxy', () => {
  test('resolves a proxied integration call to its provider presentation', () => {
    const proxied = action('mcp', {
      tool: 'slack_shipfox__read_channel_info',
      args: '{"channel_id":"C1"}',
    });

    expect(resolveActionPresentation(proxied, slackLookup)).toMatchObject({
      label: 'Read Channel Info',
      target: 'C1',
      readClassification: 'read',
      integration: {provider: 'slack', toolId: 'read_channel_info'},
    });
  });

  test('presents a tool search as a read with its query', () => {
    const search = action('mcp', {search: 'slack channel'}, 'slack_shipfox__read_channel_info');

    expect(piMcpProxySearchPresentation(search)).toMatchObject({
      label: 'Search Tools',
      target: 'slack channel',
      readClassification: 'read',
    });
    expect(resolveActionPresentation(search).label).toBe('Search Tools');
  });

  test('keeps the generic form for other proxy actions', () => {
    expect(resolveActionPresentation(action('mcp', {action: 'auth-start'}))).toMatchObject({
      label: 'Mcp',
      readClassification: 'unknown',
    });
  });

  test('groups proxied reads of the same integration tool', () => {
    const call = (id: string, channel: string): LogRecord[] => [
      {
        v: 1,
        ts: 10,
        type: 'agent_session',
        row: {
          kind: 'tool-call',
          timestamp: 10,
          id,
          name: 'mcp',
          input: JSON.stringify({
            tool: 'slack_shipfox__read_channel_info',
            args: JSON.stringify({channel_id: channel}),
          }),
        },
      },
      {
        v: 1,
        ts: 11,
        type: 'agent_session',
        row: {
          kind: 'tool-result',
          timestamp: 11,
          toolCallId: id,
          toolName: 'mcp',
          output: '{}',
          isError: false,
        },
      },
    ];
    const records = [...call('one', 'C1'), ...call('two', 'C2')];

    const nodes = groupActivityReads(buildActivityNodes(buildLogTree(records).nodes), slackLookup);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({kind: 'read-group', totalCount: 2});
  });
});
