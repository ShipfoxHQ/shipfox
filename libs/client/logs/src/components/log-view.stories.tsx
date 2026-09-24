import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {userEvent, within} from 'storybook/test';
import {
  createIntegrationActionPresentationLookup,
  type IntegrationActionTool,
} from '#core/integration-action.js';
import type {LogRecord, SessionViewRow} from '#core/log-model.js';
import {LogView, LogViewSkeleton} from './log-view.js';

const ESC = String.fromCharCode(27);
const READ_FILE_BUTTON_NAME = /Read File/;
const LARGE_READ_BUTTON_NAME = /Read File.*src\/large.ts/;
const INTEGRATION_BUTTON_NAME = /Linear · List Teams/;
const GROUPED_NATIVE_BUTTON_NAME = /Read File, 2 reads/;
const GROUPED_INTEGRATION_BUTTON_NAME = /Linear · Get Issue, 2 reads/;
const origin = new Date('2026-06-23T10:00:00.000Z').getTime();
const at = (offsetSeconds: number) => origin + offsetSeconds * 1000;

const out = (data: string, offset: number, stream: 'stdout' | 'stderr' = 'stdout'): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'output',
  stream,
  data,
});
const session = (row: SessionViewRow, offset: number): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'agent_session',
  row: {...row, timestamp: at(offset)},
});
const groupStart = (
  groupId: string,
  name: string,
  offset: number,
  parentGroupId: string | null = null,
): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'group_start',
  groupId,
  parentGroupId,
  name,
});
const groupEnd = (groupId: string, offset: number): LogRecord => ({
  v: 1,
  ts: at(offset),
  type: 'group_end',
  groupId,
});

const toolResultResolutionRecords: LogRecord[] = [
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'claude-tool-1',
      name: 'mcp__shipfox_integration_tools__linear_shipfox__list_teams',
      input: '{"workspace":"shipfox"}',
    },
    0,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'claude-tool-1',
      toolName: 'tool',
      output: '[{"name":"Engineering"}]',
      isError: false,
    },
    1,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'missing-tool',
      toolName: 'tool',
      output: 'The matching call was not included in this stream.',
      isError: true,
    },
    2,
  ),
];

interface IntegrationProviderExample {
  provider: string;
  toolId: string;
  input: Record<string, unknown>;
  output: unknown;
  methods?: IntegrationActionTool['methods'];
}

const integrationProviderExamples: readonly IntegrationProviderExample[] = [
  {
    provider: 'github',
    toolId: 'issue_read',
    methods: [{id: 'get', sensitivity: 'read'}],
    input: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 42},
    output: {number: 42, title: 'Improve activity logs', state: 'open'},
  },
  {
    provider: 'gitea',
    toolId: 'get_issue',
    input: {repo: 'platform', index: 7},
    output: {number: 7, title: 'Review deployment', state: 'open'},
  },
  {
    provider: 'linear',
    toolId: 'get_issue',
    input: {id: 'ENG-2312'},
    output: {identifier: 'ENG-2312', title: 'Add integration identity and presentation'},
  },
  {
    provider: 'jira',
    toolId: 'get_issue',
    input: {idOrKey: 'OPS-42'},
    output: {key: 'OPS-42', fields: {summary: 'Review production alerts'}},
  },
  {
    provider: 'clickup',
    toolId: 'get_task',
    input: {task_id: '86abc'},
    output: {id: '86abc', name: 'Prepare release notes', status: 'in progress'},
  },
  {
    provider: 'notion',
    toolId: 'search',
    input: {query: 'Launch notes'},
    output: {results: [{title: 'Launch notes', object: 'page'}], has_more: false},
  },
  {
    provider: 'slack',
    toolId: 'read_channel',
    input: {channel_id: 'C123'},
    output: {messages: [{user: 'U123', text: 'Release is ready'}], has_more: false},
  },
  {
    provider: 'posthog',
    toolId: 'insights-list',
    input: {},
    output: {results: [{name: 'Weekly active users'}]},
  },
];

const integrationProviderTools: IntegrationActionTool[] = integrationProviderExamples.map(
  ({provider, toolId, methods}) => ({
    provider,
    connectionId: `${provider}-connection`,
    connectionSlug: `${provider}-main`,
    toolId,
    sensitivity: 'read',
    methods,
  }),
);

