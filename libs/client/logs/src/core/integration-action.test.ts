import {genericActionPresentation, type PairedAction} from './activity.js';
import {
  createIntegrationActionPresentationLookup,
  type IntegrationActionTool,
} from './integration-action.js';

function action(name: string, input = '{}'): PairedAction {
  return {
    key: 1,
    request: {kind: 'tool-call', timestamp: 1, id: 'call-1', name, input},
    result: null,
    requestSeq: 1,
    resultSeq: null,
    sourceSeqs: [1],
    timestamp: 1,
    lineNumber: 1,
    state: 'running',
    durationMs: null,
  };
}

const providers = [
  'github',
  'gitea',
  'linear',
  'jira',
  'clickup',
  'notion',
  'sentry',
  'slack',
  'posthog',
  'webhook',
];

test.each(providers)('resolves %s with an arbitrary connection slug', (provider) => {
  const tool: IntegrationActionTool = {
    provider,
    connectionId: 'connection-id',
    connectionSlug: 'customer-primary',
    toolId: 'issue_read',
    sensitivity: 'read',
  };
  const lookup = createIntegrationActionPresentationLookup([tool]);
  const presentation = lookup(
    action(
      'mcp__shipfox_integration_tools__customer_primary__issue_read',
      '{"owner":"shipfox","repo":"platform","issue_number":42}',
    ),
  );
  expect(presentation).toMatchObject({
    label: 'Issue Read',
    target: 'shipfox/platform#42',
    iconKind: 'integration',
    detailKind: 'structured',
    readClassification: 'read',
    integration: {
      provider,
      connectionId: 'connection-id',
      connectionSlug: 'customer-primary',
      toolId: 'issue_read',
      methodId: null,
    },
  });
  expect(lookup(action(`mcp__shipfox_integration_tools__${provider}__issue_read`))).toBeUndefined();
});

test('uses the selected method sensitivity, not the family sensitivity or sensitive flag', () => {
  const lookup = createIntegrationActionPresentationLookup([
    {
      provider: 'github',
      connectionId: 'id',
      connectionSlug: 'code',
      toolId: 'issues',
      sensitivity: 'write',
      methods: [
        {id: 'get', sensitivity: 'read'},
        {id: 'update', sensitivity: 'write'},
      ],
    },
  ]);
  expect(lookup(action('code__issues', '{"method":"get","issue_number":12}'))).toMatchObject({
    readClassification: 'read',
    integration: {methodId: 'get'},
  });
  expect(lookup(action('code__issues', '{"method":"update"}'))?.readClassification).toBe('write');
  expect(lookup(action('code__issues', '{"method":"missing"}'))?.readClassification).toBe(
    'unknown',
  );
  expect(lookup(action('code__issues', 'invalid json'))?.readClassification).toBe('unknown');
});

test('leaves absent and colliding identities unresolved', () => {
  const tool: IntegrationActionTool = {
    provider: 'linear',
    connectionId: 'a',
    connectionSlug: 'my-tool',
    toolId: 'read',
    sensitivity: 'read',
  };
  expect(createIntegrationActionPresentationLookup([])(action('my_tool__read'))).toBeUndefined();
  expect(
    createIntegrationActionPresentationLookup([tool, {...tool, connectionId: 'b'}])(
      action('my_tool__read'),
    ),
  ).toBeUndefined();
  expect(
    genericActionPresentation(action('mcp__shipfox_integration_tools__my_tool__read')),
  ).toMatchObject({
    iconKind: 'unknown',
    label: 'My Tool · Read',
    readClassification: 'unknown',
  });
});
