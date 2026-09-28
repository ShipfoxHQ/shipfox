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

test.each([
  ['Jira issue key', {idOrKey: 'ENG-2312'}, 'ENG-2312'],
  ['ClickUp task ID', {task_id: 'abc123'}, 'abc123'],
  ['Slack channel ID', {channel_id: 'C123'}, 'C123'],
  ['Gitea repository and index', {repo: 'shipfox/platform', index: 42}, 'shipfox/platform#42'],
])('uses the %s as the preview target', (_name, input, target) => {
  const lookup = createIntegrationActionPresentationLookup([
    {
      provider: 'example',
      connectionId: 'id',
      connectionSlug: 'customer-primary',
      toolId: 'read',
      sensitivity: 'read',
    },
  ]);
  expect(lookup(action('customer_primary__read', JSON.stringify(input)))?.target).toBe(target);
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

describe('action step calls', () => {
  const slack: IntegrationActionTool = {
    provider: 'slack',
    connectionId: 'team-slack',
    connectionSlug: 'team-slack',
    toolId: 'read_thread',
    sensitivity: 'read',
    alias: 'chat',
    result: 'json',
  };

  function settled(
    name: string,
    output: unknown,
    {isError = false, input = '{}'}: {isError?: boolean; input?: string} = {},
  ): PairedAction {
    const request = action(name, input);
    return {
      ...request,
      result: {
        kind: 'tool-result',
        timestamp: 2,
        toolCallId: 'call-1',
        toolName: name,
        output: JSON.stringify(output),
        isError,
      },
      state: isError ? 'failed' : 'succeeded',
      durationMs: 1,
    };
  }

  test('resolves a call by its alias and shows the alias and connection', () => {
    const lookup = createIntegrationActionPresentationLookup([slack]);

    const presentation = lookup(action('chat__read_thread', '{"channel_id":"C1"}'));

    expect(presentation).toMatchObject({
      label: 'Read Thread',
      target: 'C1',
      readClassification: 'read',
      meta: [
        {label: 'Alias', value: 'chat'},
        {label: 'Connection', value: 'team-slack'},
      ],
      integration: {provider: 'slack', toolId: 'read_thread'},
    });
    expect(presentation?.detail).toBeUndefined();
    expect(lookup(action('team_slack__read_thread'))).toBeUndefined();
  });

  test('resolves a family method called as family.method', () => {
    const lookup = createIntegrationActionPresentationLookup([
      {
        ...slack,
        provider: 'github',
        alias: 'code',
        toolId: 'issues',
        sensitivity: 'write',
        methods: [{id: 'update', sensitivity: 'write'}],
      },
    ]);

    expect(lookup(action('code__issues.update'))).toMatchObject({
      label: 'Issues Update',
      readClassification: 'write',
      integration: {methodId: 'update'},
    });
    expect(lookup(action('code__issues.missing'))?.readClassification).toBe('unknown');
  });

  test('labels an outcome-unknown write as outcome unknown, never failed', () => {
    const lookup = createIntegrationActionPresentationLookup([{...slack, sensitivity: 'write'}]);

    const presentation = lookup(
      settled(
        'chat__read_thread',
        {code: 'provider-timeout', message: 'No answer', outcome_unknown: true},
        {isError: true},
      ),
    );

    expect(presentation?.outcome).toEqual({label: 'outcome unknown', tone: 'warning'});
  });

  test('keeps a caught failure as a plain failure', () => {
    const lookup = createIntegrationActionPresentationLookup([slack]);

    const presentation = lookup(
      settled(
        'chat__read_thread',
        {code: 'not-found', message: 'No thread', outcome_unknown: false},
        {isError: true},
      ),
    );

    expect(presentation?.outcome).toBeUndefined();
  });

  test('labels a call the step ended during as interrupted', () => {
    const lookup = createIntegrationActionPresentationLookup([slack]);

    const presentation = lookup({...action('chat__read_thread'), state: 'no-result'});

    expect(presentation?.outcome).toEqual({label: 'interrupted', tone: 'neutral'});
  });

  test('shows a download as its file name, size, media type, and SHA-256', () => {
    const lookup = createIntegrationActionPresentationLookup([
      {...slack, provider: 'linear', alias: 'tickets', toolId: 'download_file', result: 'file'},
    ]);

    const presentation = lookup(
      settled('tickets__download_file', {
        path: 'context/files/design.pdf',
        filename: 'design.pdf',
        bytes: 2_621_440,
        media_type: 'application/pdf',
        sha256: 'ab12',
      }),
    );

    expect(presentation).toMatchObject({target: 'design.pdf', statusDetail: '2.5 MiB'});
    expect(JSON.parse(presentation?.detail?.value ?? '{}')).toEqual({
      File: 'design.pdf',
      Size: '2.5 MiB',
      'Media type': 'application/pdf',
      'SHA-256': 'ab12',
      Path: 'context/files/design.pdf',
    });
  });
});