const integrationProviderRecords: LogRecord[] = integrationProviderExamples.flatMap(
  ({provider, toolId, input, output}, index) => {
    const id = `${provider}-tool`;
    return [
      session(
        {
          kind: 'tool-call',
          timestamp: 0,
          id,
          name: `mcp__shipfox_integration_tools__${provider}_main__${toolId}`,
          input: JSON.stringify(input),
        },
        index * 2,
      ),
      session(
        {
          kind: 'tool-result',
          timestamp: 0,
          toolCallId: id,
          toolName: toolId,
          output: JSON.stringify(output),
          isError: false,
        },
        index * 2 + 1,
      ),
    ];
  },
);

const pairedActivityRecords: LogRecord[] = [
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [],
      text: '**Plan**\n\n- Read `src/login-form.tsx`.\n- Check the error handling.',
      terminalFailure: false,
    },
    0,
  ),
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'read-login-form',
      name: 'read_file',
      input: '{"path":"src/login-form.tsx"}',
    },
    1,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'read-login-form',
      toolName: 'read_file',
      output: 'export function LoginForm() { /* ... */ }',
      isError: false,
    },
    2,
  ),
];

const groupedReadTools: IntegrationActionTool[] = [
  {
    provider: 'linear',
    connectionId: 'tickets-main',
    connectionSlug: 'tickets-main',
    toolId: 'get_issue',
    sensitivity: 'read',
  },
];

const groupedReadRecords: LogRecord[] = [
  ...nativeToolRecords([
    {name: 'read_file', input: {path: 'src/main.ts'}, output: 'export const main = true;'},
    {name: 'read_file', input: {path: 'src/helper.ts'}, output: 'export const helper = true;'},
    {name: 'Read', input: {file_path: 'src/view.tsx'}, output: 'export function View() {}'},
    {name: 'Read', input: {file_path: 'src/panel.tsx'}, output: 'export function Panel() {}'},
  ]),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      text: 'Checking the related issues.',
      meta: [],
      terminalFailure: false,
    },
    10,
  ),
  ...['ENG-2311', 'ENG-2312'].flatMap((issue, index): LogRecord[] => [
    session(
      {
        kind: 'tool-call',
        timestamp: 0,
        id: `issue-${index}`,
        name: 'mcp__shipfox_integration_tools__tickets_main__get_issue',
        input: JSON.stringify({id: issue}),
      },
      11 + index * 2,
    ),
    session(
      {
        kind: 'tool-result',
        timestamp: 0,
        toolCallId: `issue-${index}`,
        toolName: 'get_issue',
        output: JSON.stringify({identifier: issue, title: 'Completed prerequisite'}),
        isError: false,
      },
      12 + index * 2,
    ),
  ]),
];

function nativeToolRecords(
  tools: readonly {
    name: string;
    input: Record<string, unknown>;
    output: string;
    isError?: boolean;
  }[],
): LogRecord[] {
  return tools.flatMap((tool, index) => {
    const offset = index * 2;
    const id = `native-${index}`;
    return [
      session(
        {kind: 'tool-call', timestamp: 0, id, name: tool.name, input: JSON.stringify(tool.input)},
        offset,
      ),
      session(
        {
          kind: 'tool-result',
          timestamp: 0,
          toolCallId: id,
          toolName: tool.name,
          output: tool.output,
          isError: tool.isError ?? false,
        },
        offset + 1,
      ),
    ];
  });
}

const nativePiRecords = nativeToolRecords([
  {
    name: 'read',
    input: {path: 'src/app.ts', offset: 12, limit: 8},
    output: 'export function App() {}',
  },
  {
    name: 'edit',
    input: {path: 'src/app.ts', oldText: 'old', newText: 'new'},
    output: 'Updated src/app.ts',
  },
  {name: 'write', input: {path: 'src/new.ts', content: 'export {}'}, output: 'Wrote src/new.ts'},
  {
    name: 'bash',
    input: {command: 'pnpm test'},
    output: '{"stdout":"17 tests passed","exitCode":0}',
  },
  {name: 'grep', input: {pattern: 'TODO', path: 'src'}, output: '{"matches":["src/app.ts:12"]}'},
  {name: 'find', input: {pattern: '*.test.ts', path: 'src'}, output: 'src/app.test.ts'},
  {name: 'ls', input: {path: 'src'}, output: '{"files":["app.ts","new.ts"]}'},
]);

const nativeClaudeRecords = nativeToolRecords([
  {name: 'Read', input: {file_path: 'src/app.ts'}, output: 'export function App() {}'},
  {
    name: 'Edit',
    input: {file_path: 'src/app.ts', old_string: 'old', new_string: 'new'},
    output: 'Edited src/app.ts',
  },
  {
    name: 'Write',
    input: {file_path: 'src/new.ts', content: 'export {}'},
    output: 'Wrote src/new.ts',
  },
  {name: 'Bash', input: {command: 'pnpm test'}, output: 'Exit code: 0\nOutput:\n17 tests passed'},
  {name: 'Grep', input: {pattern: 'TODO', path: 'src'}, output: 'src/app.ts:12:TODO'},
  {name: 'Glob', input: {pattern: '*.test.ts', path: 'src'}, output: 'src/app.test.ts'},
  {name: 'LS', input: {path: 'src'}, output: 'app.ts\nnew.ts'},
]);

const shipfoxToolRecords = nativeToolRecords([
  {name: 'web_search', input: {query: 'slack channel info api'}, output: 'Synthesized answer'},
  {name: 'WebFetch', input: {url: 'https://api.slack.com/methods'}, output: 'Fetched 12 KB'},
  {
    name: 'mcp',
    input: {search: 'slack channel'},
    output: 'slack_shipfox__read_channel_info',
  },
  {
    name: 'mcp',
    input: {tool: 'slack_shipfox__read_channel_info', args: '{"channel_id":"C0BKY1J7C79"}'},
    output: '{"channel":{"id":"C0BKY1J7C79","name":"test-slack-integration"}}',
  },
  {
    name: 'set_output',
    input: {key: 'channel_id', value: 'C0BKY1J7C79'},
    output: 'Output "channel_id" set.',
  },
  {
    name: 'mcp__shipfox_outputs__set_output',
    input: {key: 'channel_name', value: 'test-slack-integration'},
    output: 'Output "channel_name" set.',
  },
  {
    name: 'set_output',
    input: {key: 'count', value: 'many'},
    output:
      'Output "count" must be a number\n\nRetry set_output using this exact contract:\n\n- key: "count"',
  },
]);

const nativeEdgeRecords = [
  ...nativeToolRecords([
    {name: 'read', input: {}, output: 'Missing path', isError: true},
    {
      name: 'bash',
      input: {command: 'pnpm test'},
      output: '{"stderr":"FAIL pi.test.ts","exitCode":1}',
    },
    {
      name: 'read',
      input: {path: 'src/pi-large.ts'},
      output: 'export const pi = true;\n'.repeat(350),
    },
    {name: 'Read', input: {}, output: 'Missing file path', isError: true},
    {
      name: 'Bash',
      input: {command: 'pnpm test'},
      output: 'Exit code: 1\nOutput:\nFAIL app.test.ts',
    },
    {
      name: 'Edit',
      input: {file_path: 'src/app.ts', old_string: 'before', new_string: 'after'},
      output: 'Could not find source text',
      isError: true,
    },
    {
      name: 'Read',
      input: {file_path: 'src/large.ts'},
      output: `export const value = 1;\nexport const payload = "${'x'.repeat(5_100)}";`,
    },
  ]),
  {v: 1, ts: at(15), type: 'end', totalBytes: 18_000} as LogRecord,
];

const showcaseRecords: LogRecord[] = [
  out('$ pnpm build && pnpm test\n', 0),
  groupStart('g1', 'Install dependencies', 1),
  out('Resolving packages...\n', 2),
  out('Linking 318 packages\n', 3),
  groupEnd('g1', 4),
  groupStart('g2', 'Build', 5),
  out(`${ESC}[32m✓${ESC}[0m built ${ESC}[34m1284${ESC}[0m modules\n`, 6),
  out('warn: deprecated glob@7, upgrade to glob@10\n', 7, 'stderr'),
  groupEnd('g2', 8),
  groupStart('g3', 'Test', 9),
  out('running 42 tests\n', 10),
  out('FAIL client.test.ts > retries on 503\n', 11, 'stderr'),
  groupEnd('g3', 12),
  {v: 1, ts: at(13), type: 'gap', droppedBytes: 2048},
  {v: 1, ts: at(14), type: 'end', totalBytes: 15_360},
];

// A pipeline nested three levels deep: Deploy > Build > Compile, and Deploy >
// Test > {unit, e2e}. The e2e leaf writes to stderr, so its error bubbles up to
// Test and the top-level pipeline (visible as an inset bar when those groups are
// collapsed); the Build branch stays clean. Closed inner groups carry a duration.
const nestedRecords: LogRecord[] = [
  groupStart('g1', 'Deploy pipeline', 0),
  out('$ ./deploy.sh\n', 0.1),
  groupStart('g2', 'Build', 1, 'g1'),
  out('resolving workspace graph\n', 1.2),
  groupStart('g3', 'Compile @app/web', 2, 'g2'),
  out(`${ESC}[32m✓${ESC}[0m built ${ESC}[34m842${ESC}[0m modules\n`, 3),
  groupEnd('g3', 4),
  groupStart('g4', 'Compile @app/api', 4.2, 'g2'),
  out('tsc --build\n', 5),
  out('✓ 1.1k files emitted\n', 6),
  groupEnd('g4', 7),
  groupEnd('g2', 7.5),
  groupStart('g5', 'Test', 8, 'g1'),
  groupStart('g6', 'unit', 8.2, 'g5'),
  out('running 128 tests\n', 9),
  out('✓ 128 passed\n', 10),
  groupEnd('g6', 11),
  groupStart('g7', 'e2e', 11.2, 'g5'),
  out('running 12 specs\n', 12),
  out('FAIL checkout.spec.ts > applies coupon at checkout\n', 13, 'stderr'),
  groupEnd('g7', 14),
  groupEnd('g5', 14.5),
  groupEnd('g1', 15),
  {v: 1, ts: at(15.2), type: 'end', totalBytes: 9_216},
];

const unifiedAgentRecords: LogRecord[] = [
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'user',
      label: 'user',
      meta: [],
      text: 'Update the auth form error handling.',
      terminalFailure: false,
    },
    0,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [{label: 'model', value: 'gpt-5-codex'}],
      text: 'I will inspect the form and the existing tests first.',
      terminalFailure: false,
    },
    1,
  ),
  session(
    {
      kind: 'thinking',
      timestamp: 0,
      text: 'The likely risk is server errors being written to the wrong form meta slot.',
    },
    1.1,
  ),
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'call-1',
      name: 'read_file',
      input: JSON.stringify({path: 'src/login-form.tsx'}, null, 2),
    },
    1.2,
  ),
  out('$ pnpm --filter @shipfox/client-auth test\n', 2),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'call-1',
      toolName: 'read_file',
      output: 'export function LoginForm() { /* ... */ }',
      isError: false,
    },
    3,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Model changed',
      detail: 'gpt-5-codex',
      meta: [{label: 'provider', value: 'openai'}],
      tone: 'default',
      terminalFailure: false,
    },
    4,
  ),
  {v: 1, ts: at(5), type: 'end', totalBytes: 4096},
];

const providerRecoveryRecords: LogRecord[] = [
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Model response interrupted',
      detail: 'Retrying in 4 seconds (2 of 3)',
      meta: [
        {label: 'provider', value: 'Shipfox'},
        {label: 'model', value: 'GLM 5.3 Flash'},
        {label: 'error code', value: 'provider_stream_interrupted'},
      ],
      tone: 'warning',
      terminalFailure: false,
    },
    0,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Model response recovered',
      detail: 'Continued after 2 retries',
      meta: [
        {label: 'provider', value: 'Shipfox'},
        {label: 'model', value: 'GLM 5.3 Flash'},
        {label: 'error code', value: 'provider_stream_interrupted'},
      ],
      tone: 'success',
      terminalFailure: false,
    },
    5,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Model response interrupted',
      detail: 'Failed after 4 attempts',
      meta: [
        {label: 'provider', value: 'Shipfox'},
        {label: 'model', value: 'GLM 5.3 Flash'},
        {label: 'error code', value: 'provider_stream_interrupted'},
      ],
      tone: 'error',
      terminalFailure: true,
    },
    10,
  ),
];

const awaitingAgentRecords: LogRecord[] = [
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'call-2',
      name: 'run_tests',
      input: JSON.stringify({filter: '@shipfox/client-logs'}, null, 2),
    },
    0,
  ),
  out('running tests...\n', 1),
];

const failedAgentRecords: LogRecord[] = [
  out('$ pnpm test\n', 0),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [],
      text: 'The run cannot continue because the harness aborted.',
      terminalFailure: true,
    },
    1,
  ),
];

const allAgentSessionTypeRecords: LogRecord[] = [
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Session started',
      detail: 'session-2026-06-23',
      meta: [{label: 'cwd', value: '/workspace/platform'}],
      tone: 'default',
      terminalFailure: false,
    },
    0,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Session info',
      detail: 'Restored 14 messages from prior context.',
      meta: [],
      tone: 'default',
      terminalFailure: false,
    },
    1,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Review setup',
      detail: 'entry-review',
      meta: [],
      tone: 'default',
      terminalFailure: false,
    },
    2,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Thinking level changed',
      detail: 'high',
      meta: [],
      tone: 'default',
      terminalFailure: false,
    },
    3,
  ),
  session(
    {
      kind: 'lifecycle',
      timestamp: 0,
      label: 'Model changed',
      detail: 'gpt-5-codex',
      meta: [{label: 'provider', value: 'openai'}],
      tone: 'default',
      terminalFailure: false,
    },
    4,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'user',
      label: 'user',
      meta: [{label: 'attachment', value: 'image/png'}],
      text: 'Review the failed workflow attempt and patch the tests.',
      terminalFailure: false,
    },
    5,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [
        {label: 'model', value: 'gpt-5-codex'},
        {label: 'provider', value: 'openai'},
      ],
      text: 'I will inspect the failure anchor and the log renderer.',
      terminalFailure: false,
    },
    6,
  ),
  session(
    {
      kind: 'thinking',
      timestamp: 0,
      text: 'The UI needs to preserve the terminal assistant message while still showing the tool activity inline.',
    },
    6.1,
  ),
  session(
    {
      kind: 'tool-call',
      timestamp: 0,
      id: 'call-read',
      name: 'read_file',
      input: JSON.stringify({path: 'libs/client/logs/src/components/log-view.tsx'}, null, 2),
    },
    6.2,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'call-read',
      toolName: 'read_file',
      output: '<AgentSessionRows rows={[node.record.row]} />',
      isError: false,
    },
    7,
  ),
  session(
    {
      kind: 'tool-result',
      timestamp: 0,
      toolCallId: 'call-test',
      toolName: 'run_tests',
      output: 'FAIL log-view.test.tsx > renders tool results',
      isError: true,
    },
    8,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'branch summary',
      meta: [{label: 'from', value: 'entry-review'}],
      text: 'Kept the renderer scoped to canonical agent_session rows and log-tree ordering.',
      terminalFailure: false,
    },
    9,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'compaction',
      meta: [{label: 'tokens', value: '42000'}],
      text: 'Previous context summarized into 3 decisions.',
      terminalFailure: false,
    },
    10,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'custom',
      meta: [{label: 'type', value: 'review'}],
      text: '{"verdict":"coverage looks complete"}',
      terminalFailure: false,
    },
    11,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'system',
      label: 'operator note',
      meta: [],
      text: 'Retry after the fixture update.',
      terminalFailure: false,
    },
    12,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'assistant',
      label: 'assistant',
      meta: [{label: 'error', value: 'Harness aborted before the retry finished.'}],
      text: 'I cannot continue because the test harness aborted.',
      terminalFailure: true,
    },
    13,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'tool',
      label: 'bash execution',
      meta: [
        {label: 'command', value: 'pnpm test'},
        {label: 'exit', value: '1'},
        {label: 'truncated', value: 'true'},
        {label: 'full output', value: '/tmp/shipfox-agent-output.log', inline: false},
      ],
      text: 'FAIL log-view.test.tsx > renders tool results',
      terminalFailure: false,
    },
    14,
  ),
  session(
    {
      kind: 'message',
      timestamp: 0,
      role: 'custom',
      label: 'status',
      meta: [],
      text: 'Extension status update.',
      terminalFailure: false,
    },
    15,
  ),
  session(
    {
      kind: 'raw',
      timestamp: 0,
      label: 'Unknown session entry: future_entry',
      raw: '{"type":"future_entry","payload":{"feature":"new-session-event"}}',
    },
    16,
  ),
  session({kind: 'raw', timestamp: 0, label: 'Malformed session entry', raw: '{not-json'}, 17),
  {v: 1, ts: at(20), type: 'end', totalBytes: 12_288},
];

const meta = {
  title: 'Logs/LogView',
  component: LogView,
  parameters: {layout: 'padded'},
  tags: ['autodocs'],
  argTypes: {
    timestamps: {control: 'inline-radio', options: ['off', 'rel', 'abs']},
    wrap: {control: 'boolean'},
    showLineNumbers: {control: 'boolean'},
  },
  args: {
    timestamps: 'off',
    wrap: false,
    showLineNumbers: true,
  },
} satisfies Meta<typeof LogView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={showcaseRecords} />
    </div>
  ),
};

/**
 * Groups nested three levels deep (Deploy > Build > Compile, Deploy > Test >
 * unit/e2e). Each level indents; the failing `e2e` leaf bubbles its error up to
 * `Test` and `Deploy pipeline`. Collapse any group to see its "N lines" summary,
 * duration, and (for a branch with a failure) the inset error bar.
 */
export const NestedGroups: Story = {
  args: {defaultGroupsOpen: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={nestedRecords} />
    </div>
  ),
};

export const ClosedEmpty: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[]} />
    </div>
  ),
};

export const PendingEmpty: Story = {
  args: {showLineNumbers: true, emptyState: 'pending'},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[]} />
    </div>
  ),
};

export const MinimalOutput: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={[{v: 1, ts: at(1), type: 'end', totalBytes: 0}]} />
    </div>
  ),
};

export const UnifiedAgentSession: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={unifiedAgentRecords} />
    </div>
  ),
};

export const PairedActivityAndMarkdown: Story = {
  render: (args) => (
    <div className="flex max-w-3xl flex-col gap-section">
      <Text size="sm" className="text-foreground-neutral-muted">
        The Read File action combines a tool request and its result. The assistant message keeps its
        Markdown formatting.
      </Text>
      <LogView {...args} records={pairedActivityRecords} />
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: READ_FILE_BUTTON_NAME}));
  },
};

export const GroupedNativeAndIntegrationReads: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={[...groupedReadRecords, {v: 1, ts: at(16), type: 'end', totalBytes: 0}]}
        actionPresentation={createIntegrationActionPresentationLookup(groupedReadTools)}
      />
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const nativeGroups = await canvas.findAllByRole('button', {name: GROUPED_NATIVE_BUTTON_NAME});
    if (nativeGroups[0]) await userEvent.click(nativeGroups[0]);
    await userEvent.click(
      await canvas.findByRole('button', {name: GROUPED_INTEGRATION_BUTTON_NAME}),
    );
  },
};

export const SearchedReadGroup: Story = {
  args: {search: 'ENG-2312'},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={groupedReadRecords}
        actionPresentation={createIntegrationActionPresentationLookup(groupedReadTools)}
      />
    </div>
  ),
};

export const NativePiTools: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={nativePiRecords} />
    </div>
  ),
};

export const NativeClaudeTools: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={nativeClaudeRecords} />
    </div>
  ),
};

export const ShipfoxAndProxiedTools: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={shipfoxToolRecords}
        actionPresentation={createIntegrationActionPresentationLookup([
          {
            provider: 'slack',
            connectionId: 'slack-connection',
            connectionSlug: 'slack-shipfox',
            toolId: 'read_channel_info',
            sensitivity: 'read',
          },
        ])}
      />
    </div>
  ),
};

export const NativeMissingFailuresAndLargeResult: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={nativeEdgeRecords} />
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: LARGE_READ_BUTTON_NAME}));
  },
};

export const ProviderRecoveryStates: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={providerRecoveryRecords} />
    </div>
  ),
};

export const AllAgentSessionTypes: Story = {
  args: {showLineNumbers: true, anchorToFailure: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={allAgentSessionTypeRecords} />
    </div>
  ),
};

export const RunningAgentToolCall: Story = {
  args: {showLineNumbers: true, emptyState: 'pending'},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={awaitingAgentRecords} />
    </div>
  ),
};

export const ClaudeToolResultResolution: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={toolResultResolutionRecords} />
    </div>
  ),
};

export const ResolvedIntegrationAction: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={toolResultResolutionRecords}
        actionPresentation={createIntegrationActionPresentationLookup([
          {
            provider: 'linear',
            connectionId: 'connection-1',
            connectionSlug: 'linear-shipfox',
            toolId: 'list_teams',
            sensitivity: 'read',
          },
        ])}
      />
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: INTEGRATION_BUTTON_NAME}));
  },
};

export const IntegrationProviderActions: Story = {
  args: {showLineNumbers: true},
  parameters: {
    docs: {
      description: {
        story:
          'GitHub, Gitea, Linear, and Jira actions with expanded results. Sentry and Webhook receive events but do not expose agent tools.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={integrationProviderRecords.slice(0, 8)}
        actionPresentation={createIntegrationActionPresentationLookup(integrationProviderTools)}
      />
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    for (const button of canvas.getAllByRole('button')) {
      if (button.hasAttribute('aria-expanded')) await userEvent.click(button);
    }
  },
};

export const IntegrationProviderActionsMore: Story = {
  args: {showLineNumbers: true},
  parameters: {
    docs: {
      description: {
        story: 'ClickUp, Notion, Slack, and PostHog actions with expanded results.',
      },
    },
  },
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={integrationProviderRecords.slice(8)}
        actionPresentation={createIntegrationActionPresentationLookup(integrationProviderTools)}
      />
    </div>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    for (const button of canvas.getAllByRole('button')) {
      if (button.hasAttribute('aria-expanded')) await userEvent.click(button);
    }
  },
};

export const FailedAgentSession: Story = {
  args: {showLineNumbers: true, anchorToFailure: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView {...args} records={failedAgentRecords} />
    </div>
  ),
};

export const UnknownAgentEntry: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={[
          session(
            {
              kind: 'raw',
              timestamp: 0,
              label: 'Unknown session entry: future_entry',
              raw: '{"type":"future_entry","payload":{"value":true}}',
            },
            0,
          ),
        ]}
      />
    </div>
  ),
};

export const LargeAgentPayload: Story = {
  args: {showLineNumbers: true},
  render: (args) => (
    <div className="max-w-3xl">
      <LogView
        {...args}
        records={[
          session(
            {
              kind: 'message',
              timestamp: 0,
              role: 'assistant',
              label: 'assistant',
              meta: [],
              text: 'Large payload '.repeat(180),
              terminalFailure: false,
            },
            0,
          ),
        ]}
      />
    </div>
  ),
};

export const LoadingSkeleton: Story = {
  render: (args) => (
    <div className="max-w-3xl">
      <LogViewSkeleton
        timestamps={args.timestamps}
        wrap={args.wrap}
        showLineNumbers={args.showLineNumbers}
      />
    </div>
  ),
};

export const ToolStepResults: Story = {
  render: (args) => (
    <div className="w-full max-w-5xl">
      <LogView
        {...args}
        attemptStatus="failed"
        search="notion_main__search"
        actionPresentation={createIntegrationActionPresentationLookup([
          {
            provider: 'notion',
            connectionId: 'connection-notion',
            connectionSlug: 'notion-main',
            toolId: 'search',
            sensitivity: 'read',
          },
        ])}
        records={[
          session(
            {
              kind: 'tool-call',
              timestamp: 0,
              id: 'tool-invocation-0',
              name: 'notion_main__search',
              input: '{"query":"Release notes"}',
            },
            0,
          ),
          session(
            {
              kind: 'tool-result',
              timestamp: 0,
              toolCallId: 'tool-invocation-0',
              toolName: 'notion_main__search',
              isError: false,
              output:
                '{"results":[{"id":"page-1","title":"Release notes","url":"https://notion.so/page-1"}]}',
            },
            1.7,
          ),
          session(
            {
              kind: 'tool-call',
              timestamp: 0,
              id: 'tool-invocation-1',
              name: 'notion_main__search',
              input: '{"query":"Private roadmap"}',
            },
            2,
          ),
          session(
            {
              kind: 'tool-result',
              timestamp: 0,
              toolCallId: 'tool-invocation-1',
              toolName: 'notion_main__search',
              isError: true,
              output:
                '{"code":"permission-denied","message":"The connection cannot access this page."}',
            },
            2.25,
          ),
        ]}
      />
    </div>
  ),
};
